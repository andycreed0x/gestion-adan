import type { PersistedOrder } from './types'

export type SyncReceipt =
  | { state: 'sending' }
  | { state: 'confirmed'; order: PersistedOrder }

type MaybePromise<T> = T | Promise<T>

export type SyncReceipts = {
  read: (localId: string) => MaybePromise<SyncReceipt | null>
  reserve: (localId: string) => MaybePromise<void>
  confirm: (localId: string, order: PersistedOrder) => MaybePromise<void>
  remove: (localId: string) => MaybePromise<void>
}

export const SYNC_RECEIPT_PREFIX = 'adan-offline-receipt:'

export function createMemorySyncReceipts(): SyncReceipts {
  const entries = new Map<string, SyncReceipt>()
  return {
    read(id) { return structuredClone(entries.get(id) ?? null) },
    reserve(id) { entries.set(id, { state: 'sending' }) },
    confirm(id, order) { entries.set(id, { state: 'confirmed', order: { id: order.id, orderNumber: order.orderNumber } }) },
    remove(id) { entries.delete(id) },
  }
}

export function createBrowserSyncReceipts(ownerId: string, epoch: string): SyncReceipts {
  if (!ownerId || !epoch) throw new Error('Falta la identidad del recibo de sincronización')
  const key = (id: string) => `${SYNC_RECEIPT_PREFIX}${encodeURIComponent(ownerId)}:${encodeURIComponent(id)}`
  const readStored = (id: string): { epoch: string; receipt: SyncReceipt; size: number } | null => {
    const raw = localStorage.getItem(key(id))
    if (raw === null) return null
    try {
      const value = JSON.parse(raw)
      if (typeof value?.epoch !== 'string') throw new Error()
      if (value.state === 'sending') return { epoch: value.epoch, receipt: { state: 'sending' }, size: raw.length }
      if (value.state === 'confirmed' && typeof value.order?.id === 'string' && value.order.id && Number.isSafeInteger(value.order.orderNumber)) {
        return { epoch: value.epoch, receipt: { state: 'confirmed', order: { id: value.order.id, orderNumber: value.order.orderNumber } }, size: raw.length }
      }
    } catch {}
    // A malformed journal is not evidence that an order was never sent.
    throw new Error('Recibo de sincronización ilegible; revisá la orden antes de reenviarla')
  }
  return {
    read(id) {
      // The verified runtime owns account authorization. An epoch fences live
      // work, not durable receipts: reauthentication must not forget a POST.
      return readStored(id)?.receipt ?? null
    },
    reserve(id) {
      const stored = readStored(id)
      if (stored?.receipt.state === 'confirmed') throw new Error('La confirmación del recibo cambió')
      // syncPendingOrders only renews an existing sending reservation on an
      // explicit, warned retry; automatic runs leave its original epoch intact.
      localStorage.setItem(key(id), JSON.stringify({ epoch, state: 'sending' }).padEnd(1024, ' '))
    },
    confirm(id, order) {
      const stored = readStored(id)
      if (!stored || (stored.receipt.state === 'sending' && stored.epoch !== epoch)) throw new Error('Falta la reserva de esta sesión para guardar la confirmación')
      if (stored.receipt.state === 'confirmed' && (stored.receipt.order.id !== order.id || stored.receipt.order.orderNumber !== order.orderNumber)) throw new Error('La orden ya tiene otra confirmación; no se puede sobrescribir')
      // Matching same-owner confirmations can be adopted by a verified new
      // epoch before finalizing IndexedDB. Never replace a different known id.
      const value = JSON.stringify({ epoch, state: 'confirmed', order: { id: order.id, orderNumber: order.orderNumber } })
      if (stored.receipt.state === 'sending' && value.length > stored.size) throw new Error('La confirmación excede el espacio reservado')
      localStorage.setItem(key(id), value)
    },
    remove(id) {
      if (readStored(id)?.epoch === epoch) localStorage.removeItem(key(id))
    },
  }
}
