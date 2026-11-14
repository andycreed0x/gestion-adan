import { describe, expect, it } from 'vitest'

import { offlineMetadataForVerifiedUser } from './session-metadata'

const token = (sessionId: string) => `header.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64url')}.signature`
describe('metadata after authoritative server verification', () => {
  it('returns only owner, auth-session identifier and expiry, never tokens', () => {
    expect(offlineMetadataForVerifiedUser('a', { user: { id: 'a' }, expires_at: 1800000000, access_token: token('session-a') })).toEqual({ ownerId: 'a', sessionId: 'session-a', expiresAt: 1800000000000 })
  })
  it('rejects mismatched or incomplete cookie metadata', () => {
    expect(offlineMetadataForVerifiedUser('a', null)).toBeNull()
    expect(offlineMetadataForVerifiedUser('a', { user: { id: 'b' }, expires_at: 1800000000, access_token: token('b') })).toBeNull()
    expect(offlineMetadataForVerifiedUser('a', { user: { id: 'a' }, expires_at: 1800000000, access_token: 'invalid' })).toBeNull()
  })
})
