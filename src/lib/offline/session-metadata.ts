import type { OfflineIdentityMetadata } from './types'

type SessionMetadataSource = { user: { id: string }; expires_at?: number; access_token: string }

// Call only after getUser() verified this request. Cookie data supplies metadata,
// never authorization. The serialized result deliberately contains no tokens.
export function offlineMetadataForVerifiedUser(ownerId: string, session: SessionMetadataSource | null): OfflineIdentityMetadata | null {
  if (!session?.expires_at || session.user.id !== ownerId) return null
  let sessionId: unknown
  try { sessionId = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString()).session_id } catch {}
  return typeof sessionId === 'string' && sessionId ? { ownerId, sessionId, expiresAt: session.expires_at * 1000 } : null
}
