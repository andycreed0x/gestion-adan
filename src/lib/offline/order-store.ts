import { normalizeArgentinePhone } from '../customer-phone'
import type { OrderStatus } from '../orders'

import type { CachedCustomer, CachedOrder, OrderStore, PendingCreate, PersistedOrder } from './types'

const DATABASE_NAME = 'adan-orders-v1'
const DATABASE_VERSION = 1
const ORDER_STORE = 'orders'
const CUSTOMER_STORE = 'customers'
const PENDING_STORE = 'pendingCreates'

function customerFromOrder(order: CachedOrder): CachedCustomer | null {
  const phoneNormalized = normalizeArgentinePhone(order.customerPhone)
  return phoneNormalized ? {
    phoneNormalized,
    customerName: order.customerName,
    customerAddress: order.customerAddress,
    customerPhone: order.customerPhone,
  } : null
}

function orderFromPending(pending: PendingCreate, persisted: PersistedOrder): CachedOrder {
  const draft = pending.draft
  return {
    id: persisted.id,
    orderNumber: persisted.orderNumber,
    customerName: draft.customerName ?? '',
    customerAddress: draft.customerAddress ?? '',
    customerPhone: draft.customerPhone ?? '',
    equipment: draft.equipment ?? '',
    accessories: draft.accessories ?? '',
    reportedFault: draft.reportedFault ?? '',
    resolution: draft.resolution ?? '',
    budgetCents: null,
    status: (draft.status as OrderStatus | undefined) ?? 'received',
    receivedOn: draft.receivedOn ?? pending.createdAt.slice(0, 10),
    pickedUpOn: draft.pickedUpOn || null,
  }
}

export function createMemoryOrderStore(): OrderStore {
  const orders = new Map<string, CachedOrder>()
  const customers = new Map<string, CachedCustomer>()
  const pendingCreates = new Map<string, PendingCreate>()

  return {
    async putRecentPage(records) { await Promise.all(records.map((record) => this.putOrder(record))) },
    async putOrder(order) {
      orders.set(order.id, order)
      const customer = customerFromOrder(order)
      if (customer) customers.set(customer.phoneNormalized, customer)
    },
    async getOrder(id) { return orders.get(id) ?? null },
    async findCachedCustomer(phone) {
      const normalized = normalizeArgentinePhone(phone)
      return normalized ? customers.get(normalized) ?? null : null
    },
    async enqueueCreate(pending) { pendingCreates.set(pending.localId, { ...pending, syncError: pending.syncError ?? null }) },
    async getPending(localId) { return pendingCreates.get(localId) ?? null },
    async listPending() { return [...pendingCreates.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt)) },
    async replacePendingWithPersisted(localId, persisted) {
      const pending = pendingCreates.get(localId)
      if (!pending) return
      pendingCreates.delete(localId)
      await this.putOrder(orderFromPending(pending, persisted))
    },
    async markSyncFailure(localId, message) {
      const pending = pendingCreates.get(localId)
      if (pending) pendingCreates.set(localId, { ...pending, syncError: message })
    },
    async clear() { orders.clear(); customers.clear(); pendingCreates.clear() },
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(ORDER_STORE)) database.createObjectStore(ORDER_STORE, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(CUSTOMER_STORE)) database.createObjectStore(CUSTOMER_STORE, { keyPath: 'phoneNormalized' })
      if (!database.objectStoreNames.contains(PENDING_STORE)) database.createObjectStore(PENDING_STORE, { keyPath: 'localId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export function createBrowserOrderStore(): OrderStore {
  const database = openDatabase()
  const read = async <T>(storeName: string, key: IDBValidKey): Promise<T | null> => {
    const db = await database
    const transaction = db.transaction(storeName, 'readonly')
    const result = await requestResult(transaction.objectStore(storeName).get(key) as IDBRequest<T | undefined>)
    await transactionDone(transaction)
    return result ?? null
  }
  const write = async (storeName: string, value: unknown) => {
    const db = await database
    const transaction = db.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).put(value)
    await transactionDone(transaction)
  }

  const store: OrderStore = {
    async putRecentPage(records) { await Promise.all(records.map((record) => store.putOrder(record))) },
    async putOrder(order) {
      await write(ORDER_STORE, order)
      const customer = customerFromOrder(order)
      if (customer) await write(CUSTOMER_STORE, customer)
    },
    async getOrder(id) { return read<CachedOrder>(ORDER_STORE, id) },
    async findCachedCustomer(phone) {
      const normalized = normalizeArgentinePhone(phone)
      return normalized ? read<CachedCustomer>(CUSTOMER_STORE, normalized) : null
    },
    async enqueueCreate(pending) { await write(PENDING_STORE, { ...pending, syncError: pending.syncError ?? null }) },
    async getPending(localId) { return read<PendingCreate>(PENDING_STORE, localId) },
    async listPending() {
      const db = await database
      const transaction = db.transaction(PENDING_STORE, 'readonly')
      const items = await requestResult(transaction.objectStore(PENDING_STORE).getAll() as IDBRequest<PendingCreate[]>)
      await transactionDone(transaction)
      return items.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    },
    async replacePendingWithPersisted(localId, persisted) {
      const pending = await store.getPending(localId)
      if (!pending) return
      const db = await database
      const transaction = db.transaction([PENDING_STORE, ORDER_STORE, CUSTOMER_STORE], 'readwrite')
      transaction.objectStore(PENDING_STORE).delete(localId)
      const order = orderFromPending(pending, persisted)
      transaction.objectStore(ORDER_STORE).put(order)
      const customer = customerFromOrder(order)
      if (customer) transaction.objectStore(CUSTOMER_STORE).put(customer)
      await transactionDone(transaction)
    },
    async markSyncFailure(localId, message) {
      const pending = await store.getPending(localId)
      if (pending) await write(PENDING_STORE, { ...pending, syncError: message })
    },
    async clear() {
      const db = await database
      const transaction = db.transaction([ORDER_STORE, CUSTOMER_STORE, PENDING_STORE], 'readwrite')
      for (const storeName of [ORDER_STORE, CUSTOMER_STORE, PENDING_STORE]) transaction.objectStore(storeName).clear()
      await transactionDone(transaction)
    },
  }

  return store
}

export async function clearBrowserOrderStore(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  await createBrowserOrderStore().clear()
}
