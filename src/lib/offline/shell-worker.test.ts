import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const origin = 'https://offline.example.test'
const shellHtml = '<html><head><link rel="stylesheet" href="/_next/static/chunks/shell.css"></head><body><script src="/_next/static/chunks/runtime.js"></script><script>self.__next_f.push([1,"chunks:[\\\"/_next/static/chunks/shell.js\\\"]"])</script></body></html>'
const source = readFileSync('public/order-offline-sw.js', 'utf8')

function harness() {
  const handlers = new Map<string, (event: any) => void>()
  const buckets = new Map<string, Map<string, Response>>()
  const key = (request: string | { url: string }) => new URL(typeof request === 'string' ? request : request.url, origin).href
  const caches = {
    async open(name: string) {
      if (!buckets.has(name)) buckets.set(name, new Map())
      const bucket = buckets.get(name)!
      return {
        async put(request: string | { url: string }, response: Response) { bucket.set(key(request), response.clone()) },
        async match(request: string | { url: string }) { return bucket.get(key(request))?.clone() },
      }
    },
    async keys() { return [...buckets.keys()] },
    async delete(name: string) { return buckets.delete(name) },
  }
  const fetch = vi.fn(async (request: string | { url: string }): Promise<Response> => {
    const url = key(request)
    if (url === `${origin}/offline`) return new Response(shellHtml, { headers: { 'content-type': 'text/html' } })
    if (url.endsWith('/runtime.js')) return new Response('import("./lazy.js"); const next = "static/chunks/late.js"')
    if (url.endsWith('/shell.css')) return new Response('@font-face{src:url(/_next/static/media/font.woff2)}')
    return new Response('/* synthetic static asset */')
  })
  const claim = vi.fn(async () => {})
  runInNewContext(source, {
    self: { location: { origin, href: `${origin}/order-offline-sw.js` }, addEventListener: (type: string, handler: (event: any) => void) => handlers.set(type, handler), skipWaiting: async () => {}, clients: { claim } },
    caches, fetch, URL, Request, Response, Headers, console,
  })
  const dispatch = async (type: string, extra = {}) => {
    const jobs: Promise<unknown>[] = []
    let response: Promise<Response> | undefined
    handlers.get(type)?.({ ...extra, waitUntil: (job: Promise<unknown>) => jobs.push(job), respondWith: (job: Promise<Response>) => { response = job } })
    await Promise.all(jobs)
    return response ? await response : undefined
  }
  const navigate = (path: string, overrides = {}) => dispatch('fetch', { request: { url: `${origin}${path}`, method: 'GET', mode: 'navigate', destination: 'document', headers: new Headers(), ...overrides } })
  const prepare = async () => {
    const reply = vi.fn()
    await dispatch('message', { data: { type: 'PREPARE_OFFLINE_SHELL' }, ports: [{ postMessage: reply }] })
    return reply
  }
  return { fetch, caches, buckets, dispatch, navigate, prepare, claim }
}

describe('offline shell worker', () => {
  it('prepares only the public shell and all referenced assets, including serialized and dynamic chunks', async () => {
    const worker = harness()
    const reply = await worker.prepare()
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ type: 'OFFLINE_SHELL_PREPARED', ok: true }))
    const paths = worker.fetch.mock.calls.map(([request]) => new URL(typeof request === 'string' ? request : request.url, origin).pathname)
    expect(paths.sort()).toEqual(['/offline', '/_next/static/chunks/shell.css', '/_next/static/chunks/runtime.js', '/_next/static/chunks/shell.js', '/_next/static/chunks/lazy.js', '/_next/static/chunks/late.js', '/_next/static/media/font.woff2'].sort())
    expect([...worker.buckets.values()].flatMap((bucket) => [...bucket.keys()]).every((url) => url === `${origin}/offline` || url.startsWith(`${origin}/_next/static/`))).toBe(true)
  })

  it('reuses the fully prepared shell without refetching or parsing it on revisits', async () => {
    const worker = harness()
    await worker.prepare()
    worker.fetch.mockClear()
    const reply = await worker.prepare()
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ok: true }))
    expect(worker.fetch).not.toHaveBeenCalled()
  })

  it('does not claim readiness when a prepared shell has lost a static dependency', async () => {
    const worker = harness()
    await worker.prepare()
    for (const bucket of worker.buckets.values()) bucket.delete(`${origin}/_next/static/chunks/shell.js`)
    worker.fetch.mockRejectedValue(new TypeError('offline'))
    expect(await worker.prepare()).toHaveBeenCalledWith(expect.objectContaining({ ok: false }))
    await expect(worker.navigate('/orders')).rejects.toThrow()
  })

  it('purges all legacy private page caches on activation without touching unrelated caches', async () => {
    const worker = harness()
    await worker.caches.open('adan-order-pages-v1')
    await worker.caches.open('adan-order-pages-older')
    await worker.caches.open('other-app')
    await worker.dispatch('activate')
    expect(await worker.caches.keys()).toEqual(['other-app'])
    expect(worker.claim).toHaveBeenCalledOnce()
  })

  it.each(['/orders', '/orders?page=2&query=Ana', '/orders/new?pending=local&print=1', '/orders/synthetic-id', '/orders/synthetic-id/print?autoPrint=0'])('falls back to the same shell for an unvisited document %s only on fetch rejection', async (path) => {
    const worker = harness()
    await worker.prepare()
    worker.fetch.mockRejectedValue(new TypeError('offline'))
    expect(await (await worker.navigate(path))?.text()).toBe(shellHtml)
  })

  it.each([200, 401, 403, 404, 500])('preserves HTTP %s rather than replacing it with HTML or caching private data', async (status) => {
    const worker = harness()
    await worker.prepare()
    worker.fetch.mockResolvedValue(new Response('network document', { status }))
    const response = await worker.navigate('/orders/private-order')
    expect(response?.status).toBe(status)
    expect(await response?.text()).toBe('network document')
    expect([...worker.buckets.values()].some((bucket) => bucket.has(`${origin}/orders/private-order`))).toBe(false)
  })

  it('never intercepts API, RSC, prefetch, non-GET, cross-origin or unsupported routes', async () => {
    const worker = harness()
    for (const path of ['/api/orders', '/orders/export', '/orders/id/edit', '/orders/id/attachments', '/login', '/reports', '/orders/id?_rsc=abc']) {
      expect(await worker.navigate(path)).toBeUndefined()
    }
    expect(await worker.navigate('/orders', { mode: 'cors', destination: '' })).toBeUndefined()
    expect(await worker.navigate('/orders', { headers: new Headers({ RSC: '1' }) })).toBeUndefined()
    expect(await worker.navigate('/orders', { headers: new Headers({ 'Next-Router-Prefetch': '1' }) })).toBeUndefined()
    expect(await worker.navigate('/orders', { headers: new Headers({ accept: 'text/x-component' }) })).toBeUndefined()
    expect(await worker.navigate('/orders', { method: 'POST' })).toBeUndefined()
    expect(await worker.navigate('/orders', { url: 'https://other.example.test/orders' })).toBeUndefined()
    expect(worker.fetch).not.toHaveBeenCalled()
  })

  it('deduplicates preparation and limits background static fetches to four', async () => {
    const worker = harness()
    let active = 0
    let peak = 0
    worker.fetch.mockImplementation(async (request) => {
      const url = typeof request === 'string' ? request : request.url
      if (new URL(url, origin).pathname === '/offline') {
        return new Response(Array.from({ length: 13 }, (_, i) => `<script src="/_next/static/chunks/${i}.js"></script>`).join(''), { headers: { 'content-type': 'text/html' } })
      }
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      return new Response('/* asset */')
    })
    const replies = await Promise.all([worker.prepare(), worker.prepare(), worker.prepare()])
    expect(worker.fetch).toHaveBeenCalledTimes(14)
    expect(peak).toBe(4)
    for (const reply of replies) expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ok: true }))
  })

  it('reports incomplete preparation and does not serve a shell with missing dependencies', async () => {
    const worker = harness()
    worker.fetch.mockImplementation(async (request) => {
      const path = new URL(typeof request === 'string' ? request : request.url, origin).pathname
      return path === '/offline'
        ? new Response(shellHtml, { headers: { 'content-type': 'text/html' } })
        : new Response('missing static chunk', { status: 404 })
    })
    const reply = await worker.prepare()
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({ ok: false }))
    worker.fetch.mockRejectedValue(new TypeError('offline'))
    await expect(worker.navigate('/orders')).rejects.toThrow()
  })

  it('deduplicates simultaneous asset downloads while returning independently readable response bodies', async () => {
    const worker = harness()
    const request = { url: `${origin}/_next/static/chunks/shared.js`, method: 'GET', mode: 'cors', destination: 'script', headers: new Headers() }
    const [first, second] = await Promise.all([worker.dispatch('fetch', { request }), worker.dispatch('fetch', { request })])
    expect(worker.fetch).toHaveBeenCalledOnce()
    expect(await first?.text()).toBe('/* synthetic static asset */')
    expect(await second?.text()).toBe('/* synthetic static asset */')
  })

  it('uses the static cache offline but preserves uncached resource HTTP failures without an HTML fallback', async () => {
    const worker = harness()
    await worker.prepare()
    worker.fetch.mockRejectedValue(new TypeError('offline'))
    const request = (name: string) => ({ url: `${origin}/_next/static/chunks/${name}`, method: 'GET', mode: 'cors', destination: 'script', headers: new Headers() })
    const cached = await worker.dispatch('fetch', { request: request('shell.js') })
    expect(await cached?.text()).toBe('/* synthetic static asset */')
    worker.fetch.mockResolvedValue(new Response('static not found', { status: 404 }))
    const missing = await worker.dispatch('fetch', { request: request('not-found.js') })
    expect(missing?.status).toBe(404)
    expect(await missing?.text()).toBe('static not found')
  })

  it('ignores legacy messages that request caching private HTML', async () => {
    const worker = harness()
    await worker.dispatch('message', { data: { type: 'CACHE_ORDER_ROUTES', urls: ['/orders/private', '/orders/private/print'] } })
    await worker.dispatch('message', { data: { type: 'CACHE_NEW_ORDER_ROUTE' } })
    expect(worker.fetch).not.toHaveBeenCalled()
  })
})
