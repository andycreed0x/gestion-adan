import { describe, expect, it } from 'vitest'

import { getSafeRedirect } from './auth'

describe('getSafeRedirect', () => {
  it('keeps an in-app path', () => {
    expect(getSafeRedirect('/orders?status=ready')).toBe('/orders?status=ready')
  })

  it('rejects an absolute external URL', () => {
    expect(getSafeRedirect('https://attacker.test/orders')).toBe('/orders')
  })
})
