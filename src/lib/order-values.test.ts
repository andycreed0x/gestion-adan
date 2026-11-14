import { describe, expect, it, vi } from 'vitest'

import { formatCurrency } from './orders'

describe('money presentation initialization', () => {
  it('does not construct a locale formatter for every listed order', () => {
    const constructor = vi.spyOn(Intl, 'NumberFormat')
    try {
      for (let i = 0; i < 25; i += 1) expect(formatCurrency(123456)).toMatch(/1\.234,56/)
      expect(constructor).not.toHaveBeenCalled()
      expect(formatCurrency(null)).toBe('Sin presupuesto')
    } finally { constructor.mockRestore() }
  })
})
