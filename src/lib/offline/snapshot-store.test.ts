import { describe, expect, it } from 'vitest'

import { createMemoryOrderStore } from './order-store'
import type { CachedOrder, OfflineSnapshot } from './types'

const order: CachedOrder = { id: 'a', orderNumber: 1, customerName: 'Ana', customerPhone: '1144445555', customerAddress: 'A', equipment: 'TV', accessories: '', reportedFault: '', resolution: '', budgetCents: 12345, status: 'received', receivedOn: '2026-11-14', pickedUpOn: null }
const snapshot = (orders: CachedOrder[]): OfflineSnapshot => ({ schemaVersion: 1, ownerId: 'memory-owner', windowStart: '2026-10-16', generatedAt: '2026-11-14T12:00:00Z', orders })

describe('atomic recent snapshot', () => {
  it('replaces deletions and changed customer identities, including empty snapshots', async () => {
    const store = createMemoryOrderStore()
    await store.replaceRecentSnapshot(snapshot([order]))
    expect((await store.getRecentSnapshot())?.orders).toEqual([order])
    await store.replaceRecentSnapshot(snapshot([{ ...order, customerName: 'Bea', customerPhone: '1155556666' }]))
    expect(await store.findCachedCustomer('1144445555')).toBeNull()
    expect(await store.findCachedCustomer('1155556666')).toMatchObject({ customerName: 'Bea' })
    await store.replaceRecentSnapshot(snapshot([]))
    expect(await store.getOrder('a')).toBeNull()
    expect((await store.getRecentSnapshot())?.orders).toEqual([])
  })
  it('rejects incomplete or another owner snapshot without losing previous data or pending queue', async () => {
    const store = createMemoryOrderStore()
    await store.replaceRecentSnapshot(snapshot([order]))
    await store.enqueueCreate({ localId: 'p', createdAt: '', draft: {} })
    await expect(store.replaceRecentSnapshot({ ...snapshot([]), ownerId: 'other' })).rejects.toThrow()
    await expect(store.replaceRecentSnapshot({ ...snapshot([order]), orders: [{ id: 'incomplete' } as CachedOrder] })).rejects.toThrow()
    expect(await store.getOrder('a')).toEqual(order)
    expect(await store.listPending()).toHaveLength(1)
  })
  it('invalidates metadata while retaining usable data and preserves cents on sync', async () => {
    const store = createMemoryOrderStore()
    await store.replaceRecentSnapshot(snapshot([order]))
    await store.invalidateSnapshot()
    expect(await store.getSnapshotFreshness()).toBe(0)
    expect(await store.getOrder('a')).toEqual(order)
    await store.enqueueCreate({ localId: 'p', createdAt: '2026-11-14', draft: { customerName: 'B', equipment: 'Radio', budget: '123,45' } })
    await store.replacePendingWithPersisted('p', { id: 'b', orderNumber: 2 })
    expect(await store.getOrder('b')).toMatchObject({ budgetCents: 12345 })
  })
})
