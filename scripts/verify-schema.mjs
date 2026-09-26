import assert from 'node:assert/strict'
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

const requiredTables = [
  'profiles',
  'customers',
  'repair_orders',
  'repair_order_events',
  'repair_order_attachments',
]

try {
  await client.connect()

  const tables = await client.query(
    "select tablename from pg_tables where schemaname = 'public' order by tablename",
  )
  const tableNames = tables.rows.map((row) => row.tablename)
  for (const table of requiredTables) assert(tableNames.includes(table), `Missing table: ${table}`)

  const rls = await client.query(
    `select c.relname, c.relrowsecurity
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = any($1::text[])`,
    [requiredTables],
  )
  for (const row of rls.rows) assert.equal(row.relrowsecurity, true, `RLS disabled for ${row.relname}`)

  const policyCount = await client.query(
    `select count(*)::int as count
     from pg_policies
     where schemaname = 'public' and tablename = any($1::text[])`,
    [requiredTables],
  )
  assert(Number(policyCount.rows[0].count) >= requiredTables.length, 'Missing RLS policies')

  const sequence = await client.query(
    `select start_value
     from pg_sequences
     where schemaname = 'public' and sequencename = 'repair_orders_order_number_seq'`,
  )
  assert.equal(Number(sequence.rows[0]?.start_value), 9380, 'Order sequence must start at 9380')

  const sequenceTrigger = await client.query(
    `select exists (
       select 1
       from pg_trigger trigger
       join pg_proc proc on proc.oid = trigger.tgfoid
       join pg_namespace namespace on namespace.oid = proc.pronamespace
       where trigger.tgrelid = 'public.repair_orders'::regclass
         and not trigger.tgisinternal
         and trigger.tgname = 'sync_repair_order_number_sequence'
         and namespace.nspname = 'private'
         and proc.proname = 'sync_repair_order_number_sequence'
     ) as exists`,
  )
  assert.equal(
    sequenceTrigger.rows[0]?.exists,
    true,
    'Missing repair order sequence safety trigger',
  )

  const bucket = await client.query(
    "select public from storage.buckets where id = 'order-attachments'",
  )
  assert.equal(bucket.rows[0]?.public, false, 'Attachment bucket must be private')

  console.log(JSON.stringify({ tables: tableNames, rls: true, nextOrderNumber: 9380 }))
} finally {
  await client.end().catch(() => undefined)
}
