import { describe, expect, it } from 'vitest'

import { normalizeArgentinePhone, validateArgentinePhone } from './customer-phone'

describe('Argentine customer phones', () => {
  it('normalizes local, country and mobile-prefixed variants to one identity', () => {
    expect(normalizeArgentinePhone('11 4444-5555')).toBe('5491144445555')
    expect(normalizeArgentinePhone('+54 11 4444-5555')).toBe('5491144445555')
    expect(normalizeArgentinePhone('+54 9 11 4444-5555')).toBe('5491144445555')
  })

  it('keeps an empty phone optional and rejects a nonempty invalid value', () => {
    expect(normalizeArgentinePhone('')).toBeNull()
    expect(validateArgentinePhone('')).toBeNull()
    expect(validateArgentinePhone('123')).toBe('Ingresá un teléfono argentino válido')
  })
})
