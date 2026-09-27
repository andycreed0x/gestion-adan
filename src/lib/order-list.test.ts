import { describe, expect, it } from 'vitest'

import { buildOrderListQuery, parseOrderListSearchParams } from './order-list'

type Call = [string, ...unknown[]]

function fakeClient() {
  const calls: Call[] = []
  const query = {
    select: (...args: unknown[]) => { calls.push(['select', ...args]); return query },
    ilike: (...args: unknown[]) => { calls.push(['ilike', ...args]); return query },
    eq: (...args: unknown[]) => { calls.push(['eq', ...args]); return query },
    gte: (...args: unknown[]) => { calls.push(['gte', ...args]); return query },
    lte: (...args: unknown[]) => { calls.push(['lte', ...args]); return query },
    order: (...args: unknown[]) => { calls.push(['order', ...args]); return query },
    range: (...args: unknown[]) => { calls.push(['range', ...args]); return query },
  }
  return { calls, client: { from: (table: string) => { calls.push(['from', table]); return query } } }
}

describe('order list filters', () => {
  it('defaults to the first page of the recent Argentine calendar window', () => {
    const filters = parseOrderListSearchParams(new URLSearchParams(), new Date('2026-09-26T12:00:00Z'))

    expect(filters).toMatchObject({ page: 1, pageSize: 25, implicitRecentWindow: true, recentStart: '2026-08-28' })
  })

  it('removes the implicit date window when a user applies any filter', () => {
    expect(parseOrderListSearchParams(new URLSearchParams('q=9380'))).toMatchObject({ implicitRecentWindow: false })
    expect(parseOrderListSearchParams(new URLSearchParams('status=ready'))).toMatchObject({ implicitRecentWindow: false })
    expect(parseOrderListSearchParams(new URLSearchParams('receivedFrom=2026-01-01'))).toMatchObject({ implicitRecentWindow: false })
  })

  it('applies filters before the second page range', () => {
    const { client, calls } = fakeClient()
    const filters = parseOrderListSearchParams(new URLSearchParams('q=ana&status=ready&page=2'))

    buildOrderListQuery(client, filters)

    expect(calls).toContainEqual(['from', 'repair_order_list'])
    expect(calls).toContainEqual(['ilike', 'search_text', '%ana%'])
    expect(calls).toContainEqual(['eq', 'status', 'ready'])
    expect(calls).toContainEqual(['range', 25, 49])
    expect(calls.findIndex(([name]) => name === 'range')).toBeGreaterThan(calls.findIndex(([name]) => name === 'eq'))
  })
})
