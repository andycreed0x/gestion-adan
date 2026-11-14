/** Deliberately tiny HTTP GoTrue/PostgREST fixture. Never connects to a database. */
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

export const SYNTHETIC_KEY = 'sb_publishable_synthetic_offline_tests_only'
export const accounts = {
  a: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'a@synthetic.invalid', label: 'A' },
  b: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'b@synthetic.invalid', label: 'B' },
}
const idFor = (account, kind, n) => `${account === 'a' ? 'a' : 'b'}${kind}000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const normalizePhone = (phone = '') => phone.replace(/\D/g, '')

export async function createMockSupabase({ port = 45431, count = 52 } = {}) {
  let datasets, sessions, refreshTokens, requests, settings, nextSequence
  const reset = (options = {}) => {
    datasets = {}
    sessions = new Map()
    refreshTokens = new Map()
    requests = []
    settings = { delayMs: 0, delayPath: '/rest/v1/repair_orders', failStatus: 0, ...options }
    nextSequence = { a: (options.count ?? count) + 1, b: (options.count ?? count) + 1 }
    for (const [key, account] of Object.entries(accounts)) {
      const customers = [], orders = []
      for (let i = 1; i <= (options.count ?? count); i++) {
        const customer = { id: idFor(key, 'c', i), full_name: `Cliente Sintético ${account.label} ${String(i).padStart(4, '0')}`, address: `Calle de prueba ${i}`, phone: `11${String(40000000 + i)}`, phone_normalized: `11${String(40000000 + i)}` }
        customers.push(customer)
        orders.push({ id: idFor(key, 'd', i), order_number: 10000 + i, customer_id: customer.id, equipment: `TV sintético ${i}`, accessories: 'Control de prueba', reported_fault: 'No enciende (sintético)', resolution: 'Diagnóstico sintético', budget_cents: 123456, status: 'received', received_on: options.today ?? today(), picked_up_on: null, created_by: account.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      }
      datasets[key] = { customers, orders }
    }
  }
  reset()
  function userFor(key) {
    const account = accounts[key]
    return { id: account.id, email: account.email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], email_confirmed_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', is_anonymous: false }
  }
  function issueSession(key, expiresIn = 3600, sessionId = randomUUID()) {
    const exp = Math.floor(Date.now() / 1000) + expiresIn
    const encode = (object) => Buffer.from(JSON.stringify(object)).toString('base64url')
    const access_token = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: accounts[key].id, aud: 'authenticated', role: 'authenticated', email: accounts[key].email, exp, iat: Math.floor(Date.now() / 1000), session_id: sessionId })}.${encode('synthetic-no-real-signature')}`
    const refresh_token = `synthetic-refresh-${randomUUID()}`
    sessions.set(access_token, key)
    refreshTokens.set(refresh_token, { key, sessionId })
    return { access_token, refresh_token, token_type: 'bearer', expires_in: expiresIn, expires_at: exp, user: userFor(key) }
  }
  const server = createServer(async (req, res) => {
    const start = performance.now()
    const url = new URL(req.url, 'http://127.0.0.1')
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString()
    let body = {}
    try { if (raw) body = JSON.parse(raw) } catch { /* report a JSON error below */ }
    const token = req.headers.authorization?.replace(/^Bearer /, '')
    const key = sessions.get(token)
    const entry = { method: req.method, path: url.pathname, query: url.search, account: key ?? null, requestBytes: Buffer.byteLength(raw), responseBytes: 0, status: 0, durationMs: 0 }
    const send = (status, value, headers = {}) => {
      const data = value === undefined ? '' : JSON.stringify(value)
      entry.responseBytes = Buffer.byteLength(data)
      entry.status = status
      entry.durationMs = performance.now() - start
      if (!url.pathname.startsWith('/__control')) requests.push(entry)
      res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range', ...headers })
      res.end(data)
    }
    try {
      if (req.method === 'OPTIONS') return send(204)
      if (url.pathname === '/__control/health') return send(200, { synthetic: true })
      if (url.pathname === '/__control/reset' && req.method === 'POST') { reset(body); return send(200, { synthetic: true }) }
      if (url.pathname === '/__control/settings' && req.method === 'POST') { Object.assign(settings, body); return send(200, settings) }
      if (url.pathname === '/__control/requests') return send(200, requests)
      if (url.pathname === '/__control/clear-requests' && req.method === 'POST') { requests = []; return send(200, {}) }
      if (url.pathname === '/__control/state') return send(200, datasets)
      if (url.pathname === '/__control/mutate' && req.method === 'POST') {
        const dataset = datasets[body.account ?? 'a']
        if (body.deleteId) dataset.orders = dataset.orders.filter((order) => order.id !== body.deleteId)
        if (body.customerId) Object.assign(dataset.customers.find((row) => row.id === body.customerId) ?? {}, body.customer ?? {})
        if (body.orderId) Object.assign(dataset.orders.find((row) => row.id === body.orderId) ?? {}, body.order ?? {})
        return send(200, { synthetic: true })
      }
      // Test-only session endpoint supports an expired cookie without waiting an hour.
      if (url.pathname === '/__control/session' && req.method === 'POST') return send(200, issueSession(body.account ?? 'a', body.expiresIn ?? 3600))
      if (settings.delayMs && url.pathname.startsWith(settings.delayPath)) await new Promise((resolve) => setTimeout(resolve, settings.delayMs))
      if (settings.failStatus && url.pathname.startsWith(settings.delayPath)) return send(settings.failStatus, { message: 'Synthetic injected failure', code: 'SYNTHETIC' })
      if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
        if (url.searchParams.get('grant_type') === 'refresh_token') {
          const refreshedKey = refreshTokens.get(body.refresh_token)
          if (!refreshedKey) return send(400, { error: 'invalid_grant', error_description: 'Synthetic refresh token is invalid' })
          refreshTokens.delete(body.refresh_token)
          return send(200, issueSession(refreshedKey.key, 3600, refreshedKey.sessionId))
        }
        const found = Object.entries(accounts).find(([, account]) => account.email === body.email)
        if (!found || body.password !== 'synthetic-password') return send(400, { error: 'invalid_grant', error_description: 'Synthetic credentials only' })
        return send(200, issueSession(found[0]))
      }
      if (url.pathname === '/auth/v1/user') return key ? send(200, userFor(key)) : send(401, { message: 'Invalid synthetic token', code: 'bad_jwt' })
      if (url.pathname === '/auth/v1/logout') {
        if (key) { for (const [value, owner] of sessions) if (owner === key) sessions.delete(value); for (const [value, owner] of refreshTokens) if (owner.key === key) refreshTokens.delete(value) }
        return send(204)
      }
      if (!url.pathname.startsWith('/rest/v1/')) return send(404, { message: `Unsupported synthetic endpoint: ${url.pathname}` })
      if (!key) return send(401, { message: 'Synthetic auth required', code: 'PGRST301' })
      const dataset = datasets[key]
      const table = url.pathname.split('/').pop()
      const customerById = new Map(dataset.customers.map((customer) => [customer.id, customer]))
      const join = (order) => ({ ...order, customers: customerById.get(order.customer_id) ?? null })
      const listRow = (order) => {
        const customer = join(order).customers
        return { ...order, customer_name: customer?.full_name ?? '', customer_address: customer?.address ?? '', customer_phone: customer?.phone ?? '', customer_phone_normalized: customer?.phone_normalized ?? null, search_text: `${order.order_number} ${order.equipment} ${customer?.full_name} ${customer?.phone}`.toLocaleLowerCase('es-AR') }
      }
      let rows = table === 'repair_orders' ? dataset.orders.map(join) : table === 'repair_order_list' ? dataset.orders.map(listRow) : table === 'customers' ? dataset.customers.map((row) => ({ ...row })) : table === 'repair_order_attachments' ? [] : null
      if (!rows) return send(404, { message: `Unsupported synthetic table: ${table}` })
      for (const [column, filter] of url.searchParams) {
        if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(column)) continue
        const separator = filter.indexOf('.')
        const operator = filter.slice(0, separator), value = filter.slice(separator + 1)
        if (['eq', 'gt', 'gte', 'lt', 'lte', 'in', 'ilike', 'is'].includes(operator)) {
          rows = rows.filter((row) => {
            const actual = row[column]
            const compare = typeof actual === 'number' ? Number(value) : value
            return operator === 'eq' ? String(actual) === value : operator === 'gt' ? actual > compare : operator === 'gte' ? actual >= compare : operator === 'lt' ? actual < compare : operator === 'lte' ? actual <= compare : operator === 'in' ? value.slice(1, -1).split(',').map((item) => item.replace(/^"|"$/g, '')).includes(String(actual)) : operator === 'is' ? (value === 'null' ? actual == null : String(actual) === value) : String(actual).toLowerCase().includes(value.replace(/[%*]/g, '').toLowerCase())
          })
        } else return send(400, { message: `Unsupported synthetic filter: ${column}=${filter}` })
      }
      if (req.method === 'POST') {
        const input = Array.isArray(body) ? body : [body]
        rows = input.map((record) => {
          if (table === 'customers') {
            const row = { ...record, id: randomUUID(), phone_normalized: normalizePhone(record.phone) }
            dataset.customers.push(row)
            return row
          }
          if (table === 'repair_orders') {
            const row = { accessories: '', reported_fault: '', resolution: '', budget_cents: null, picked_up_on: null, ...record, id: randomUUID(), order_number: 10000 + nextSequence[key]++, created_by: accounts[key].id }
            dataset.orders.push(row)
            return join(row)
          }
          throw new Error(`Unsupported synthetic insertion: ${table}`)
        })
      } else if (req.method === 'PATCH') {
        const ids = new Set(rows.map((row) => row.id))
        const original = table === 'customers' ? dataset.customers : dataset.orders
        for (const row of original) if (ids.has(row.id)) Object.assign(row, body, table === 'customers' ? { phone_normalized: normalizePhone(body.phone ?? row.phone) } : {})
        return send(204)
      } else if (req.method === 'DELETE') {
        const ids = new Set(rows.map((row) => row.id))
        dataset.orders = dataset.orders.filter((row) => !ids.has(row.id))
        return send(204)
      }
      const ordering = (url.searchParams.get('order') ?? '').split(',').filter(Boolean).map((part) => part.split('.'))
      rows.sort((a, b) => {
        for (const [column, direction] of ordering) {
          if (a[column] !== b[column]) return (a[column] < b[column] ? -1 : 1) * (direction === 'desc' ? -1 : 1)
        }
        return 0
      })
      const total = rows.length
      const [rangeStart, rangeEnd] = String(req.headers.range ?? '').split('-').map(Number)
      const from = Number(url.searchParams.get('offset') ?? rangeStart ?? 0) || 0
      const limit = Number(url.searchParams.get('limit') ?? (rangeEnd ? rangeEnd - from + 1 : 1000))
      rows = rows.slice(from, from + limit)
      const headers = { 'content-range': `${rows.length ? `${from}-${from + rows.length - 1}` : '*'}/${total}`, 'range-unit': 'items' }
      const single = String(req.headers.accept ?? '').includes('application/vnd.pgrst.object+json')
      if (single && rows.length !== 1) return send(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows` }, headers)
      return send(req.method === 'POST' ? 201 : 200, single ? rows[0] : rows, headers)
    } catch (error) { send(500, { message: error.message, code: 'SYNTHETIC_MOCK_BUG' }) }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve, reject) => { server.closeAllConnections(); server.close((error) => error ? reject(error) : resolve()) }) }
}
