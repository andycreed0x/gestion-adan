import { normalizeArgentinePhone } from '../customer-phone'
import { orderStatuses, parseBudgetCents, type OrderStatus } from '../order-values'

import type { CachedCustomer, CachedOrder, OfflineSnapshot, OrderStore, PendingCreate, PersistedOrder } from './types'

const DATABASE_NAME = 'adan-orders-v1'
const DATABASE_VERSION = 3
const RECORDS = 'privateOrders'
const PENDING = 'privatePending'
const SYNCED = 'privateSynced'
const META = 'privateMetadata'
const PRIVATE_STORES = [RECORDS, PENDING, SYNCED, META]
export const IDENTITY_KEY = 'adan-offline-identity-v1'
export const LOGOUT_FENCE_KEY = 'adan-offline-logout-fence'
export const INVALIDATION_KEY = 'adan-offline-invalidation'
export type BrowserIdentity = { ownerId: string; epoch: string; expiresAt: number; sessionId?: string }

function storedBrowserIdentity(): BrowserIdentity | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const value = JSON.parse(localStorage.getItem(IDENTITY_KEY) ?? 'null')
    return value && typeof value.ownerId === 'string' && typeof value.epoch === 'string' && typeof value.expiresAt === 'number' ? value : null
  } catch { return null }
}

export function getBrowserIdentity(): BrowserIdentity | null {
  const identity = storedBrowserIdentity()
  const fence = getLogoutFence()
  return identity && identity.expiresAt > Date.now() && !fence?.inProgress && !(identity.sessionId && (fence?.sessionId === identity.sessionId || fence?.revokedSessionIds?.includes(identity.sessionId))) ? identity : null
}

export function getLogoutFence(): { inProgress: boolean; sessionId: string | null; revokedSessionIds?: string[] } | null {
  try { return JSON.parse(localStorage.getItem(LOGOUT_FENCE_KEY) ?? 'null') } catch { return null }
}

export function getActiveBrowserOwner(): string | null { return getBrowserIdentity()?.ownerId ?? null }

function identityEvent() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('adan-offline-identity'))
}

// Remove identity synchronously, before waiting for network/IndexedDB/locks.
export function suspendBrowserOwner() {
  localStorage.removeItem(IDENTITY_KEY)
  identityEvent()
}

export async function activateBrowserOwner(ownerId: string, expiresAt: number, isCurrent: () => boolean = () => true, sessionId?: string): Promise<void> {
  if (!ownerId || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('La sesión venció')
  const previous = storedBrowserIdentity()
  if (previous?.ownerId !== ownerId) {
    suspendBrowserOwner()
    // A revoked/expired identity is not an explicit logout. Keep owner-scoped
    // unsent work for verified reauthentication, never expose it to another owner.
    const database = await openDatabase()
    database.close()
  }
  if (!isCurrent()) throw new Error('La sesión cambió durante la preparación')
  localStorage.setItem(IDENTITY_KEY, JSON.stringify({ ownerId, expiresAt, sessionId: sessionId ?? previous?.sessionId, epoch: previous?.ownerId === ownerId ? previous.epoch : crypto.randomUUID() }))
  identityEvent()
}

export function validateSnapshot(snapshot: OfflineSnapshot, ownerId: string): void {
  if (snapshot?.schemaVersion !== 1 || snapshot.ownerId !== ownerId || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.windowStart) || !Number.isFinite(Date.parse(snapshot.generatedAt)) || !Array.isArray(snapshot.orders)) throw new Error('Snapshot incompleto o de otra cuenta')
  const ids = new Set<string>()
  for (const order of snapshot.orders) {
    if (!order || typeof order.id !== 'string' || !order.id || ids.has(order.id) || !Number.isSafeInteger(order.orderNumber) || !orderStatuses.includes(order.status) || !['customerName', 'customerAddress', 'customerPhone', 'equipment', 'accessories', 'reportedFault', 'resolution', 'receivedOn'].every((key) => typeof order[key as keyof CachedOrder] === 'string') || !(order.pickedUpOn === null || typeof order.pickedUpOn === 'string') || !(order.budgetCents === null || Number.isSafeInteger(order.budgetCents))) throw new Error('Orden incompleta en snapshot')
    ids.add(order.id)
  }
}

function customerFromOrder(order: CachedOrder): CachedCustomer | null {
  const phoneNormalized = normalizeArgentinePhone(order.customerPhone)
  return phoneNormalized ? { phoneNormalized, customerName: order.customerName, customerAddress: order.customerAddress, customerPhone: order.customerPhone } : null
}

function orderFromPending(pending: PendingCreate, persisted: PersistedOrder): CachedOrder {
  const draft = pending.draft
  let budgetCents: number | null = null
  try { budgetCents = parseBudgetCents(draft.budget ?? '') } catch {}
  return {
    ...persisted, customerName: draft.customerName ?? '', customerAddress: draft.customerAddress ?? '', customerPhone: draft.customerPhone ?? '',
    equipment: draft.equipment ?? '', accessories: draft.accessories ?? '', reportedFault: draft.reportedFault ?? '', resolution: draft.resolution ?? '',
    budgetCents,
    status: orderStatuses.includes(draft.status as OrderStatus) ? draft.status as OrderStatus : 'received', receivedOn: draft.receivedOn ?? pending.createdAt.slice(0, 10), pickedUpOn: draft.pickedUpOn || null,
  }
}

export function createMemoryOrderStore(ownerId = 'memory-owner'): OrderStore {
  const orders = new Map<string, CachedOrder>()
  const pending = new Map<string, PendingCreate>()
  const synced = new Map<string, PersistedOrder>()
  let snapshot: OfflineSnapshot | null = null
  let freshness = 0
  return {
    async getRecentSnapshot() { return snapshot ? structuredClone(snapshot) : null },
    async replaceRecentSnapshot(value) {
      validateSnapshot(value, ownerId)
      const copy = structuredClone(value)
      orders.clear()
      for (const order of copy.orders) orders.set(order.id, order)
      snapshot = copy
      freshness = Date.now()
    },
    async getSnapshotFreshness() { return freshness },
    async invalidateSnapshot() { freshness = 0 },
    async putRecentPage(records) { for (const order of records) await this.putOrder(order) },
    async putOrder(order) { orders.set(order.id, structuredClone(order)) },
    async getOrder(id) { return orders.get(id) ?? null },
    async findCachedCustomer(phone) {
      const normalized = normalizeArgentinePhone(phone)
      return [...orders.values()].map(customerFromOrder).find((customer) => customer && customer.phoneNormalized === normalized) ?? null
    },
    async enqueueCreate(item) { pending.set(item.localId, { ...item, syncError: item.syncError ?? null }) },
    async getPending(id) { return pending.get(id) ?? null },
    async listPending() { return [...pending.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) },
    async replacePendingWithPersisted(id, persisted) {
      const item = pending.get(id)
      if (!item) return
      orders.set(persisted.id, orderFromPending(item, persisted))
      pending.delete(id)
      synced.set(id, persisted)
      freshness = 0
    },
    async takePersistedForPending(id) { const value = synced.get(id) ?? null; synced.delete(id); return value },
    async markSyncFailure(id, message) { const item = pending.get(id); if (item) pending.set(id, { ...item, syncError: message }) },
    async clear() { orders.clear(); pending.clear(); synced.clear(); snapshot = null; freshness = 0 },
  }
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
}
function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error ?? new Error('Transacción cancelada')) })
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of PRIVATE_STORES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'key' })
      // Legacy pendingCreates is deliberately quarantined, never assigned to an account.
      for (const name of ['orders', 'customers', 'syncedPendingCreates']) {
        if (db.objectStoreNames.contains(name)) request.transaction!.objectStore(name).clear()
      }
    }
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result) }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Cerrá las otras pestañas para actualizar el almacenamiento offline'))
  })
}

async function clearPrivateDatabase() {
  if (typeof indexedDB === 'undefined') return
  const db = await openDatabase()
  try {
    const tx = db.transaction(PRIVATE_STORES, 'readwrite')
    const completion = done(tx)
    for (const name of PRIVATE_STORES) tx.objectStore(name).clear()
    await completion
  } finally { db.close() }
}

export function createBrowserOrderStore(): OrderStore {
  const identity = getBrowserIdentity()
  const valid = () => {
    const active = getBrowserIdentity()
    return Boolean(identity && active?.ownerId === identity.ownerId && active.epoch === identity.epoch)
  }
  const assertActive = () => { if (!valid()) throw new Error('La sesión offline cambió o venció. Iniciá sesión nuevamente.') }
  const ownerId = identity?.ownerId ?? ''
  const key = (id: string): string[] => [ownerId, id]
  const transaction = async <T>(names: string[], write: boolean, operation: (tx: IDBTransaction) => Promise<T> | T, fallback: T): Promise<T> => {
    if (!write && !valid()) return fallback
    assertActive()
    const db = await openDatabase()
    try {
      assertActive()
      const tx = db.transaction(names, write ? 'readwrite' : 'readonly')
      const completion = done(tx)
      // Observe aborts immediately, including synchronous quota failures below.
      void completion.catch(() => {})
      try {
        const value = await operation(tx)
        await completion
        if (!write && !valid()) return fallback
        return value
      } catch (error) { try { tx.abort() } catch {} throw error }
    } finally { db.close() }
  }
  const read = <T>(name: string, id: string) => transaction([name], false, async (tx) => (await result(tx.objectStore(name).get(key(id))))?.value as T ?? null, null)
  const write = (name: string, id: string, value: unknown) => transaction([name], true, (tx) => { tx.objectStore(name).put({ key: key(id), value }) }, undefined)
  const all = <T>(name: string) => transaction([name], false, async (tx) => (await result(tx.objectStore(name).getAll(IDBKeyRange.bound([ownerId], [ownerId, []])))).map((record) => record.value as T), [] as T[])
  const store: OrderStore = {
    async getRecentSnapshot() { return read<OfflineSnapshot>(META, 'snapshot') },
    async getSnapshotFreshness() {
      const revision = await read<string>(META, 'revision')
      return revision === (localStorage.getItem(INVALIDATION_KEY) ?? '') ? (await read<number>(META, 'freshness')) ?? 0 : 0
    },
    async invalidateSnapshot() { await write(META, 'freshness', 0) },
    async replaceRecentSnapshot(snapshot) {
      validateSnapshot(snapshot, ownerId)
      await transaction([RECORDS, META], true, (tx) => {
        tx.objectStore(RECORDS).delete(IDBKeyRange.bound([ownerId], [ownerId, []]))
        for (const order of snapshot.orders) tx.objectStore(RECORDS).put({ key: key(order.id), value: order })
        tx.objectStore(META).put({ key: key('snapshot'), value: snapshot })
        tx.objectStore(META).put({ key: key('freshness'), value: Date.now() })
        tx.objectStore(META).put({ key: key('revision'), value: localStorage.getItem(INVALIDATION_KEY) ?? '' })
      }, undefined)
    },
    async putRecentPage(orders) { for (const order of orders) await store.putOrder(order) },
    async putOrder(order) { await write(RECORDS, order.id, order) },
    async getOrder(id) { return read<CachedOrder>(RECORDS, id) },
    async findCachedCustomer(phone) {
      const normalized = normalizeArgentinePhone(phone)
      return (await all<CachedOrder>(RECORDS)).map(customerFromOrder).find((customer) => customer && customer.phoneNormalized === normalized) ?? null
    },
    async enqueueCreate(pending) { await write(PENDING, pending.localId, { ...pending, syncError: pending.syncError ?? null }) },
    async getPending(id) { return read<PendingCreate>(PENDING, id) },
    async listPending() { return (await all<PendingCreate>(PENDING)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) },
    async replacePendingWithPersisted(id, persisted) {
      await transaction([PENDING, RECORDS, SYNCED, META], true, async (tx) => {
        const pending = (await result(tx.objectStore(PENDING).get(key(id))))?.value as PendingCreate | undefined
        if (!pending) return
        assertActive()
        tx.objectStore(PENDING).delete(key(id))
        tx.objectStore(SYNCED).put({ key: key(id), value: persisted })
        tx.objectStore(RECORDS).put({ key: key(persisted.id), value: orderFromPending(pending, persisted) })
        tx.objectStore(META).put({ key: key('freshness'), value: 0 })
      }, undefined)
    },
    async takePersistedForPending(id) {
      return transaction([SYNCED], true, async (tx) => {
        const record = await result(tx.objectStore(SYNCED).get(key(id)))
        tx.objectStore(SYNCED).delete(key(id))
        return (record?.value as PersistedOrder) ?? null
      }, null)
    },
    async markSyncFailure(id, message) { const pending = await store.getPending(id); if (pending) await write(PENDING, id, { ...pending, syncError: message }) },
    async clear() {
      await transaction(PRIVATE_STORES, true, (tx) => {
        for (const name of PRIVATE_STORES) tx.objectStore(name).delete(IDBKeyRange.bound([ownerId], [ownerId, []]))
      }, undefined)
    },
  }
  return store
}

export async function clearBrowserOrderStore(): Promise<void> {
  suspendBrowserOwner()
  await clearPrivateDatabase()
}

export async function countQuarantinedPending(): Promise<number> {
  const db = await openDatabase()
  try {
    if (!db.objectStoreNames.contains('pendingCreates')) return 0
    const tx = db.transaction('pendingCreates', 'readonly')
    return await result(tx.objectStore('pendingCreates').count())
  } finally { db.close() }
}
