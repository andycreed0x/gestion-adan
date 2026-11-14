import type { OrderStore, PendingCreate, PersistedOrder } from './types'
import { createMemorySyncReceipts, type SyncReceipts } from './sync-receipts'

export type { SyncReceipt, SyncReceipts } from './sync-receipts'

export type SyncPostResult =
  | { ok: true; order: PersistedOrder }
  | { ok: false; error: string }

export type SyncResult = {
  synced: number
  failed: number
  stoppedForNetwork: boolean
  warnings: string[]
}

export const UNCERTAIN_SYNC_WARNING = 'No se conoce el resultado del envío anterior. Revisá si la orden ya existe: reintentar puede crear un duplicado.'

const memoryJournals = new WeakMap<OrderStore, SyncReceipts>()

function memoryJournal(store: OrderStore): SyncReceipts {
  let receipts = memoryJournals.get(store)
  if (!receipts) { receipts = createMemorySyncReceipts(); memoryJournals.set(store, receipts) }
  return receipts
}

export type SyncOptions = {
  retryErrors?: boolean
  isActive?: () => boolean
  receipts?: SyncReceipts
}

export async function syncPendingOrders(
  store: OrderStore,
  postOrder: (pending: PendingCreate) => Promise<SyncPostResult>,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, failed: 0, stoppedForNetwork: false, warnings: [] }
  const memory = memoryJournal(store)
  const receipts = options.receipts ?? memory
  const active = () => options.isActive?.() ?? true
  const markFailure = async (id: string, message: string): Promise<boolean> => {
    if (!active()) return false
    try { await store.markSyncFailure(id, message); return true } catch { return false }
  }
  const removeReceipt = async (id: string) => {
    await receipts.remove(id)
    await memory.remove(id)
  }

  for (const pending of await store.listPending()) {
    if (!active()) break
    try {
      const remembered = await memory.read(pending.localId)
      const receipt = remembered?.state === 'confirmed' ? remembered : await receipts.read(pending.localId) ?? remembered
      if (!active()) break
      let order: PersistedOrder
      if (receipt?.state === 'confirmed') {
        order = receipt.order
      } else {
        if (receipt?.state === 'sending') {
          await markFailure(pending.localId, UNCERTAIN_SYNC_WARNING)
          if (!options.retryErrors) { result.failed += 1; continue }
          result.warnings.push(UNCERTAIN_SYNC_WARNING)
        } else if (pending.syncError && !options.retryErrors) continue
        if (!active()) break
        await receipts.reserve(pending.localId)
        await memory.reserve(pending.localId)
        if (!active()) break

        let response: SyncPostResult
        try {
          response = await postOrder(pending)
        } catch (error) {
          if (!active()) break
          // Only a POST TypeError is a network failure. Local persistence errors
          // must never erase the receipt for an acknowledged server order.
          if (!(error instanceof TypeError)) throw error
          try { await removeReceipt(pending.localId) } catch {}
          result.stoppedForNetwork = true
          break
        }
        if (!active()) break
        if (!response.ok) {
          result.failed += 1
          if (await markFailure(pending.localId, response.error)) {
            if (!active()) break
            await removeReceipt(pending.localId)
          }
          continue
        }
        order = response.order
      }

      // Keep the known id in memory even if the reserved storage becomes
      // unavailable. A later explicit retry must still finalize, not POST.
      await memory.confirm(pending.localId, order)
      if (!active()) break
      await receipts.confirm(pending.localId, order)
      if (!active()) break
      await store.replacePendingWithPersisted(pending.localId, order)
      if (!active()) break
      await removeReceipt(pending.localId)
      result.synced += 1
    } catch (error) {
      if (!active()) break
      await markFailure(pending.localId, error instanceof Error ? error.message : 'No se pudo sincronizar la orden')
      result.failed += 1
    }
  }

  return result
}
