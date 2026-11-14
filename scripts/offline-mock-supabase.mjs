import { createMockSupabase } from '../e2e/support/mock-supabase.mjs'

const mock = await createMockSupabase({ port: Number(process.env.OFFLINE_MOCK_PORT ?? 45431), count: Number(process.env.OFFLINE_ORDER_COUNT ?? 52) })
console.log(`Synthetic Supabase HTTP fixture listening at ${mock.url}; PID ${process.pid}`)
let closing = false
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
  if (closing) return
  closing = true
  await mock.close()
  process.exit(0)
})
