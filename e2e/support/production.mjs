import { spawn, execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repository = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const managed = new Set()
export const stopAllManagedProcesses = () => Promise.allSettled([...managed].map(stopProcess))

export const SOURCE_ENTRIES = ['src', 'public', 'middleware.ts', 'middleware.js', 'proxy.ts', 'proxy.js', 'next.config.ts', 'next.config.mjs', 'next.config.js', 'tsconfig.json', 'next-env.d.ts', 'package.json', 'package-lock.json', 'postcss.config.mjs', 'postcss.config.js']

async function sourceManifest(directory) {
  const files = []
  async function visit(path) {
    const entries = await readdir(join(directory, path), { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = join(path, entry.name)
      if (entry.isDirectory()) await visit(relative)
      else if (entry.isFile()) files.push({ path: relative, sha256: createHash('sha256').update(await readFile(join(directory, relative))).digest('hex') })
      else throw new Error(`Unexpected source symlink: ${relative}`)
    }
  }
  for (const entry of SOURCE_ENTRIES) {
    if (!existsSync(join(directory, entry))) continue
    if (['src', 'public'].includes(entry)) await visit(entry)
    else files.push({ path: entry, sha256: createHash('sha256').update(await readFile(join(directory, entry))).digest('hex') })
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files }
}

export const ORIGINAL_HEAD = 'e033d384a96265785c9329d2d910e1bf7b691623'

/** Allowlist, NOT {...process.env}: real Supabase/admin/backup settings never enter tests. */
export function syntheticEnvironment({ mockPort = 45431, appPort = 45430 } = {}) {
  const env = {}
  for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'XDG_CACHE_HOME', 'PLAYWRIGHT_BROWSERS_PATH']) if (process.env[key]) env[key] = process.env[key]
  return { ...env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${mockPort}`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_offline_tests_only', NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${appPort}`, OFFLINE_SYNTHETIC: '1', OFFLINE_MOCK_PORT: String(mockPort), PORT: String(appPort) }
}

export async function waitForHttp(url, child, timeout = 30000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) throw new Error(`Service exited (${child.exitCode}) before ${url} was ready`)
    try { const result = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (result.ok) return } catch { /* start-up */ }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

export async function assertPortFree(port) {
  const { createServer } = await import('node:net')
  const probe = createServer()
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve) })
  await new Promise((resolve) => probe.close(resolve))
}

export function spawnManaged(command, args, { cwd = repository, env, stdout = 'inherit' } = {}) {
  // An independent process group makes cleanup include any Next workers, not only the CLI.
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', stdout, stdout] })
  managed.add(child)
  child.on('error', (error) => console.error(error))
  return child
}

export async function stopProcess(child) {
  if (!child?.pid) return
  managed.delete(child)
  const exited = new Promise((resolve) => child.once('exit', resolve))
  try { process.kill(-child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') throw error; return }
  let timeout
  await Promise.race([exited, new Promise((resolve) => { timeout = setTimeout(resolve, 3000) })])
  clearTimeout(timeout)
  // Workers can outlive their parent; always terminate any remaining members of OUR group.
  try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
}

export async function prepareProduction({ variant = 'candidate', ref = ORIGINAL_HEAD, compiler = 'turbopack', mockPort = 45431, appPort = 45430, output } = {}) {
  const directory = await mkdtemp(join(tmpdir(), `adan-offline-${variant}-`))
  const env = syntheticEnvironment({ mockPort, appPort })
  try {
    if (variant === 'baseline') {
      // Immutable original source, not today's working tree and never the dirty root checkout.
      const archive = execFileSync('git', ['archive', '--format=tar', ref], { cwd: repository, maxBuffer: 64 * 1024 * 1024 })
      execFileSync('tar', ['-xf', '-', '--exclude=.env*', '-C', directory], { input: archive })
    } else {
      const entries = SOURCE_ENTRIES
      for (const entry of entries) if (existsSync(join(repository, entry))) await cp(join(repository, entry), join(directory, entry), { recursive: true, dereference: false })
    }
    const legacyWorker = execFileSync('git', ['show', `${ORIGINAL_HEAD}:public/order-offline-sw.js`], { cwd: repository })
    await mkdir(join(directory, 'public'), { recursive: true })
    await writeFile(join(directory, 'public/__synthetic-legacy-worker.js'), legacyWorker)
    const sources = await sourceManifest(directory)
    if (compiler === 'webpack') await symlink(join(repository, 'node_modules'), join(directory, 'node_modules'), 'dir')
    else execFileSync('cp', ['-a', '--reflink=auto', join(repository, 'node_modules'), join(directory, 'node_modules')])
    // A manifest records the ONLY Supabase endpoint used without copying host environment.
    await writeFile(join(directory, 'synthetic-manifest.json'), JSON.stringify({ variant, ref: variant === 'baseline' ? ref : null, supabase: env.NEXT_PUBLIC_SUPABASE_URL, synthetic: true }, null, 2))
    if (output) await mkdir(output, { recursive: true })
    console.log(`Building ${variant} in ${directory} against ${env.NEXT_PUBLIC_SUPABASE_URL} (synthetic only)`)
    const build = spawnManaged(process.execPath, [join(directory, 'node_modules/next/dist/bin/next'), 'build', ...(compiler === 'webpack' ? ['--webpack'] : [])], { cwd: directory, env })
    const code = await new Promise((resolve, reject) => { build.once('exit', resolve); build.once('error', reject) })
    if (code !== 0) throw new Error(`${variant} production build failed (${code})`)
    return {
      directory, env, sources,
      start: () => spawnManaged(process.execPath, [join(directory, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(appPort)], { cwd: directory, env }),
      dispose: () => rm(directory, { recursive: true, force: true }),
    }
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
}
