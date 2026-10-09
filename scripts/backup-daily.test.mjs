import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { createClient } from '@supabase/supabase-js'

import { argentinaDate, backupConfig, dumpDatabase, pruneBackups, redact, runBackup, runCommand, runLocked } from './backup-daily.mjs'

const exec = promisify(execFile)
const now = new Date('2026-10-10T02:59:00Z')
const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SECRET_KEY: 'test-secret-key',
  SUPABASE_DB_URL: 'postgresql://postgres.example:test%40password@pooler.example.com:5432/postgres?sslmode=require',
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'adan-backup-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

function storage(list = async () => ({ data: [], error: null }), download = async () => ({ data: new Blob(['attachment']), error: null })) {
  return { storage: { from: (bucket) => {
    assert.equal(bucket, 'order-attachments')
    return { list, download }
  } } }
}

async function dump(directory, config) {
  assert.equal(config.databaseUrl, env.SUPABASE_DB_URL)
  await mkdir(directory, { mode: 0o700 })
  for (const name of ['roles.sql', 'schema.sql', 'data.sql']) {
    await writeFile(join(directory, name), name === 'data.sql'
      ? "SELECT pg_catalog.setval('public.repair_orders_order_number_seq', 1700, false);\n"
      : '-- SQL backup\n', { mode: 0o600 })
  }
}

function options(root, overrides = {}) {
  return { root, now, env, client: storage(), dumpDatabase: dump, logger: () => {}, ...overrides }
}

test('uses the Argentina date across UTC midnight and validates configuration', () => {
  assert.equal(argentinaDate(now), '2026-10-09')
  assert.equal(argentinaDate(new Date('2026-10-10T03:00:00Z')), '2026-10-10')
  assert.equal(backupConfig(env).databaseUrl, env.SUPABASE_DB_URL)
  assert.equal(backupConfig({ ...env, SUPABASE_URL: '', NEXT_PUBLIC_SUPABASE_URL: env.SUPABASE_URL }).url, env.SUPABASE_URL)
  assert.throws(() => backupConfig({}), /SUPABASE_DB_URL/)
  assert.throws(() => backupConfig({ ...env, SUPABASE_SECRET_KEY: '' }), /SUPABASE_SECRET_KEY/)
  assert.throws(() => backupConfig({ ...env, SUPABASE_DB_URL: 'https://invalid.example' }), /PostgreSQL/)
})

test('rejects a database and Storage URL belonging to different Supabase projects', () => {
  const same = { ...env, SUPABASE_DB_URL: 'postgresql://postgres.example:password@aws-0-sa-east-1.pooler.supabase.com:5432/postgres' }
  assert.equal(backupConfig(same).url, env.SUPABASE_URL)
  assert.throws(() => backupConfig({ ...same, SUPABASE_DB_URL: same.SUPABASE_DB_URL.replace('postgres.example:', 'postgres.other:') }), /mismo proyecto/)
  assert.throws(() => backupConfig({ ...env, SUPABASE_DB_URL: 'postgresql://postgres:password@db.other.supabase.co:5432/postgres' }), /mismo proyecto/)
})

test('uses a pinned CLI, exports all selected schemas and never uses an interactive login', async (t) => {
  const root = await fixture(t)
  const commands = []
  await dumpDatabase(join(root, 'database'), backupConfig(env), async (command, args) => commands.push([command, args]), env)
  assert.equal(commands.length, 3)
  assert.ok(commands.every(([command, args]) => command === 'npx' && args.includes('supabase@2.117.0') && args.includes('--db-url') && !args.includes('--linked')))
  assert.ok(commands[0][1].includes('--role-only'))
  assert.ok(commands[1][1].includes('public,private,auth,storage'))
  assert.ok(commands[2][1].includes('--data-only'))
  assert.ok(commands[2][1].includes('--use-copy'))
})

test('does not publish empty SQL exports or prune backups when a dump is incomplete', async (t) => {
  const root = await fixture(t)
  const dumpDatabase = async (directory, config) => {
    await dump(directory, config)
    await writeFile(join(directory, 'data.sql'), '')
  }
  await assert.rejects(runBackup(options(root, { dumpDatabase })), /incompleta/)
  assert.deepEqual(await readdir(join(root, 'backups')), [])
})

test('publishes a private, readable SQL archive with an empty bucket', async (t) => {
  const root = await fixture(t)
  const result = await runBackup(options(root))
  assert.equal(result.files, 0)
  assert.equal(result.date, '2026-10-09')
  const { stdout } = await exec('tar', ['-tzf', result.archive])
  for (const name of ['database/roles.sql', 'database/schema.sql', 'database/data.sql', 'manifest.json']) assert.ok(stdout.includes(name))
  const manifest = JSON.parse((await exec('tar', ['-xOzf', result.archive, 'manifest.json'])).stdout)
  assert.equal(manifest.date, '2026-10-09')
  assert.equal(manifest.files.length, 0)
  assert.equal(manifest.database['data.sql'].sha256.length, 64)
  assert.equal((await stat(join(root, 'backups'))).mode & 0o777, 0o700)
  assert.equal((await stat(result.archive)).mode & 0o777, 0o600)
  assert.deepEqual(await readdir(join(root, 'backups')), ['backup-2026-10-09.tar.gz'])
  const data = (await exec('tar', ['-xOzf', result.archive, 'database/data.sql'])).stdout
  assert.match(data, /1700, false/)
  assert.ok(!JSON.stringify(manifest).includes(env.SUPABASE_SECRET_KEY))
})

test('paginates folders and files and stores their original keys under safe local filenames', async (t) => {
  const root = await fixture(t)
  const calls = []
  const downloaded = []
  const client = storage(async (prefix, { offset, limit }) => {
    calls.push([prefix, offset])
    assert.equal(limit, 100)
    if (prefix === 'folder') return { data: [{ name: 'outside.txt', id: 'nested-file' }], error: null }
    if (offset === 0) return { data: [{ name: 'folder', id: null }, ...Array.from({ length: 99 }, (_, i) => ({ name: `file-${i}.pdf`, id: `id-${i}` }))], error: null }
    return { data: [{ name: 'last.pdf', id: 'last-id' }], error: null }
  }, async (key) => {
    downloaded.push(key)
    return { data: new Blob([key], { type: 'application/pdf' }), error: null }
  })
  const result = await runBackup(options(root, { client }))
  assert.equal(result.files, 101)
  assert.deepEqual(calls, [['', 0], ['folder', 0], ['', 100]])
  assert.ok(downloaded.includes('folder/outside.txt'))
  const manifest = JSON.parse((await exec('tar', ['-xOzf', result.archive, 'manifest.json'])).stdout)
  assert.equal(manifest.files.length, 101)
  assert.ok(manifest.files.every(file => /^storage\/[a-f0-9]{64}$/.test(file.file)))
  await assert.rejects(stat(join(root, 'outside.txt')), { code: 'ENOENT' })
})

test('rejects dot-segment keys instead of allowing HTTP URL normalization to select another object', async (t) => {
  const root = await fixture(t)
  const client = storage(async () => ({ data: [{ id: 'unsafe-file', name: 'folder/../../outside.txt' }], error: null }))
  await assert.rejects(runBackup(options(root, { client })), /Storage.*ruta/)
  assert.deepEqual(await readdir(join(root, 'backups')), [])
})

test('the real SDK requests URL-sensitive object keys exactly and archives distinct bytes', async (t) => {
  const root = await fixture(t)
  const originals = new Map([
    ['report.pdf', 'ORIGINAL'],
    ['report.pdf?edition=2', 'SECOND'],
    ['report.pdf#fragment', 'THIRD'],
    ['percent%2Fname.pdf', 'PERCENT'],
    ['equipo ñ.pdf', 'UNICODE'],
  ])
  const requests = []
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input) => {
      const url = new URL(input)
      if (url.pathname.endsWith('/object/list/order-attachments')) {
        return new Response(JSON.stringify([...originals.keys()].map((name, i) => ({ id: `file-${i}`, name }))), { headers: { 'content-type': 'application/json' } })
      }
      requests.push(url)
      const key = decodeURIComponent(url.pathname.split('/object/order-attachments/')[1])
      return new Response(originals.get(key) || 'WRONG OBJECT', { headers: { 'content-type': 'application/pdf' } })
    } },
  })
  const result = await runBackup(options(root, { client }))
  const manifest = JSON.parse((await exec('tar', ['-xOzf', result.archive, 'manifest.json'])).stdout)
  assert.equal(requests.length, originals.size)
  assert.ok(requests.every(url => !url.search && !url.hash))
  for (const file of manifest.files) {
    assert.equal((await exec('tar', ['-xOzf', result.archive, file.file])).stdout, originals.get(file.key))
  }
})

test('retains today plus six days and leaves unrelated files, directories and symlinks alone', async (t) => {
  const root = await fixture(t)
  const dir = join(root, 'backups')
  await mkdir(dir)
  for (const date of ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-09', '2026-10-10']) await writeFile(join(dir, `backup-${date}.tar.gz`), date)
  await writeFile(join(dir, 'notes.txt'), 'keep')
  await writeFile(join(dir, 'backup-2026-02-31.tar.gz'), 'invalid date')
  await mkdir(join(dir, 'backup-2026-09-01.tar.gz'))
  await symlink(join(dir, 'notes.txt'), join(dir, 'backup-2026-09-02.tar.gz'))
  assert.equal(await pruneBackups(dir, now), 2)
  assert.deepEqual((await readdir(dir)).sort(), ['backup-2026-02-31.tar.gz', 'backup-2026-09-01.tar.gz', 'backup-2026-09-02.tar.gz', 'backup-2026-10-03.tar.gz', 'backup-2026-10-09.tar.gz', 'backup-2026-10-10.tar.gz', 'notes.txt'])
})

for (const failure of ['dump', 'list', 'download', 'archive']) {
  test(`a ${failure} failure preserves the previous daily copy and old backups`, async (t) => {
    const root = await fixture(t)
    const dir = join(root, 'backups')
    await mkdir(dir)
    const old = join(dir, 'backup-2026-10-01.tar.gz')
    const daily = join(dir, 'backup-2026-10-09.tar.gz')
    await writeFile(old, 'old')
    await writeFile(daily, 'previous daily')
    const override = failure === 'dump' ? { dumpDatabase: async () => { throw new Error('dump failed') } }
      : failure === 'archive' ? { createArchive: async () => { throw new Error('archive failed') } }
        : { client: storage(async () => failure === 'list' ? { data: null, error: new Error('list failed') } : { data: [{ id: 'file', name: 'file.pdf' }], error: null }, async () => ({ data: null, error: new Error('download failed') })) }
    await assert.rejects(runBackup(options(root, override)), /failed/)
    assert.equal(await readFile(old, 'utf8'), 'old')
    assert.equal(await readFile(daily, 'utf8'), 'previous daily')
    assert.equal((await readdir(dir)).length, 2)
  })
}

test('replaces the daily copy only after all work succeeds and then prunes old backups', async (t) => {
  const root = await fixture(t)
  await mkdir(join(root, 'backups'))
  await writeFile(join(root, 'backups', 'backup-2026-10-01.tar.gz'), 'old')
  await writeFile(join(root, 'backups', 'backup-2026-10-09.tar.gz'), 'previous')
  const result = await runBackup(options(root))
  assert.equal(result.pruned, 1)
  assert.ok((await stat(result.archive)).size > 0)
  assert.deepEqual(await readdir(join(root, 'backups')), ['backup-2026-10-09.tar.gz'])
})

test('rejects a symlink used as the backups directory', async (t) => {
  const root = await fixture(t)
  const target = join(root, 'elsewhere')
  await mkdir(target)
  await symlink(target, join(root, 'backups'))
  await assert.rejects(runBackup(options(root)), /symlink|simbólico/i)
})

test('redacts database URLs, encoded passwords and Supabase keys in command failures', async () => {
  const message = `${env.SUPABASE_DB_URL} test@password test%40password ${env.SUPABASE_SECRET_KEY}`
  assert.equal(redact(message, env).includes('test@password'), false)
  assert.equal(redact(message, env).includes('test%40password'), false)
  await assert.rejects(runCommand(process.execPath, ['-e', `process.stderr.write(${JSON.stringify(message)}); process.exit(1)`], { env }), error => {
    assert.ok(!error.message.includes(env.SUPABASE_DB_URL))
    assert.ok(!error.message.includes(env.SUPABASE_SECRET_KEY))
    assert.ok(!error.message.includes('test@password'))
    return true
  })
})

test('includes structured CLI errors written to stdout, without disclosing credentials', async () => {
  await assert.rejects(runCommand(process.execPath, ['-e', `process.stdout.write('DATABASE_UNAVAILABLE ${env.SUPABASE_SECRET_KEY}'); process.stderr.write('Connecting...'); process.exit(1)`], { env }), error => {
    assert.match(error.message, /DATABASE_UNAVAILABLE/)
    assert.ok(!error.message.includes(env.SUPABASE_SECRET_KEY))
    return true
  })
})

test('flock excludes a concurrent run and releases the lock after failure', async (t) => {
  const root = await fixture(t)
  const lock = join(root, 'backup.lock')
  const started = join(root, 'started')
  const holder = runLocked(lock, [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(started)}, 'yes'); setTimeout(() => process.exit(2), 400)`])
  for (let i = 0; i < 100; i++) {
    try { await stat(started); break } catch { await new Promise(resolve => setTimeout(resolve, 10)) }
  }
  await stat(started)
  assert.equal(await runLocked(lock, [process.execPath, '-e', 'process.exit(0)']), 75)
  assert.equal(await holder, 2)
  assert.equal(await runLocked(lock, [process.execPath, '-e', 'process.exit(0)']), 0)
})
