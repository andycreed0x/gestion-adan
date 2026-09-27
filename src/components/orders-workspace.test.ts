import { describe, expect, it } from 'vitest'

import { buildOrderCacheRoutes, mergeCachedPending, shouldShowOfflineBanner } from './orders-workspace'
import { orderListHref, parseOrderListSearchParams } from '@/lib/order-list'

describe('cached order workspace helpers', () => {
  it('includes every recent list page alongside order detail and print routes', () => {
    expect(buildOrderCacheRoutes([{ id: 'server-1' }], ['/orders', '/orders?page=2'])).toEqual([
      '/orders',
      '/orders?page=2',
      '/orders/server-1',
      '/orders/server-1/print',
    ])
  })

  it('preserves active filters in pagination URLs', () => {
    const filters = parseOrderListSearchParams(new URLSearchParams('q=ana&status=ready&receivedFrom=2026-01-01&page=1'))
    expect(orderListHref(filters, 2)).toBe('/orders?q=ana&status=ready&receivedFrom=2026-01-01&page=2')
  })

  it('puts pending local orders before persisted rows while offline', () => {
    const rows = mergeCachedPending([
      { id: 'server-1', order_number: 9380, equipment: 'TV', status: 'received', budget_cents: null, received_on: '2026-09-26', picked_up_on: null, customers: { full_name: 'Ana', phone: '' } },
    ], [
      { localId: 'pending-1', createdAt: '2026-09-26T10:00:00.000Z', draft: { customerName: 'Bea', equipment: 'Radio' } },
    ])

    expect(rows[0]).toMatchObject({ persistence: 'pending', localId: 'pending-1', equipment: 'Radio' })
    expect(rows[1]).toMatchObject({ persistence: 'persisted', id: 'server-1' })
  })

  it('shows the offline banner only when cache-backed data is visible', () => {
    expect(shouldShowOfflineBanner(false, true)).toBe(true)
    expect(shouldShowOfflineBanner(false, false)).toBe(false)
    expect(shouldShowOfflineBanner(true, true)).toBe(false)
  })
})
