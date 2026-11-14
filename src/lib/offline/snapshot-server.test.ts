import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'

import { queryOfflineSnapshot } from './snapshot-server'

vi.mock('server-only', () => ({}))

const now = new Date('2026-11-14T12:00:00Z')

function row(orderNumber: number) {
  return {
    id: `order-${orderNumber}`,
    order_number: orderNumber,
    equipment: 'TV sintético',
    accessories: 'Control',
    reported_fault: 'No enciende',
    resolution: 'Fuente reparada',
    budget_cents: 12345,
    status: 'ready',
    received_on: '2026-11-14',
    picked_up_on: null,
    customers: { full_name: 'Cliente sintético', address: 'Calle 123', phone: '23452345' },
  }
}

function clientWithFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const requests: URL[] = []
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    requests.push(url)
    return handler(url, init)
  })
  const client = createClient('https://synthetic.invalid', 'synthetic-publishable-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  })
  return { client, requests, fetch }
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
})

function paginatedClient(rows: ReturnType<typeof row>[], cap = 500) {
  return clientWithFetch((url) => {
    const cursor = Number(url.searchParams.get('order_number')?.replace('gt.', '') ?? -Infinity)
    const start = url.searchParams.get('received_on')?.replace('gte.', '') ?? ''
    const end = url.searchParams.getAll('received_on').find((filter) => filter.startsWith('lte.'))?.slice(4) ?? '9999-12-31'
    return json(rows.filter((item) => item.order_number > cursor && item.received_on >= start && item.received_on <= end)
      .slice(0, Math.min(Number(url.searchParams.get('limit')), cap)))
  })
}

describe('offline snapshot server', () => {
  it('maps every CachedOrder field and returns owner and version metadata', async () => {
    const { client, requests } = paginatedClient([row(9380)])

    const snapshot = await queryOfflineSnapshot(client, 'verified-owner', { now })

    expect(snapshot).toEqual({
      schemaVersion: 1,
      ownerId: 'verified-owner',
      windowStart: '2026-10-16',
      generatedAt: now.toISOString(),
      orders: [{
        id: 'order-9380', orderNumber: 9380,
        customerName: 'Cliente sintético', customerAddress: 'Calle 123', customerPhone: '23452345',
        equipment: 'TV sintético', accessories: 'Control', reportedFault: 'No enciende',
        resolution: 'Fuente reparada', budgetCents: 12345, status: 'ready',
        receivedOn: '2026-11-14', pickedUpOn: null,
      }],
    })
    expect(requests.every((url) => url.pathname === '/rest/v1/repair_orders')).toBe(true)
    expect(requests[0].searchParams.get('select')).toBe(
      'id,order_number,equipment,accessories,reported_fault,resolution,budget_cents,status,received_on,picked_up_on,customers(full_name,address,phone)',
    )
    // Authorization is the client's session and existing RLS, not created_by filtering.
    expect(requests[0].searchParams.has('created_by')).toBe(false)
  })

  it('keeps null budgets, zero budgets, pickup dates and unavailable joined customers', async () => {
    const { client } = clientWithFetch((url) => url.searchParams.has('order_number') ? json([]) : json([
      { ...row(1), customers: null, budget_cents: null },
      { ...row(2), customers: [row(2).customers], budget_cents: 0, status: 'picked_up', picked_up_on: '2026-11-14' },
    ]))

    const { orders } = await queryOfflineSnapshot(client, 'owner', { now })

    expect(orders[0]).toMatchObject({ customerName: '', customerAddress: '', customerPhone: '', budgetCents: null })
    expect(orders[1]).toMatchObject({ customerName: 'Cliente sintético', budgetCents: 0, status: 'picked_up', pickedUpOn: '2026-11-14' })
  })

  it.each([
    ['2026-11-14T02:59:59Z', '2026-10-15', '2026-11-13'],
    ['2026-11-14T03:00:00Z', '2026-10-16', '2026-11-14'],
    ['2026-01-01T03:00:00Z', '2025-12-03', '2026-01-01'],
    ['2024-03-01T03:00:00Z', '2024-02-01', '2024-03-01'],
  ])('uses 30 inclusive Argentina calendar dates at %s', async (instant, start, end) => {
    const { client, requests } = paginatedClient([])
    const snapshot = await queryOfflineSnapshot(client, 'owner', { now: new Date(instant) })
    expect(snapshot.windowStart).toBe(start)
    expect(snapshot.orders).toEqual([])
    expect(requests[0].searchParams.getAll('received_on')).toEqual([`gte.${start}`, `lte.${end}`])
  })

  it('includes both date boundaries but excludes older and future received dates', async () => {
    const rows = ['2026-10-15', '2026-10-16', '2026-11-14', '2026-11-15']
      .map((date, index) => ({ ...row(index + 1), received_on: date }))
    const { client } = paginatedClient(rows)
    expect((await queryOfflineSnapshot(client, 'owner', { now })).orders.map((order) => order.orderNumber)).toEqual([2, 3])
  })

  it.each([[1201, 500, 4], [7, 2, 5], [500, 500, 2]])(
    'reads all %i orders with server row cap %i, including the final empty request', async (count, cap, calls) => {
      const rows = Array.from({ length: count }, (_, index) => row(9380 + index * 2))
      const { client, requests } = paginatedClient(rows, cap)
      const snapshot = await queryOfflineSnapshot(client, 'owner', { now })
      expect(snapshot.orders.map((order) => order.orderNumber)).toEqual(rows.map((item) => item.order_number))
      expect(requests).toHaveLength(calls)
      for (const url of requests) {
        expect(url.searchParams.get('limit')).toBe('500')
        expect(url.searchParams.get('order')).toBe('order_number.asc')
        expect(url.searchParams.has('offset')).toBe(false)
        expect(url.searchParams.get('select')).toContain('customers(full_name,address,phone)')
      }
      expect(requests[1].searchParams.get('order_number')).toBe(`gt.${rows[Math.min(cap, count) - 1].order_number}`)
    },
  )

  it('rejects a later failed batch rather than returning partial orders', async () => {
    const { client } = clientWithFetch((url) => url.searchParams.has('order_number')
      ? json({ message: 'synthetic query error' }, 500) : json([row(1)]))
    await expect(queryOfflineSnapshot(client, 'owner', { now })).rejects.toThrow('synthetic query error')
  })

  it('rejects a missing result instead of claiming an empty complete snapshot', async () => {
    const { client } = clientWithFetch(() => json(null))
    await expect(queryOfflineSnapshot(client, 'owner', { now })).rejects.toThrow('La consulta del snapshot no devolvió órdenes')
  })

  it.each([[1, 1], [2, 1], [Number.MAX_SAFE_INTEGER + 1], [1.5]])(
    'rejects invalid or non-ascending cursor values %j', async (...numbers) => {
      const { client, fetch } = clientWithFetch(() => json(numbers.map(row)))
      await expect(queryOfflineSnapshot(client, 'owner', { now })).rejects.toThrow(/cursor|order|orden/i)
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )

  it('rejects a batch that does not advance past the previous cursor', async () => {
    const { client, fetch } = clientWithFetch(() => json([row(1)]))
    await expect(queryOfflineSnapshot(client, 'owner', { now })).rejects.toThrow(/cursor|order|orden/i)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not query when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const { client, fetch } = paginatedClient([])
    await expect(queryOfflineSnapshot(client, 'owner', { now, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('passes the disconnect signal to fetch and discards results that arrive after abort', async () => {
    const controller = new AbortController()
    const { client, fetch } = clientWithFetch((_url, init) => {
      expect(init?.signal).toBe(controller.signal)
      controller.abort()
      return json([row(1)])
    })
    await expect(queryOfflineSnapshot(client, 'owner', { now, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
