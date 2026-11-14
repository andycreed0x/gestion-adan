import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GET } from './route'

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), getSession: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ auth: mocks }) }))
beforeEach(() => { vi.clearAllMocks() })

describe('verified offline session metadata', () => {
  it('never trusts cookie-only session identity before getUser verification', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error('revoked') })
    const response = await GET()
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.getSession).not.toHaveBeenCalled()
  })
  it('returns only verified owner and expiry, never tokens', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null })
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'owner' }, expires_at: 1800000000, access_token: `header.${Buffer.from(JSON.stringify({ session_id: 'synthetic-session' })).toString('base64url')}.not-returned` } } })
    const response = await GET()
    expect(await response.json()).toEqual({ ownerId: 'owner', expiresAt: 1800000000000, sessionId: 'synthetic-session' })
  })
  it('rejects mismatched session metadata after a user check', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'owner' } }, error: null })
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'other' }, expires_at: 1800000000 } } })
    expect((await GET()).status).toBe(401)
  })
})
