import type { OrderRow } from '@/components/order-table'
import { ORDER_PAGE_SIZE, parseOrderListSearchParams } from '@/lib/order-list'
import { matchesOrderFilters, orderStatuses, type OrderStatus } from '@/lib/orders'

import type { CachedOrder, PendingCreate } from './types'

export function shellOrderPage(orders: CachedOrder[], pending: PendingCreate[], params: URLSearchParams) {
  const filters = parseOrderListSearchParams(params)
  const matches = (order: Parameters<typeof matchesOrderFilters>[0]) => matchesOrderFilters(order, {
    query: filters.q, status: filters.status, receivedFrom: filters.receivedFrom, receivedTo: filters.receivedTo,
  })
  const rows: OrderRow[] = [
    ...pending.filter((item) => matches({
      orderNumber: 0,
      customerName: item.draft.customerName,
      customerPhone: item.draft.customerPhone,
      equipment: item.draft.equipment ?? '',
      status: orderStatuses.includes(item.draft.status as OrderStatus) ? item.draft.status as OrderStatus : 'received',
      receivedOn: item.draft.receivedOn ?? item.createdAt.slice(0, 10),
    })).map((item): OrderRow => ({
      persistence: 'pending', localId: item.localId, equipment: item.draft.equipment ?? '', status: 'pending', budget_cents: null,
      received_on: item.draft.receivedOn ?? item.createdAt.slice(0, 10),
      customers: { full_name: item.draft.customerName ?? '', phone: item.draft.customerPhone ?? '' },
    })),
    ...orders.filter(matches).sort((a, b) => b.receivedOn.localeCompare(a.receivedOn) || b.orderNumber - a.orderNumber).map((order): OrderRow => ({
      persistence: 'persisted', id: order.id, order_number: order.orderNumber, equipment: order.equipment, status: order.status,
      budget_cents: order.budgetCents, received_on: order.receivedOn, picked_up_on: order.pickedUpOn,
      customers: { full_name: order.customerName, phone: order.customerPhone },
    })),
  ]
  const totalPages = Math.max(1, Math.ceil(rows.length / ORDER_PAGE_SIZE))
  const page = Math.min(filters.page, totalPages)
  return { filters, page, totalPages, total: rows.length, rows: rows.slice((page - 1) * ORDER_PAGE_SIZE, page * ORDER_PAGE_SIZE) }
}
