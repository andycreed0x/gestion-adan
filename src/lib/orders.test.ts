import { describe, expect, it } from 'vitest'

import {
  formatCurrency,
  makeAttachmentPath,
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
