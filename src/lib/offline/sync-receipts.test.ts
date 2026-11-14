/* @vitest-environment jsdom */
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { activateBrowserOwner, createBrowserOrderStore, createMemoryOrderStore } from './order-store'
import { syncPendingOrders } from './sync'
import { createBrowserSyncReceipts } from './sync-receipts'

const official = { id: 'official', orderNumber: 123 }
const pending = { localId: 'p', createdAt: '2026-11-14', draft: { customerName: 'Synthetic', equipment: 'TV', budget: '123,45' } }
const key = 'adan-offline-receipt:a:p'

beforeEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
})

describe('browser sync receipts', () => {
  it('reserves space before sending and replaces it with a smaller reloadable confirmation', async () => {
    const receipts = createBrowserSyncReceipts('a', 'epoch-a')
    await receipts.reserve('p')
    const reserved = localStorage.getItem(key)!
    expect(new TextEncoder().encode(reserved).byteLength).toBeGreaterThanOrEqual(1024)
    expect(await receipts.read('p')).toEqual({ state: 'sending' })

    await receipts.confirm('p', official)
    expect(localStorage.getItem(key)!.length).toBeLessThan(reserved.length)
    expect(await createBrowserSyncReceipts('a', 'epoch-a').read('p')).toEqual({ state: 'confirmed', order: official })
    await receipts.remove('p')
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('isolates owners but retains same-owner confirmations across epochs without allowing stale removal', async () => {
    const receipts = createBrowserSyncReceipts('a', 'epoch-a')
    await receipts.reserve('p')
    await receipts.confirm('p', official)
    expect(await createBrowserSyncReceipts('b', 'epoch-a').read('p')).toBeNull()
    const stale = createBrowserSyncReceipts('a', 'epoch-stale')
    expect(await stale.read('p')).toEqual({ state: 'confirmed', order: official })
    await stale.remove('p')
    expect(await receipts.read('p')).toEqual({ state: 'confirmed', order: official })
    expect(await Promise.allSettled([Promise.resolve().then(() => stale.reserve('p'))])).toMatchObject([{ status: 'rejected' }])
  })

  it('fails closed on a corrupted receipt instead of permitting a blind resend', async () => {
    localStorage.setItem(key, '{broken')
    const store = { ...createBrowserOrderStore(), listPending: async () => [pending], markSyncFailure: async () => {} }
    const post = vi.fn(async () => ({ ok: true as const, order: official }))
    await syncPendingOrders(store, post, { receipts: createBrowserSyncReceipts('a', 'epoch-a') })
    expect(post).not.toHaveBeenCalled()
    expect(localStorage.getItem(key)).toBe('{broken')
  })

  it.each([false, true])('recovers the receipt in a new epoch after both IDB writes hit quota, explicit=%s', async (retryErrors) => {
    await activateBrowserOwner('a', Date.now() + 3_600_000)
    const store = createBrowserOrderStore()
    await store.enqueueCreate(pending)
    const receipts = createBrowserSyncReceipts('a', 'epoch-a')
    const original = IDBObjectStore.prototype.put
    const failWrites = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function () {
      throw new DOMException('Full', 'QuotaExceededError')
    })
    const post = vi.fn(async () => ({ ok: true as const, order: official }))

    await syncPendingOrders(store, post, { receipts }).catch(() => {})
    expect(await receipts.read('p')).toEqual({ state: 'confirmed', order: official })
    expect(await store.getPending('p')).toMatchObject({ syncError: null })
    failWrites.mockImplementation(original)
    const reloadedStore = createBrowserOrderStore()
    await syncPendingOrders(reloadedStore, post, { receipts: createBrowserSyncReceipts('a', 'epoch-renewed'), retryErrors })

    expect(post).toHaveBeenCalledTimes(1)
    expect(await reloadedStore.listPending()).toEqual([])
    expect(await reloadedStore.takePersistedForPending('p')).toEqual(official)
    expect(await reloadedStore.getOrder('official')).toMatchObject({ budgetCents: 12345 })
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('adopts a same-owner confirmed receipt before finalization even when the pending has a sync error', async () => {
    const old = createBrowserSyncReceipts('a', 'epoch-old')
    await old.reserve('p')
    await old.confirm('p', official)
    const store = createMemoryOrderStore()
    await store.enqueueCreate({ ...pending, syncError: 'Full' })
    const post = vi.fn(async () => ({ ok: true as const, order: { id: 'duplicate', orderNumber: 124 } }))

    const result = await syncPendingOrders(store, post, { receipts: createBrowserSyncReceipts('a', 'epoch-new') })

    expect(result.synced).toBe(1)
    expect(post).not.toHaveBeenCalled()
    expect(await store.takePersistedForPending('p')).toEqual(official)
    expect(await store.getOrder('official')).toMatchObject({ budgetCents: 12345 })
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('retains a same-owner sending receipt across epochs until a warned explicit retry', async () => {
    await createBrowserSyncReceipts('a', 'epoch-old').reserve('p')
    const store = createMemoryOrderStore()
    await store.enqueueCreate(pending)
    const receipts = createBrowserSyncReceipts('a', 'epoch-new')
    const post = vi.fn(async () => ({ ok: true as const, order: official }))

    await syncPendingOrders(store, post, { receipts })
    expect(post).not.toHaveBeenCalled()
    expect(await receipts.read('p')).toEqual({ state: 'sending' })
    expect(JSON.parse(localStorage.getItem(key)!).epoch).toBe('epoch-old')
    const result = await syncPendingOrders(store, post, { receipts, retryErrors: true })
    expect(result.warnings).toEqual([expect.stringMatching(/duplicad/i)])
    expect(post).toHaveBeenCalledTimes(1)
    expect(await store.takePersistedForPending('p')).toEqual(official)
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('never replaces an existing official id with a conflicting confirmation during adoption', async () => {
    const old = createBrowserSyncReceipts('a', 'epoch-old')
    await old.reserve('p')
    await old.confirm('p', official)
    const renewed = createBrowserSyncReceipts('a', 'epoch-new')
    await expect(Promise.resolve().then(() => renewed.confirm('p', { id: 'different', orderNumber: 124 }))).rejects.toThrow()
    expect(await old.read('p')).toEqual({ state: 'confirmed', order: official })
    await renewed.confirm('p', official)
    await old.remove('p')
    expect(await renewed.read('p')).toEqual({ state: 'confirmed', order: official })
  })

  it('never POSTs when localStorage cannot reserve space', async () => {
    await activateBrowserOwner('a', Date.now() + 3_600_000)
    const store = createBrowserOrderStore()
    await store.enqueueCreate(pending)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    const post = vi.fn(async () => ({ ok: true as const, order: official }))

    await syncPendingOrders(store, post, { receipts: createBrowserSyncReceipts('a', 'epoch-a') })

    expect(post).not.toHaveBeenCalled()
    expect(await store.getPending('p')).not.toBeNull()
  })
})
