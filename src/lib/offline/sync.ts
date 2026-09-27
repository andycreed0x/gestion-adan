import type { OrderStore, PendingCreate, PersistedOrder } from './types'

export type SyncPostResult =
  | { ok: true; order: PersistedOrder }
  | { ok: false; error: string }

export type SyncResult = {
  synced: number
  failed: number
  stoppedForNetwork: boolean
}

export async function syncPendingOrders(
  store: OrderStore,
  postOrder: (pending: PendingCreate) => Promise<SyncPostResult>,
): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, failed: 0, stoppedForNetwork: false }

  for (const pending of await store.listPending()) {
    try {
      const response = await postOrder(pending)
      if (response.ok) {
        await store.replacePendingWithPersisted(pending.localId, response.order)
        result.synced += 1
      } else {
        await store.markSyncFailure(pending.localId, response.error)
        result.failed += 1
      }
    } catch (error) {
      if (error instanceof TypeError) {
        result.stoppedForNetwork = true
        break
      }
      await store.markSyncFailure(pending.localId, error instanceof Error ? error.message : 'No se pudo sincronizar la orden')
      result.failed += 1
    }
  }

  return result
}
