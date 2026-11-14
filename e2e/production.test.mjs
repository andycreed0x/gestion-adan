import { test } from 'node:test'
import assert from 'node:assert/strict'
import { syntheticEnvironment, assertPortFree, spawnManaged, stopProcess } from './support/production.mjs'

test('synthetic child environment rejects inherited real-data configuration', () => {
  const old = process.env.SUPABASE_SERVICE_ROLE_KEY
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'must-not-be-inherited'
  try {
    const env = syntheticEnvironment({ appPort: 12345, mockPort: 12346 })
    assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:12346')
    assert.equal(env.NEXT_PUBLIC_APP_URL, 'http://127.0.0.1:12345')
    assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined)
    assert.equal(env.DATABASE_URL, undefined)
    assert.equal(env.OFFLINE_SYNTHETIC, '1')
  } finally { if (old === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = old }
})

test('managed process group cleanup terminates a real local HTTP service', async () => {
  const child = spawnManaged(process.execPath, ['-e', 'require("http").createServer((q,s)=>s.end("synthetic")).listen(45499,"127.0.0.1")'], { env: syntheticEnvironment(), stdout: 'ignore' })
  try {
    let started = false
    for (let i = 0; i < 50; i++) {
      try { const response = await fetch('http://127.0.0.1:45499'); started = response.ok; if (started) break } catch {}
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(started, true)
    await assert.rejects(assertPortFree(45499))
  } finally { await stopProcess(child) }
  await assertPortFree(45499)
})
