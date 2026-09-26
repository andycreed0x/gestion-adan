import { describe, expect, it } from 'vitest'

import { createMemoryOrderStore } from './order-store'

const pending = {
  localId: 'local-1',
  createdAt: '2026-09-26T10:00:00.000Z',
  draft: { customerName: 'Ana', customerPhone: '11 4444-5555', equipment: 'TV' },
}

describe('offline order store', () => {
  it('keeps pending creates in FIFO order and removes only a persisted one', async () => {
    const store = createMemoryOrderStore()
    await store.enqueueCreate({ ...pending, localId: 'local-2', createdAt: '2026-09-26T11:00:00.000Z' })
    await store.enqueueCreate(pending)

    expect((await store.listPending()).map((item) => item.localId)).toEqual(['local-1', 'local-2'])

    await store.replacePendingWithPersisted('local-1', { id: 'server-1', orderNumber: 9380 })

    expect(await store.getPending('local-1')).toBeNull()
    expect((await store.listPending()).map((item) => item.localId)).toEqual(['local-2'])
    expect(await store.takePersistedForPending('local-1')).toEqual({ id: 'server-1', orderNumber: 9380 })
    expect(await store.takePersistedForPending('local-1')).toBeNull()
  })

  it('looks up a cached customer by canonical phone and clears all private data', async () => {
    const store = createMemoryOrderStore()
    await store.putOrder({
      id: 'server-1', orderNumber: 9380, customerName: 'Ana', customerAddress: 'Rivadavia 123', customerPhone: '11 4444-5555',
      equipment: 'TV', accessories: '', reportedFault: '', resolution: '', budgetCents: null, status: 'received', receivedOn: '2026-09-26', pickedUpOn: null,
    })
    await store.enqueueCreate(pending)

    expect(await store.findCachedCustomer('+54 9 11 4444-5555')).toMatchObject({ customerName: 'Ana', customerAddress: 'Rivadavia 123' })

    await store.clear()

    expect(await store.findCachedCustomer('11 4444-5555')).toBeNull()
    expect(await store.listPending()).toEqual([])
  })
})
