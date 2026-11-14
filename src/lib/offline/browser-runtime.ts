import { createOfflineCoordinator } from './coordinator'
import { activateBrowserOwner, clearBrowserOrderStore, createBrowserOrderStore, getBrowserIdentity, getLogoutFence, IDENTITY_KEY, INVALIDATION_KEY, LOGOUT_FENCE_KEY, suspendBrowserOwner } from './order-store'
import type { PendingCreate, OfflineIdentityMetadata } from './types'
import { waitForOfflineWorker } from './worker-lifecycle'
import { createBrowserSyncReceipts } from './sync-receipts'

type Coordinator = ReturnType<typeof createOfflineCoordinator>
let coordinator: { epoch: string; value: Coordinator } | null = null
type SessionMetadata = OfflineIdentityMetadata
let initializing: { generation: number; promise: Promise<SessionMetadata> } | null = null
let lifecycle = 0
let loggingOut = false
const REVISION_KEY = INVALIDATION_KEY
const CHANGE_KEY = 'adan-offline-change'

function changed() {
  window.dispatchEvent(new Event('adan-offline-sync'))
  localStorage.setItem(CHANGE_KEY, crypto.randomUUID())
}

function revokeLocalAccess() {
  lifecycle += 1
  coordinator?.value.cancel()
  coordinator = null
  suspendBrowserOwner()
}

async function verifiedSession(signal?: AbortSignal): Promise<SessionMetadata> {
  const generation = lifecycle
  const epoch = getBrowserIdentity()?.epoch
  const response = await fetch('/api/offline/session', { cache: 'no-store', signal })
  if (!response.ok) {
    if ((response.status === 401 || response.status === 403) && generation === lifecycle && getBrowserIdentity()?.epoch === epoch) revokeLocalAccess()
    throw new Error('No se pudo verificar la sesión. Volvé a iniciar sesión.')
  }
  return await response.json() as SessionMetadata
}

function checkFence(session: SessionMetadata) {
  const fence = getLogoutFence()
  if (fence?.inProgress || fence?.sessionId === session.sessionId || fence?.revokedSessionIds?.includes(session.sessionId)) throw new Error('Cierre de sesión en curso o sesión anterior revocada')
}

export function initializeOfflineIdentity(expectedOwner?: string, initialIdentity?: OfflineIdentityMetadata): Promise<void> {
  if (loggingOut || getLogoutFence()?.inProgress) return Promise.reject(new Error('Cierre de sesión en curso'))
  const active = getBrowserIdentity()
  // A server document can have been requested before another tab changed
  // accounts. Never let such a stale bootstrap replace a current identity.
  const bootstrap = initialIdentity && (!active || (active.ownerId === initialIdentity.ownerId && active.sessionId === initialIdentity.sessionId)) ? initialIdentity : undefined
  if (bootstrap && !active) {
    lifecycle += 1
    coordinator?.value.cancel()
    coordinator = null
  }
  const generation = lifecycle
  if (initialIdentity || !initializing || initializing.generation !== generation) {
    const job = { generation, promise: bootstrap ? Promise.resolve(bootstrap) : verifiedSession() }
    initializing = job
    void job.promise.finally(() => { if (initializing === job) initializing = null }).catch(() => {})
  }
  // Share the HTTP verification, never another caller's expected identity.
  return initializing.promise.then(async (session) => {
    if (generation !== lifecycle) throw new Error('La sesión cambió')
    const active = getBrowserIdentity()
    if (expectedOwner && session.ownerId !== expectedOwner) {
      if (active && active.ownerId !== session.ownerId) revokeLocalAccess()
      throw new Error('La cuenta activa cambió')
    }
    if (generation !== lifecycle) throw new Error('La sesión cambió')
    await browserLock('identity', async () => {
      if (generation !== lifecycle || loggingOut) throw new Error('La sesión cambió')
      checkFence(session)
      await activateBrowserOwner(session.ownerId, session.expiresAt, () => generation === lifecycle && !loggingOut && !getLogoutFence()?.inProgress, session.sessionId)
    })
  })
}

function browserLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  if (!navigator.locks) return Promise.reject(new Error('Este navegador no permite coordinar el modo offline entre pestañas'))
  return navigator.locks.request(`adan-offline-${name}`, work)
}

function getCoordinator(): Coordinator {
  const identity = getBrowserIdentity()
  if (!identity) throw new Error('La sesión offline no está preparada o venció')
  if (coordinator?.epoch === identity.epoch) return coordinator.value
  coordinator?.value.cancel()
  const value = createOfflineCoordinator({
    ownerId: identity.ownerId,
    receipts: createBrowserSyncReceipts(identity.ownerId, identity.epoch),
    store: createBrowserOrderStore(),
    isActive: () => getBrowserIdentity()?.epoch === identity.epoch,
    lock: (work) => browserLock('work', work),
    revision: () => localStorage.getItem(REVISION_KEY) ?? '',
    verify: async (signal) => {
      const session = await verifiedSession(signal)
      if (session.ownerId !== identity.ownerId) { if (getBrowserIdentity()?.epoch === identity.epoch) revokeLocalAccess(); return null }
      if (getBrowserIdentity()?.epoch !== identity.epoch) return null
      checkFence(session)
      await activateBrowserOwner(session.ownerId, session.expiresAt, () => getBrowserIdentity()?.epoch === identity.epoch, session.sessionId)
      return session.ownerId
    },
    fetchSnapshot: async (signal) => {
      const response = await fetch('/api/orders/offline-snapshot', { cache: 'no-store', signal })
      if (!response.ok) {
        if ((response.status === 401 || response.status === 403) && getBrowserIdentity()?.epoch === identity.epoch) revokeLocalAccess()
        throw new Error('No se pudo preparar el snapshot offline')
      }
      const snapshot = await response.json()
      if (typeof snapshot?.ownerId === 'string' && snapshot.ownerId !== identity.ownerId && getBrowserIdentity()?.epoch === identity.epoch) revokeLocalAccess()
      return snapshot
    },
    onChange: changed,
  })
  coordinator = { epoch: identity.epoch, value }
  return value
}

export async function refreshOfflineSnapshot(): Promise<void> {
  if (!navigator.onLine) return
  await getCoordinator().refresh()
}

export async function invalidateBrowserSnapshot(): Promise<void> {
  if (!getBrowserIdentity()) return
  // Synchronous cross-tab revision fences a snapshot already in flight.
  localStorage.setItem(REVISION_KEY, crypto.randomUUID())
  await getCoordinator().invalidate()
  window.dispatchEvent(new Event('adan-offline-invalidated'))
}

async function postPending(pending: PendingCreate, signal: AbortSignal) {
  const response = await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pending.draft), signal })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) return { ok: false as const, error: String(Object.values(body.fieldErrors ?? {})[0] ?? body.error ?? 'No se pudo sincronizar la orden') }
  if (typeof body.id !== 'string' || !Number.isSafeInteger(body.order_number)) return { ok: false as const, error: 'Confirmación de orden incompleta; revisá antes de reintentar' }
  return { ok: true as const, order: { id: body.id, orderNumber: body.order_number } }
}

export async function syncBrowserPending(retryErrors = false): Promise<void> {
  if (!navigator.onLine || !getBrowserIdentity()) return
  await getCoordinator().sync(postPending, retryErrors)
}

export function observeOfflineIdentity(): () => void {
  const handle = (event: StorageEvent) => {
    if (event.key === IDENTITY_KEY) {
      if (event.oldValue && event.newValue) {
        try { if (JSON.parse(event.oldValue).epoch === JSON.parse(event.newValue).epoch) return } catch {}
      }
      lifecycle += 1
      coordinator?.value.cancel()
      coordinator = null
      window.dispatchEvent(new Event('adan-offline-identity'))
    }
    if (event.key === LOGOUT_FENCE_KEY && getLogoutFence()?.inProgress) revokeLocalAccess()
    if (event.key === CHANGE_KEY) window.dispatchEvent(new Event('adan-offline-sync'))
    if (event.key === REVISION_KEY && getBrowserIdentity()) {
      window.dispatchEvent(new Event('adan-offline-invalidated'))
    }
  }
  window.addEventListener('storage', handle)
  return () => window.removeEventListener('storage', handle)
}

export async function logoutOffline(): Promise<void> {
  const identity = getBrowserIdentity()
  loggingOut = true
  const previousFence = getLogoutFence()
  const revokedSessionIds = [...new Set([...(previousFence?.revokedSessionIds ?? []), previousFence?.sessionId, identity?.sessionId].filter((id): id is string => typeof id === 'string'))]
  localStorage.setItem(LOGOUT_FENCE_KEY, JSON.stringify({ inProgress: true, sessionId: identity?.sessionId ?? previousFence?.sessionId ?? null, revokedSessionIds }))
  revokeLocalAccess()
  await browserLock('identity', clearBrowserOrderStore)
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)
    if (key?.startsWith('adan-offline-receipt:')) localStorage.removeItem(key)
  }
  if ('caches' in window) {
    for (const name of await caches.keys()) if (name.startsWith('adan-order-pages-')) await caches.delete(name)
  }
}

export function completeOfflineLogout(): void {
  const fence = getLogoutFence()
  if (fence) localStorage.setItem(LOGOUT_FENCE_KEY, JSON.stringify({ ...fence, inProgress: false }))
  loggingOut = false
}

export async function prepareOfflineShell(): Promise<void> {
  if (!('serviceWorker' in navigator)) throw new Error('El navegador no admite el modo offline')
  const registration = await navigator.serviceWorker.register('/order-offline-sw.js', { updateViaCache: 'none' })
  if (!registration.installing && !registration.waiting) await registration.update()
  const worker = await waitForOfflineWorker(registration)
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel()
    const timeout = setTimeout(() => { channel.port1.close(); reject(new Error('La preparación offline no terminó')) }, 60_000)
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout)
      channel.port1.close()
      if (event.data?.type === 'OFFLINE_SHELL_PREPARED' && event.data.ok) resolve()
      else reject(new Error(event.data?.error ?? 'Preparación offline incompleta'))
    }
    worker.postMessage({ type: 'PREPARE_OFFLINE_SHELL' }, [channel.port2])
  })
}
