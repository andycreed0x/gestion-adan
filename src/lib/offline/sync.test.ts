import { describe, expect, it } from 'vitest'

import { createMemoryOrderStore } from './order-store'
import { syncPendingOrders } from './sync'

const first = { localId: 'first', createdAt: '2026-09-26T10:00:00.000Z', draft: { customerName: 'Ana', equipment: 'TV' } }
const second = { localId: 'second', createdAt: '2026-09-26T11:00:00.000Z', draft: { customerName: 'Bea', equipment: 'Radio' } }

describe('offline order synchronization', () => {
  it('persists FIFO items and removes them after a server confirmation', async () => {
    const store = createMemoryOrderStore()
    await store.enqueueCreate(second)
    await store.enqueueCreate(first)
    const sent: string[] = []

    const result = await syncPendingOrders(store, async (item) => {
      sent.push(item.localId)
      return { ok: true, order: { id: `server-${item.localId}`, orderNumber: 9380 } }
    })

    expect(sent).toEqual(['first', 'second'])
    expect(result).toMatchObject({ synced: 2, stoppedForNetwork: false })
    expect(await store.listPending()).toEqual([])
  })

  it('retains the queue and stops after a network failure', async () => {
    const store = createMemoryOrderStore()
    await store.enqueueCreate(first)
    await store.enqueueCreate(second)
    const sent: string[] = []

    const result = await syncPendingOrders(store, async (item) => {
      sent.push(item.localId)
      throw new TypeError('Failed to fetch')
    })

    expect(sent).toEqual(['first'])
    expect(result).toMatchObject({ synced: 0, stoppedForNetwork: true })
    expect((await store.listPending()).map((item) => item.localId)).toEqual(['first', 'second'])
  })

  it('marks a validation response for manual retry without deleting it', async () => {
    const store = createMemoryOrderStore()
    await store.enqueueCreate(first)

    const result = await syncPendingOrders(store, async () => ({ ok: false, error: 'El equipo es obligatorio' }))

    expect(result).toMatchObject({ failed: 1 })
    expect(await store.getPending('first')).toMatchObject({ syncError: 'El equipo es obligatorio' })
  })
})
