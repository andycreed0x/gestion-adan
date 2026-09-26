import type { OrderDraft, OrderStatus } from '@/lib/orders'

export type CachedOrder = {
  id: string
  orderNumber: number
  customerName: string
  customerAddress: string
  customerPhone: string
  equipment: string
  accessories: string
  reportedFault: string
  resolution: string
  budgetCents: number | null
  status: OrderStatus
  receivedOn: string
  pickedUpOn: string | null
}

export type CachedCustomer = Pick<CachedOrder, 'customerName' | 'customerAddress' | 'customerPhone'> & {
  phoneNormalized: string
}

export type PendingCreate = {
  localId: string
  createdAt: string
  draft: OrderDraft
  syncError?: string | null
}

export type PersistedOrder = { id: string; orderNumber: number }

export type OrderStore = {
  putRecentPage: (orders: CachedOrder[]) => Promise<void>
  putOrder: (order: CachedOrder) => Promise<void>
  getOrder: (id: string) => Promise<CachedOrder | null>
  findCachedCustomer: (phone: string) => Promise<CachedCustomer | null>
  enqueueCreate: (pending: PendingCreate) => Promise<void>
  getPending: (localId: string) => Promise<PendingCreate | null>
  listPending: () => Promise<PendingCreate[]>
  replacePendingWithPersisted: (localId: string, persisted: PersistedOrder) => Promise<void>
  takePersistedForPending: (localId: string) => Promise<PersistedOrder | null>
  markSyncFailure: (localId: string, message: string) => Promise<void>
  clear: () => Promise<void>
}
