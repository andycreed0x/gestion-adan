import { NextResponse } from 'next/server'

import { offlineMetadataForVerifiedUser } from '@/lib/offline/session-metadata'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createServerSupabaseClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  const headers = { 'Cache-Control': 'private, no-store' }
  if (error || !user) return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers })
  // Identity was verified above. getSession supplies expiry metadata only, never authorization.
  const { data: { session } } = await supabase.auth.getSession()
  const metadata = offlineMetadataForVerifiedUser(user.id, session)
  if (!metadata) return NextResponse.json({ error: 'Sesión sin metadata verificable' }, { status: 401, headers })
  return NextResponse.json(metadata, { headers })
}
