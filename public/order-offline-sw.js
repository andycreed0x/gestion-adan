const CACHE_NAME = 'adan-order-pages-v1'
const CACHEABLE_ORDER_PATH = /^\/orders(?:\/new|\/[\w-]+(?:\/print)?)?\/?$/

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

async function cacheRoutes(urls) {
  const cache = await caches.open(CACHE_NAME)
  await Promise.all(urls.map(async (url) => {
    try {
      const response = await fetch(url, { credentials: 'same-origin' })
      if (response.ok) await cache.put(url, response)
    } catch {
      // A route that cannot be fetched is simply not available offline yet.
    }
  }))
}

self.addEventListener('message', (event) => {
  const message = event.data ?? {}
  if (message.type === 'CACHE_ORDER_ROUTES') event.waitUntil(cacheRoutes(message.urls ?? []))
  if (message.type === 'CACHE_NEW_ORDER_ROUTE') event.waitUntil(cacheRoutes(['/orders/new']))
  if (message.type === 'CLEAR_PRIVATE_ORDER_CACHE') event.waitUntil(caches.delete(CACHE_NAME))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  const isStaticAsset = url.origin === self.location.origin && url.pathname.startsWith('/_next/static/')
  const isOrderPage = url.origin === self.location.origin && CACHEABLE_ORDER_PATH.test(url.pathname)
  if (request.method !== 'GET' || (!isStaticAsset && !isOrderPage)) return

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    try {
      const response = await fetch(request)
      if (response.ok) await cache.put(request, response.clone())
      return response
    } catch {
      const cached = await cache.match(request, { ignoreSearch: url.pathname === '/orders/new' })
      if (cached) return cached
      throw new Error('No hay una copia local de esta página')
    }
  })())
})
