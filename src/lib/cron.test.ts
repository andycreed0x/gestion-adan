import { describe, expect, it } from 'vitest'

import { hasValidCronSecret } from './cron'

describe('hasValidCronSecret', () => {
  it('accepts exactly the configured bearer token', () => {
    expect(hasValidCronSecret('Bearer scheduled-secret', 'scheduled-secret')).toBe(true)
  })

  it('rejects a missing or mismatched secret', () => {
    expect(hasValidCronSecret(undefined, 'scheduled-secret')).toBe(false)
    expect(hasValidCronSecret('Bearer wrong', 'scheduled-secret')).toBe(false)
  })
})
