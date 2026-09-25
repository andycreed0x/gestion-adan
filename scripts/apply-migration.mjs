import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from 'pg'

const databaseUrl = process.env.SUPABASE_DB_URL
if (!databaseUrl) throw new Error('SUPABASE_DB_URL is required')

const connectionUrl = new URL(databaseUrl)
connectionUrl.searchParams.delete('sslmode')
connectionUrl.searchParams.delete('uselibpqcompat')

const client = new Client({
  connectionString: connectionUrl.toString(),
  ssl: { rejectUnauthorized: false },
})

const migrationsDirectory = new URL('../supabase/migrations/', import.meta.url)
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith('.sql'))
  .sort()

try {
  await client.connect()
  await client.query('begin')
  for (const migration of migrationFiles) {
    const sql = await readFile(join(migrationsDirectory.pathname, migration), 'utf8')
    await client.query(sql)
    console.log(`Applied ${migration}`)
  }
  await client.query('commit')
} catch (error) {
  await client.query('rollback').catch(() => undefined)
  throw error
} finally {
  await client.end().catch(() => undefined)
}
