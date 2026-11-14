import { expect } from '@playwright/test'

export const mockURL = `http://127.0.0.1:${process.env.OFFLINE_MOCK_PORT ?? 45431}`
export async function control(action, body, url = mockURL) {
  const response = await fetch(`${url}/__control/${action}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`Synthetic control ${action}: ${response.status}`)
  return response.json()
}
export async function login(page, account = 'a') {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(`${account}@synthetic.invalid`)
  await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-password')
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click()
  await page.waitForURL('**/orders')
  await expect(page.getByRole('heading', { name: 'Órdenes de reparación' })).toBeVisible()
}

export async function readDatabase(page) {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((db) => db.name === 'adan-orders-v1')) return {}
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('adan-orders-v1')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const entries = await Promise.all([...db.objectStoreNames].map((name) => new Promise((resolve, reject) => {
        const transaction = db.transaction(name)
        const request = transaction.objectStore(name).getAll()
        request.onsuccess = () => resolve([name, request.result])
        request.onerror = () => reject(request.error)
      })))
      return Object.fromEntries(entries)
    } finally { db.close() }
  })
}

export async function waitForSnapshot(page, count, ownerId) {
  await expect.poll(async () => {
    const stores = await readDatabase(page)
    const snapshots = (stores.privateMetadata ?? []).map((record) => record.value).filter((value) => value?.schemaVersion === 1)
    return snapshots.some((snapshot) => snapshot.orders?.length === count && (!ownerId || snapshot.ownerId === ownerId))
  }, { timeout: 30_000, message: `complete persisted snapshot (${count} rows)` }).toBe(true)
}

export async function waitForShell(page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
  })
  await expect.poll(() => page.evaluate(async () => {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      if (await cache.match('/offline')) return true
    }
    return false
  }), { timeout: 30_000, message: 'offline shell is actually cached' }).toBe(true)
}

export async function waitForPreparation(page, { variant = 'candidate', count = 52 } = {}) {
  if (variant === 'baseline') {
    await expect.poll(() => page.evaluate(async (expected) => {
      const cache = await caches.open('adan-order-pages-v1')
      const keys = await cache.keys()
      const details = keys.filter((request) => /^\/orders\/(?!new$)[\w-]+$/.test(new URL(request.url).pathname) && !new URL(request.url).search).length
      const print = keys.filter((request) => /^\/orders\/[\w-]+\/print$/.test(new URL(request.url).pathname)).length
      return details >= expected && print >= expected
    }, count), { timeout: 240_000, intervals: [100], message: `all ${count} baseline detail+ticket documents cached` }).toBe(true)
  } else {
    await waitForSnapshot(page, count)
    await waitForShell(page)
  }
}

/** Chromium can report body=-headers for a cache hit; that is not negative wire traffic. */
export function normalizeRequestSizes(sizes) {
  const physical = (field) => Number.isFinite(sizes?.[field]) ? Math.max(0, sizes[field]) : 0
  const sizeAnomalies = Object.entries(sizes ?? {}).filter(([, value]) => typeof value === 'number' && value < 0).map(([field, reported]) => ({ field, reported, classification: 'negative-size-cache-accounting' }))
  return {
    requestBodyBytes: physical('requestBodySize'),
    responseBodyBytes: physical('responseBodySize'),
    responseHeadersBytes: physical('responseHeadersSize'),
    byteSource: !sizes ? 'unavailable' : sizeAnomalies.length ? 'playwright-wire-sizes-clamped-cache-anomaly' : 'playwright-wire-sizes',
    reportedSizes: sizes ?? null,
    sizeAnomalies,
  }
}

/** Includes worker-originated traffic; no page routing/interception is used. */
export function captureRequests(context) {
  const records = [], pending = new Set()
  let lastActivity = performance.now(), inflight = 0
  const active = new Set()
  const onRequest = (request) => { active.add(request); inflight++; lastActivity = performance.now() }
  const onFinished = (request) => {
    if (!active.delete(request)) return
    inflight--; lastActivity = performance.now()
    const task = (async () => {
      const response = await request.response()
      if (!response) return
      const sizes = await request.sizes().catch(() => null)
      records.push({ method: request.method(), url: request.url(), resourceType: request.resourceType(), serviceWorker: Boolean(request.serviceWorker()), fromServiceWorker: response.fromServiceWorker(), status: response.status(), timing: request.timing(), ...normalizeRequestSizes(sizes) })
    })().catch(() => { /* context disposal can interrupt response metadata */ }).finally(() => pending.delete(task))
    pending.add(task)
  }
  const onFailed = (request) => { if (active.delete(request)) inflight--; lastActivity = performance.now(); records.push({ method: request.method(), url: request.url(), resourceType: request.resourceType(), serviceWorker: Boolean(request.serviceWorker()), failed: request.failure()?.errorText }) }
  context.on('request', onRequest)
  context.on('requestfinished', onFinished)
  context.on('requestfailed', onFailed)
  return {
    records,
    async settled(quietMs = 300, timeout = 30000) {
      const deadline = performance.now() + timeout
      while (inflight || performance.now() - lastActivity < quietMs) {
        if (performance.now() > deadline) throw new Error(`Requests did not settle (${inflight} still active)`)
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      await Promise.all(pending)
    },
    stop() { context.off('request', onRequest); context.off('requestfinished', onFinished); context.off('requestfailed', onFailed) },
  }
}
export const networkRequests = (records) => records.filter((record) => !record.failed && (record.serviceWorker || !record.fromServiceWorker))
export const detailRequests = (records) => networkRequests(records).filter((record) => /^\/orders\/(?!new(?:\/|$))[\w-]+(?:\/print)?$/.test(new URL(record.url).pathname))
