import { describe, expect, it, vi } from 'vitest'

import { createMemoryOrderStore } from './order-store'
import { syncPendingOrders } from './sync'
import type { SyncReceipt, SyncReceipts } from './sync-receipts'

const pending = { localId: 'p', createdAt: '', draft: { customerName: 'Synthetic', equipment: 'TV' } }

function receiptJournal(): SyncReceipts {
  const entries = new Map<string, SyncReceipt>()
  return {
    async read(id) { return entries.get(id) ?? null },
    async reserve(id) { entries.set(id, { state: 'sending' }) },
    async confirm(id, order) { entries.set(id, { state: 'confirmed', order }) },
    async remove(id) { entries.delete(id) },
  }
}

const quota = () => new DOMException('Full', 'QuotaExceededError')
const official = { id: 'official', orderNumber: 123 }

describe('sync retry and logout', () => {
  it('does not automatically resend application errors, but supports explicit retry', async () => {
    const store = createMemoryOrderStore()
    await store.enqueueCreate(pending)
    await store.markSyncFailure('p', 'Invalid')
    const post = vi.fn(async () => ({ ok: true as const, order: { id: 'official', orderNumber: 1 } }))
    await syncPendingOrders(store, post)
    expect(post).not.toHaveBeenCalled()
    await syncPendingOrders(store, post, { retryErrors: true })
    expect(post).toHaveBeenCalledTimes(1)
    expect(await store.listPending()).toEqual([])
  })
  it('does not commit a late server confirmation after logout or send the next item', async () => {
    const store = createMemoryOrderStore()
    await store.enqueueCreate(pending)
    await store.enqueueCreate({ ...pending, localId: 'second' })
    let active = true
    const post = vi.fn(async () => { active = false; return { ok: true as const, order: { id: 'official', orderNumber: 1 } } })
    await syncPendingOrders(store, post, { isActive: () => active })
    expect(post).toHaveBeenCalledTimes(1)
    expect(await store.listPending()).toHaveLength(2)
    expect(await store.getOrder('official')).toBeNull()
  })

  it.each([false, true])('keeps an acknowledged id when both local writes fail, retryErrors=%s', async (retryErrors) => {
    const store = createMemoryOrderStore()
    await store.enqueueCreate({ ...pending, draft: { ...pending.draft, budget: '123,45' } })
    const replace = vi.spyOn(store, 'replacePendingWithPersisted').mockRejectedValueOnce(quota())
    const mark = vi.spyOn(store, 'markSyncFailure').mockRejectedValueOnce(quota())
    const post = vi.fn(async () => ({ ok: true as const, order: official }))

    await syncPendingOrders(store, post).catch(() => {})
    expect(await store.getPending('p')).not.toBeNull()
    replace.mockRestore()
    mark.mockRestore()
    await syncPendingOrders(store, post, { retryErrors })

    expect(post).toHaveBeenCalledTimes(1)
    expect(await store.listPending()).toEqual([])
    expect(await store.takePersistedForPending('p')).toEqual(official)
    expect(await store.getOrder('official')).toMatchObject({ budgetCents: 12345 })
  })

  it('does not POST if an async receipt reservation fails', async () => {
    const store = createMemoryOrderStore()
    await store.enqueueCreate(pending)
    const receipts = receiptJournal()
    receipts.reserve = async () => { throw quota() }
    const post = vi.fn(async () => ({ ok: true as const, order: official }))

    const result = await syncPendingOrders(store, post, { receipts })

    expect(post).not.toHaveBeenCalled()
    expect(result.failed).toBe(1)
    expect(await store.getPending('p')).not.toBeNull()
  })

  it('recovers a confirmed receipt before skipping an existing sync error', async () => {
    const store = createMemoryOrderStore()
    await store.enqueueCreate({ ...pending, syncError: 'Full' })
    const receipts = receiptJournal()
    await receipts.confirm('p', official)
    const post = vi.fn(async () => ({ ok: true as const, order: { id: 'duplicate', orderNumber: 124 } }))

    await syncPendingOrders(store, post, { receipts })

    expect(post).not.toHaveBeenCalled()
    expect(await store.listPending()).toEqual([])
    expect(await store.takePersistedForPending('p')).toEqual(official)
    expect(await receipts.read('p')).toBeNull()
  })

  it('keeps the receipt until IndexedDB replacement is durable', async () => {
    const store = createMemoryOrderStore()
    await store.enqueueCreate(pending)
    const receipts = receiptJournal()
    const replace = store.replacePendingWithPersisted.bind(store)
    store.replacePendingWithPersisted = async (id, order) => {
      expect(await receipts.read(id)).toEqual({ state: 'confirmed', order: official })
      expect(await store.getPending(id)).not.toBeNull()
      await replace(id, order)
    }
    await syncPendingOrders(store, async () => {
      expect(await receipts.read('p')).toEqual({ state: 'sending' })
      return { ok: true, order: official }
    }, { receipts })
    expect(await receipts.read('p')).toBeNull()
    expect(await store.takePersistedForPending('p')).toEqual(official)
  })

  it('retains the known official id even if writing its receipt also fails', async () => {
    const store = createMemoryOrderStore()
    await store.enqueueCreate(pending)
    const receipts = receiptJournal()
    const confirm = receipts.confirm.bind(receipts)
    receipts.confirm = async () => { throw quota() }
    const post = vi.fn(async () => ({ ok: true as const, order: official }))

    await syncPendingOrders(store, post, { receipts }).catch(() => {})
    expect(await receipts.read('p')).toEqual({ state: 'sending' })
    receipts.confirm = confirm
    await syncPendingOrders(store, post, { receipts, retryErrors: true })

    expect(post).toHaveBeenCalledTimes(1)
    expect(await store.takePersistedForPending('p')).toEqual(official)
  })

  it('does not automatically resend an uncertain reservation, even if marking the error fails', async () => {
    const store = createMemoryOrderStore()
    await store.enqueueCreate(pending)
    const receipts = receiptJournal()
    await receipts.reserve('p')
    vi.spyOn(store, 'markSyncFailure').mockRejectedValue(quota())
    const post = vi.fn(async () => ({ ok: true as const, order: official }))

    await syncPendingOrders(store, post, { receipts }).catch(() => {})
    await syncPendingOrders(store, post, { receipts }).catch(() => {})

    expect(post).not.toHaveBeenCalled()
    expect(await receipts.read('p')).toEqual({ state: 'sending' })
  })

  it('allows only explicit uncertain retries and reports the duplicate-risk warning', async () => {
    const store = createMemoryOrderStore()
    await store.enqueueCreate(pending)
    const receipts = receiptJournal()
    await receipts.reserve('p')
    const post = vi.fn(async () => ({ ok: true as const, order: official }))

    const result = await syncPendingOrders(store, post, { receipts, retryErrors: true })

    expect(post).toHaveBeenCalledTimes(1)
    expect(result.warnings).toEqual([expect.stringMatching(/duplicad/i)])
    expect(await store.listPending()).toEqual([])
  })

  it('clears only network-failed reservations so ordinary network retry still works', async () => {
    const store = createMemoryOrderStore()
    await store.enqueueCreate(pending)
    const receipts = receiptJournal()
    const post = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true, order: official })

    expect(await syncPendingOrders(store, post, { receipts })).toMatchObject({ stoppedForNetwork: true })
    expect(await receipts.read('p')).toBeNull()
    await syncPendingOrders(store, post, { receipts })

    expect(post).toHaveBeenCalledTimes(2)
    expect(await store.listPending()).toEqual([])
  })

  it('does not treat a local persistence TypeError as a failed network request', async () => {
    const store = createMemoryOrderStore()
    await store.enqueueCreate(pending)
    const receipts = receiptJournal()
    vi.spyOn(store, 'replacePendingWithPersisted').mockRejectedValueOnce(new TypeError('Local persistence failed'))
    const post = vi.fn(async () => ({ ok: true as const, order: official }))

    const result = await syncPendingOrders(store, post, { receipts })
    expect(result.stoppedForNetwork).toBe(false)
    expect(await receipts.read('p')).toEqual({ state: 'confirmed', order: official })
    await syncPendingOrders(store, post, { receipts })
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('retains a reservation if persisting an application failure fails', async () => {
    const store = createMemoryOrderStore()
    await store.enqueueCreate(pending)
    const receipts = receiptJournal()
    const mark = vi.spyOn(store, 'markSyncFailure').mockRejectedValue(quota())
    const post = vi.fn(async () => ({ ok: false as const, error: 'Invalid' }))

    await syncPendingOrders(store, post, { receipts }).catch(() => {})
    mark.mockRestore()
    await syncPendingOrders(store, post, { receipts })

    expect(post).toHaveBeenCalledTimes(1)
    expect(await receipts.read('p')).toEqual({ state: 'sending' })
  })
})
