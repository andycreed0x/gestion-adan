const SHELL_CACHE = 'adan-order-shell-v2'
const STATIC_CACHE = 'adan-order-static-v2'
const SHELL_PATH = '/offline'
const ORDER_DOCUMENT = /^\/orders(?:\/new|\/[\w-]+(?:\/print)?)?\/?$/
const assetJobs = new Map()
const resourceQueue = []
let activeResources = 0
let preparation = null

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys()
    await Promise.all(names.filter((name) => name.startsWith('adan-order-pages-') ||
      (name.startsWith('adan-order-shell-') && name !== SHELL_CACHE) ||
      (name.startsWith('adan-order-static-') && name !== STATIC_CACHE)).map((name) => caches.delete(name)))
    // Private records and pending creates live in IndexedDB, never in these caches.
    await self.clients.claim()
  })())
})

function staticUrl(value, base) {
  try {
    const url = new URL(value.replace(/&amp;/g, '&'), base)
    return url.origin === self.location.origin && url.pathname.startsWith('/_next/static/') ? url.href : null
  } catch {
    return null
  }
}

function dependencies(source, base) {
  // Flight serializes client chunk references inside inline scripts, not just src tags.
  const text = source.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\+"/g, '"')
  const found = new Set()
  const add = (value) => {
    const url = staticUrl(value, base)
    if (url) found.add(url)
  }
  for (const match of text.matchAll(/(?:https?:\/\/[^\s"'<>\\)]+)?\/_next\/static\/[^\s"'<>\\)\],;]+/g)) add(match[0])
  // Turbopack's chunk loader may use paths relative to the Next asset prefix.
  for (const match of text.matchAll(/["'](static\/(?:chunks|media)\/[^"'\\]+)["']/g)) add(`/_next/${match[1]}`)
  // Follow literal imports and CSS url() references without caching third-party assets.
  for (const match of text.matchAll(/(?:["']|url\(\s*)(\.{1,2}\/[^\s"'<>\\)]+)["')]/g)) add(match[1])
  return found
}

function drainResources() {
  while (activeResources < 4 && resourceQueue.length) {
    const { run, resolve, reject } = resourceQueue.shift()
    activeResources += 1
    run().then(resolve, reject).finally(() => {
      activeResources -= 1
      drainResources()
    })
  }
}

function staticResource(url) {
  if (assetJobs.has(url)) return assetJobs.get(url)
  const job = new Promise((resolve, reject) => {
    resourceQueue.push({ resolve, reject, run: async () => {
      const cache = await caches.open(STATIC_CACHE)
      const cached = await cache.match(url)
      if (cached) return cached
      const response = await fetch(url, { credentials: 'same-origin' })
      if (response.ok && !response.redirected && !response.headers.get('content-type')?.includes('text/html')) {
        await cache.put(url, response.clone())
      }
      return response
    } })
    drainResources()
  })
  assetJobs.set(url, job)
  job.then(() => assetJobs.delete(url), () => assetJobs.delete(url))
  return job
}

async function preparedShell() {
  const cache = await caches.open(SHELL_CACHE)
  const shell = await cache.match(SHELL_PATH)
  if (!shell) return null
  try {
    const resources = JSON.parse(shell.headers.get('x-adan-offline-resources') ?? 'null')
    if (!Array.isArray(resources)) return null
    const assets = await caches.open(STATIC_CACHE)
    for (const url of resources) {
      if (typeof url !== 'string' || !staticUrl(url, self.location.origin) || !await assets.match(url)) return null
    }
    return shell
  } catch {
    return null
  }
}

async function prepareShell() {
  if (await preparedShell()) return
  const response = await fetch(SHELL_PATH, { credentials: 'omit', cache: 'no-store' })
  if (!response.ok || response.redirected || !response.headers.get('content-type')?.includes('text/html')) {
    throw new Error('No se pudo preparar la página offline')
  }
  const html = await response.clone().text()
  const seen = new Set()
  let pending = [...dependencies(html, new URL(SHELL_PATH, self.location.origin).href)]
  while (pending.length) {
    const batch = [...new Set(pending)].filter((url) => !seen.has(url))
    pending = []
    batch.forEach((url) => seen.add(url))
    // Wait for the entire batch even on failure: retries cannot overlap leftover jobs.
    const results = await Promise.allSettled(batch.map(async (url) => {
      const asset = await staticResource(url)
      if (!asset.ok || asset.redirected || asset.headers.get('content-type')?.includes('text/html')) throw new Error('Recurso offline no disponible')
      if (/\.(?:js|css)(?:\?|$)/.test(url)) {
        for (const dependency of dependencies(await asset.clone().text(), url)) {
          if (!seen.has(dependency)) pending.push(dependency)
        }
      }
    }))
    if (results.some((result) => result.status === 'rejected')) throw new Error('Preparación offline incompleta. Volvé a intentar con conexión.')
  }
  // Publish the shell only after its full dependency graph has been cached.
  const cache = await caches.open(SHELL_CACHE)
  const headers = new Headers(response.headers)
  headers.set('x-adan-offline-resources', JSON.stringify([...seen]))
  await cache.put(SHELL_PATH, new Response(html, { status: response.status, headers }))
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'PREPARE_OFFLINE_SHELL') return
  if (!preparation) {
    preparation = prepareShell().then(
      () => ({ type: 'OFFLINE_SHELL_PREPARED', ok: true }),
      () => ({ type: 'OFFLINE_SHELL_PREPARED', ok: false, error: 'Preparación offline incompleta. Volvé a intentar con conexión.' }),
    ).finally(() => { preparation = null })
  }
  event.waitUntil(preparation.then((result) => event.ports?.[0]?.postMessage(result)))
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(staticResource(url.href).then((response) => response.clone()))
    return
  }
  const document = request.mode === 'navigate' && request.destination === 'document'
  const flight = url.searchParams.has('_rsc') || request.headers.has('RSC') ||
    request.headers.has('Next-Router-Prefetch') || request.headers.get('accept')?.includes('text/x-component')
  if (!document || flight || (!ORDER_DOCUMENT.test(url.pathname) && url.pathname !== SHELL_PATH) || /^\/orders\/export\/?$/.test(url.pathname)) return
  event.respondWith((async () => {
    try {
      // Never cache authenticated HTML, nor turn ordinary HTTP/auth failures into successes.
      return await fetch(request)
    } catch (error) {
      const shell = await preparedShell()
      if (shell) return shell
      throw error
    }
  })())
})
