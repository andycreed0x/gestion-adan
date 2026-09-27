import { describe, expect, it } from 'vitest'

import { normalizeArgentinePhone, validateArgentinePhone } from './customer-phone'

describe('Customer phones', () => {
  it('keeps every typed digit without adding an Argentine prefix', () => {
    expect(normalizeArgentinePhone('11 4444-5555')).toBe('1144445555')
    expect(normalizeArgentinePhone('+54 11 4444-5555')).toBe('541144445555')
    expect(normalizeArgentinePhone('+54 9 11 4444-5555')).toBe('5491144445555')
  })

  it('keeps an empty phone optional and accepts any nonempty digit count', () => {
    expect(normalizeArgentinePhone('')).toBeNull()
    expect(validateArgentinePhone('')).toBeNull()
    expect(validateArgentinePhone('47441234')).toBeNull()
    expect(validateArgentinePhone('sin dígitos')).toBe('Ingresá al menos un número de teléfono')
  })
})
