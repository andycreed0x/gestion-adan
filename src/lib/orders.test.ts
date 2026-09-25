import { describe, expect, it } from 'vitest'

import {
  formatCurrency,
  makeAttachmentPath,
  matchesOrderFilters,
  parseOrderInput,
} from './orders'

describe('repair order domain', () => {
  it('rejects a missing customer name', () => {
    expect(parseOrderInput({ customerName: '', equipment: 'TV' }).success).toBe(false)
  })

  it('converts an Argentine decimal budget to integer cents', () => {
    const result = parseOrderInput({
      customerName: 'Ana',
      equipment: 'TV',
      budget: '12,50',
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.budgetCents).toBe(1250)
  })

  it('uses a generated filename below the order path', () => {
    expect(makeAttachmentPath('order-id', '../foto.png')).toMatch(
      /^order-id\/[a-f0-9-]+\.png$/,
    )
  })

  it('formats cent amounts in Argentine pesos', () => {
    expect(formatCurrency(1250)).toContain('12,50')
  })
})

it('rejects picked_up status without a pickup date', () => {
  const result = parseOrderInput({
    customerName: 'Ana',
    equipment: 'TV',
    status: 'picked_up',
  })

  expect(result.success).toBe(false)
})

it('accepts an Argentine thousands separator without treating it as decimals', () => {
  const result = parseOrderInput({
    customerName: 'Ana',
    equipment: 'TV',
    budget: '12.500',
  })

  expect(result.success).toBe(true)
  if (result.success) expect(result.data.budgetCents).toBe(1_250_000)
})


describe('order listing filters', () => {
  const order = {
    orderNumber: 9380,
    equipment: 'Smart TV Samsung',
    customerName: 'Ana Pérez',
    customerPhone: '1144445555',
    status: 'ready' as const,
    receivedOn: '2026-09-10',
  }

  it('matches status, date range, and case-insensitive text together', () => {
    expect(matchesOrderFilters(order, {
      query: 'ana',
      status: 'ready',
      receivedFrom: '2026-09-01',
      receivedTo: '2026-09-25',
    })).toBe(true)
  })

  it('rejects an order outside the requested filters', () => {
    expect(matchesOrderFilters(order, { status: 'received' })).toBe(false)
    expect(matchesOrderFilters(order, { receivedFrom: '2026-09-11' })).toBe(false)
    expect(matchesOrderFilters(order, { query: 'lavarropas' })).toBe(false)
  })
})

describe('budget validation', () => {
  it('rejects negative, non-numeric, and three-decimal budgets', () => {
    expect(parseOrderInput({ customerName: 'Ana', equipment: 'TV', budget: '-1' }).success).toBe(false)
    expect(parseOrderInput({ customerName: 'Ana', equipment: 'TV', budget: 'doce mil' }).success).toBe(false)
    expect(parseOrderInput({ customerName: 'Ana', equipment: 'TV', budget: '1.234,567' }).success).toBe(false)
  })
})


describe('received date range boundaries', () => {
  const order = {
    orderNumber: 1,
    equipment: 'Lavarropas Drean',
    status: 'received' as const,
    receivedOn: '2026-03-15',
  }

  it('includes the orders received exactly on each edge', () => {
    expect(matchesOrderFilters(order, { receivedFrom: '2026-03-15', receivedTo: '2026-03-15' })).toBe(true)
  })

  it('accepts a range that is open on one side', () => {
    expect(matchesOrderFilters(order, { receivedFrom: '2026-03-01' })).toBe(true)
    expect(matchesOrderFilters(order, { receivedTo: '2026-03-31' })).toBe(true)
    expect(matchesOrderFilters(order, { receivedFrom: '2026-03-16' })).toBe(false)
    expect(matchesOrderFilters(order, { receivedTo: '2026-03-14' })).toBe(false)
  })
})
