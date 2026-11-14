import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createMockSupabase } from './support/mock-supabase.mjs'

test('real HTTP auth, refresh, RLS-like ownership and stable PostgREST ranges', async (t) => {
  const mock = await createMockSupabase({ port: 0, count: 1001 })
  t.after(() => mock.close())
  const request = (path, options) => fetch(`${mock.url}${path}`, options)
  const login = async (email) => {
    const response = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password: 'synthetic-password' }) })
    assert.equal(response.status, 200)
    return response.json()
  }
  assert.equal((await request('/rest/v1/repair_orders')).status, 401)
  assert.equal((await request('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: 'real@example.com', password: 'no' }) })).status, 400)
  const session = await login('a@synthetic.invalid')
  const headers = { Authorization: `Bearer ${session.access_token}`, Prefer: 'count=exact' }
  assert.equal((await (await request('/auth/v1/user', { headers })).json()).id, session.user.id)
  const response = await request('/rest/v1/repair_orders?select=*,customers(*)&order=order_number.asc&limit=500&offset=500', { headers })
  assert.equal(response.headers.get('content-range'), '500-999/1001')
  const rows = await response.json()
  assert.equal(rows.length, 500)
  assert.equal(rows[0].order_number, 10501)
  assert.match(rows[0].customers.full_name, /Sintético A/)
  const b = await login('b@synthetic.invalid')
  const isolated = await request(`/rest/v1/repair_orders?id=eq.${rows[0].id}`, { headers: { Authorization: `Bearer ${b.access_token}` } })
  assert.deepEqual(await isolated.json(), [])
  const refreshed = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }) })
  assert.equal(refreshed.status, 200)
  const next = await refreshed.json()
  assert.notEqual(next.refresh_token, session.refresh_token)
  assert.equal(next.user.id, session.user.id)
  const claims = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  assert.equal(claims(next.access_token).session_id, claims(session.access_token).session_id)
  assert.equal((await request('/auth/v1/logout', { method: 'POST', headers })).status, 204)
  assert.equal((await request('/auth/v1/user', { headers })).status, 401)
})

test('mutations use the actual HTTP PostgREST surface and record synthetic request bytes', async (t) => {
  const mock = await createMockSupabase({ port: 0, count: 2 })
  t.after(() => mock.close())
  const session = await (await fetch(`${mock.url}/auth/v1/token?grant_type=password`, { method: 'POST', body: JSON.stringify({ email: 'a@synthetic.invalid', password: 'synthetic-password' }) })).json()
  const headers = { Authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json', Accept: 'application/vnd.pgrst.object+json' }
  const customer = await (await fetch(`${mock.url}/rest/v1/customers`, { method: 'POST', headers, body: JSON.stringify({ full_name: 'Nuevo sintético', phone: '1144445555', address: 'Prueba 1' }) })).json()
  const created = await (await fetch(`${mock.url}/rest/v1/repair_orders`, { method: 'POST', headers, body: JSON.stringify({ customer_id: customer.id, equipment: 'TV sintético', created_by: session.user.id, status: 'received', received_on: '2026-11-14' }) })).json()
  assert.equal(created.order_number, 10003)
  assert.equal(created.customers.full_name, 'Nuevo sintético')
  const logs = await (await fetch(`${mock.url}/__control/requests`)).json()
  assert.ok(logs.some((entry) => entry.method === 'POST' && entry.path === '/rest/v1/repair_orders' && entry.responseBytes > 0))
  assert.ok(logs.every((entry) => !JSON.stringify(entry).includes(session.access_token)))
})
