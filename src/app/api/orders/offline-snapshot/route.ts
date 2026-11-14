import { NextRequest, NextResponse } from 'next/server'

import { queryOfflineSnapshot } from '@/lib/offline/snapshot-server'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const privateHeaders = { 'Cache-Control': 'private, no-store' }

export async function GET(request: NextRequest) {
  try {
    request.signal.throwIfAborted()
    const supabase = await createServerSupabaseClient()
    request.signal.throwIfAborted()
    const { data: { user }, error } = await supabase.auth.getUser()
    request.signal.throwIfAborted()
    if (error || !user) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers: privateHeaders })
    }

    const snapshot = await queryOfflineSnapshot(supabase, user.id, { signal: request.signal })
    request.signal.throwIfAborted()
    return NextResponse.json(snapshot, { headers: privateHeaders })
  } catch {
    const aborted = request.signal.aborted
    return NextResponse.json(
      { error: aborted ? 'Solicitud cancelada' : 'No se pudieron consultar las órdenes' },
      { status: aborted ? 499 : 500, headers: privateHeaders },
    )
  }
}
