import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { createClient } from '@supabase/supabase-js'

const exec = promisify(execFile)
const rootDirectory = fileURLToPath(new URL('../', import.meta.url))
const schemas = 'public,private,auth,storage'
const bucket = 'order-attachments'
const pageSize = 100

export function argentinaDate(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const part = type => parts.find(value => value.type === type).value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function backupConfig(env) {
  for (const name of ['SUPABASE_DB_URL', 'SUPABASE_SECRET_KEY']) {
    if (!env[name]) throw new Error(`Falta ${name} en .env`)
  }
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('Falta SUPABASE_URL o NEXT_PUBLIC_SUPABASE_URL en .env')
  const database = new URL(env.SUPABASE_DB_URL)
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('SUPABASE_DB_URL debe ser una conexión PostgreSQL')
  if (!database.password) throw new Error('SUPABASE_DB_URL debe incluir la contraseña de la base')
  const api = new URL(url)
  if (api.protocol !== 'https:') throw new Error('SUPABASE_URL debe usar HTTPS')
  if (api.hostname.endsWith('.supabase.co')) {
    const project = api.hostname.split('.')[0]
    if ((database.hostname.endsWith('.pooler.supabase.com') && !database.username.endsWith(`.${project}`))
      || (database.hostname.startsWith('db.') && database.hostname.endsWith('.supabase.co') && database.hostname !== `db.${project}.supabase.co`)) {
      throw new Error('La base de datos y Storage deben pertenecer al mismo proyecto Supabase')
    }
  }
  return { databaseUrl: env.SUPABASE_DB_URL, url, key: env.SUPABASE_SECRET_KEY }
}

export function redact(message, env = process.env) {
  let output = String(message)
  const secrets = [env.SUPABASE_SECRET_KEY, env.SUPABASE_ACCESS_TOKEN, env.SUPABASE_DB_URL]
  try {
    const password = new URL(env.SUPABASE_DB_URL).password
    secrets.push(password, decodeURIComponent(password))
  } catch { /* Invalid configuration must not hide the original error. */ }
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) output = output.split(secret).join('[REDACTED]')
  return output.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[REDACTED DATABASE URL]')
}

export async function runCommand(command, args, { env = process.env, cwd = rootDirectory } = {}) {
  try {
    return await exec(command, args, { env, cwd, timeout: 15 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 })
  } catch (error) {
    const detail = [error.stderr, error.stdout].filter(Boolean).join('\n') || 'no se pudo completar el comando'
    throw new Error(redact(`${command} falló (${error.code || error.signal}): ${detail}`, env))
  }
}

export function runLocked(lock, args, env = process.env) {
  return new Promise((resolveCode, reject) => {
    const child = spawn('flock', ['--nonblock', '--no-fork', '--conflict-exit-code', '75', lock, ...args], { env, stdio: 'inherit' })
    const forward = signal => child.kill(signal)
    const interrupt = () => forward('SIGINT')
    const terminate = () => forward('SIGTERM')
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    const clean = () => {
      process.off('SIGINT', interrupt)
      process.off('SIGTERM', terminate)
    }
    child.once('error', error => { clean(); reject(error) })
    child.once('exit', code => { clean(); resolveCode(code ?? 1) })
  })
}

async function privateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('El directorio de backups no puede ser un enlace simbólico')
  await chmod(directory, 0o700)
}

export async function dumpDatabase(directory, config, execute = runCommand, env = process.env) {
  await privateDirectory(directory)
  for (const [name, flags] of [
    ['roles.sql', ['--role-only']],
    ['schema.sql', ['--schema', schemas]],
    ['data.sql', ['--data-only', '--use-copy', '--schema', schemas]],
  ]) {
    await execute('npx', ['--yes', 'supabase@2.117.0', 'db', 'dump', '--db-url', config.databaseUrl, '--file', join(directory, name), ...flags], { env })
  }
}

async function fileHash(filename) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filename)) hash.update(chunk)
  return hash.digest('hex')
}

async function copyStorage(client, directory) {
  await privateDirectory(directory)
  const storage = client.storage.from(bucket)
  const files = []
  async function visit(prefix) {
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await storage.list(prefix, { limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } })
      if (error) throw new Error(`Storage list failed: ${error.message}`)
      if (!Array.isArray(data)) throw new Error('Storage list failed: respuesta inválida')
      for (const object of data) {
        if (!object.name) throw new Error('Storage list failed: objeto sin nombre')
        const key = prefix ? `${prefix}/${object.name}` : object.name
        if (key.split('/').some(segment => segment === '.' || segment === '..')) {
          throw new Error('Storage: ruta con segmentos relativos que HTTP no puede representar de forma segura')
        }
        if (!object.id) { await visit(key); continue }
        const encodedKey = key.split('/').map(encodeURIComponent).join('/')
        const { data: blob, error: downloadError } = await storage.download(encodedKey)
        if (downloadError || !blob) throw new Error(`Storage download failed: ${downloadError?.message || 'archivo vacío'}`)
        // Hash the key rather than using remote paths as local filenames.
        const filename = createHash('sha256').update(key).digest('hex')
        const bytes = Buffer.from(await blob.arrayBuffer())
        await writeFile(join(directory, filename), bytes, { mode: 0o600 })
        files.push({ key, file: `storage/${filename}`, bytes: bytes.length, contentType: blob.type, sha256: createHash('sha256').update(bytes).digest('hex') })
      }
      if (data.length < pageSize) break
    }
  }
  await visit('')
  return files
}

async function createArchive(directory, archive) {
  await runCommand('tar', ['-czf', archive, '-C', directory, 'database', 'storage', 'manifest.json'])
}

export async function pruneBackups(directory, now) {
  const cutoff = new Date(`${argentinaDate(now)}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - 6)
  let removed = 0
  for (const name of await readdir(directory)) {
    const match = /^backup-(\d{4}-\d{2}-\d{2})\.tar\.gz$/.exec(name)
    if (!match) continue
    const date = new Date(`${match[1]}T00:00:00Z`)
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[1] || date >= cutoff) continue
    const filename = join(directory, name)
    if (!(await lstat(filename)).isFile()) continue
    await rm(filename)
    removed += 1
  }
  return removed
}

export async function runBackup({
  root = rootDirectory, now = new Date(), env = process.env, client,
  dumpDatabase: dump = dumpDatabase, createArchive: archive = createArchive, logger = console.log,
} = {}) {
  const config = backupConfig(env)
  const date = argentinaDate(now)
  const directory = join(root, 'backups')
  await privateDirectory(directory)
  const temporary = await mkdtemp(join(directory, '.partial-'))
  const published = join(directory, `backup-${date}.tar.gz`)
  try {
    logger(`[${new Date().toISOString()}] Iniciando backup ${date}`)
    await dump(join(temporary, 'database'), config, runCommand, env)
    const database = {}
    for (const name of ['roles.sql', 'schema.sql', 'data.sql']) {
      const filename = join(temporary, 'database', name)
      const information = await lstat(filename)
      if (!information.isFile() || !information.size) throw new Error(`Exportación SQL incompleta: ${name}`)
      await chmod(filename, 0o600)
      database[name] = { bytes: information.size, sha256: await fileHash(filename) }
    }
    const supabase = client || createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(120_000) }) },
    })
    const files = await copyStorage(supabase, join(temporary, 'storage'))
    const manifest = { version: 1, date, startedAt: now.toISOString(), completedAt: new Date().toISOString(), source: new URL(config.url).hostname, schemas, bucket, database, files }
    await writeFile(join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 })
    const staged = join(temporary, 'backup.tar.gz')
    await archive(temporary, staged)
    const information = await lstat(staged)
    if (!information.isFile() || !information.size) throw new Error('Archivo de backup vacío o inválido')
    await chmod(staged, 0o600)
    await rename(staged, published)
    const pruned = await pruneBackups(directory, now)
    logger(`[${new Date().toISOString()}] Backup completo: ${published}; adjuntos=${files.length}; eliminados=${pruned}`)
    return { archive: published, date, files: files.length, pruned }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

async function main() {
  process.umask(0o077)
  process.loadEnvFile(join(rootDirectory, '.env'))
  backupConfig(process.env)
  const directory = join(rootDirectory, 'backups')
  await privateDirectory(directory)
  if (!process.argv.includes('--locked')) {
    const lock = join(directory, '.backup.lock')
    const handle = await open(lock, 'a', 0o600)
    await handle.close()
    const code = await runLocked(lock, [process.execPath, fileURLToPath(import.meta.url), '--locked'])
    if (code === 75) console.log('Backup omitido: ya hay otra ejecución en curso')
    process.exitCode = code === 75 ? 0 : code
    return
  }
  await runBackup()
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`[${new Date().toISOString()}] Backup falló: ${redact(error.message)}`)
    process.exitCode = 1
  })
}
