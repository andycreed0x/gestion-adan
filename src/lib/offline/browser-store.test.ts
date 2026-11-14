/* @vitest-environment jsdom */
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { activateBrowserOwner, clearBrowserOrderStore, countQuarantinedPending, createBrowserOrderStore, getActiveBrowserOwner, suspendBrowserOwner } from './order-store'
import type { CachedOrder, OfflineSnapshot } from './types'

const order: CachedOrder = { id: 'a', orderNumber: 1, customerName: 'Synthetic Ana', customerPhone: '1144445555', customerAddress: '', equipment: 'TV', accessories: '', reportedFault: '', resolution: '', budgetCents: 12345, status: 'received', receivedOn: '2026-11-14', pickedUpOn: null }
const snapshot = (orders = [order]): OfflineSnapshot => ({ schemaVersion: 1, ownerId: 'a', windowStart: '2026-10-16', generatedAt: '2026-11-14T12:00:00Z', orders })
const expires = () => Date.now() + 3_600_000

beforeEach(() => { localStorage.clear(); vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('IDBKeyRange', IDBKeyRange) })

describe('browser identity and database', () => {
  it('scopes every read/write and rejects late writes after logout and user switch', async () => {
    await activateBrowserOwner('a', expires())
    const previous = createBrowserOrderStore()
    await previous.replaceRecentSnapshot(snapshot())
    await previous.enqueueCreate({ localId: 'p', createdAt: '', draft: {} })
    await clearBrowserOrderStore()
    expect(getActiveBrowserOwner()).toBeNull()
    await activateBrowserOwner('b', expires())
    const next = createBrowserOrderStore()
    expect(await next.getOrder('a')).toBeNull()
    expect(await next.listPending()).toEqual([])
    expect(await previous.getOrder('a')).toBeNull()
    await expect(previous.replaceRecentSnapshot(snapshot())).rejects.toThrow()
    await expect(previous.enqueueCreate({ localId: 'late', createdAt: '', draft: {} })).rejects.toThrow()
  })
  it('atomically replaces data including deletions without losing pending creates', async () => {
    await activateBrowserOwner('a', expires())
    const store = createBrowserOrderStore()
    await store.replaceRecentSnapshot(snapshot())
    await store.enqueueCreate({ localId: 'p', createdAt: '', draft: {} })
    await store.replaceRecentSnapshot(snapshot([]))
    expect(await store.getOrder('a')).toBeNull()
    expect(await store.findCachedCustomer('1144445555')).toBeNull()
    expect((await store.getRecentSnapshot())?.orders).toEqual([])
    expect(await store.listPending()).toHaveLength(1)
  })
  it('preserves previous snapshot after quota failure during the transaction', async () => {
    await activateBrowserOwner('a', expires())
    const store = createBrowserOrderStore()
    await store.replaceRecentSnapshot(snapshot())
    const original = IDBObjectStore.prototype.put
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: InstanceType<typeof IDBObjectStore>, value, key) {
      if (value?.value?.id === 'fail') throw new DOMException('Full', 'QuotaExceededError')
      return original.call(this, value, key)
    })
    await expect(store.replaceRecentSnapshot(snapshot([{ ...order, id: 'fail' }]))).rejects.toThrow('Full')
    spy.mockRestore()
    expect(await store.getOrder('a')).toEqual(order)
    expect((await store.getRecentSnapshot())?.orders).toEqual([order])
  })
  it('upgrades v2 without auto-assigning or sending unowned legacy pending records', async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('adan-orders-v1', 2)
      req.onupgradeneeded = () => {
        req.result.createObjectStore('pendingCreates', { keyPath: 'localId' }).put({ localId: 'legacy', createdAt: '', draft: { customerName: 'Legacy synthetic' } })
        req.result.createObjectStore('orders', { keyPath: 'id' }).put(order)
      }
      req.onsuccess = () => resolve(req.result)
    })
    db.close()
    await activateBrowserOwner('a', expires())
    expect(await createBrowserOrderStore().listPending()).toEqual([])
    expect(await countQuarantinedPending()).toBe(1)
    await clearBrowserOrderStore()
    expect(await countQuarantinedPending()).toBe(1)
  })
  it('rejects writes after expiry but keeps pending data when same verified account renews', async () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    await activateBrowserOwner('a', now + 100)
    const store = createBrowserOrderStore()
    await store.enqueueCreate({ localId: 'p', createdAt: '', draft: {} })
    vi.mocked(Date.now).mockReturnValue(now + 101)
    expect(getActiveBrowserOwner()).toBeNull()
    await expect(store.enqueueCreate({ localId: 'bad', createdAt: '', draft: {} })).rejects.toThrow()
    await activateBrowserOwner('a', now + 10_000)
    expect(await createBrowserOrderStore().listPending()).toHaveLength(1)
    vi.restoreAllMocks()
  })
  it('cancels activation that was overtaken by logout', async () => {
    let current = true
    const activation = activateBrowserOwner('a', expires(), () => current)
    current = false
    suspendBrowserOwner()
    await expect(activation).rejects.toThrow()
    expect(getActiveBrowserOwner()).toBeNull()
  })
})
