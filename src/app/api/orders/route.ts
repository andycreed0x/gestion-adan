import { revalidatePath } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'

import { parseOrderListSearchParams, queryOrderPage } from '@/lib/order-list'
import { createOrder, OrderValidationError } from '@/lib/order-service'
import { createServerSupabaseClient } from '@/lib/supabase/server'

async function session() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

export async function GET(request: NextRequest) {
  const { supabase, user } = await session()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  try {
    const filters = parseOrderListSearchParams(request.nextUrl.searchParams)
    return NextResponse.json(await queryOrderPage(supabase, filters))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudieron consultar las órdenes' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await session()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  let draft: unknown
  try {
    draft = await request.json()
  } catch {
    return NextResponse.json({ error: 'El cuerpo debe ser JSON' }, { status: 400 })
  }

  try {
    const order = await createOrder(supabase, user.id, draft as Record<string, string>)
    revalidatePath('/orders')
    return NextResponse.json(order, { status: 201 })
  } catch (error) {
    if (error instanceof OrderValidationError) {
      return NextResponse.json({ fieldErrors: error.validation.fieldErrors }, { status: 422 })
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : 'No se pudo crear la orden' }, { status: 500 })
  }
}
