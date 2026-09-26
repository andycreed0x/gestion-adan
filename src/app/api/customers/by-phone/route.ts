import { NextRequest, NextResponse } from 'next/server'

import { lookupCustomerByPhone } from '@/lib/order-service'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const customer = await lookupCustomerByPhone(supabase, request.nextUrl.searchParams.get('phone') ?? '')
    return NextResponse.json({ customer })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo buscar el cliente' }, { status: 500 })
  }
}
