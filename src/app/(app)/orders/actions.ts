'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { parseOrderInput } from '@/lib/orders'
import { createOrder, updateOrder } from '@/lib/order-service'
import { createServerSupabaseClient } from '@/lib/supabase/server'

function formValues(formData: FormData) {
  return Object.fromEntries([...formData.entries()].map(([key, value]) => [key, String(value)]))
}

async function requireUser() {
  const supabase = await createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, user }
}

export async function createOrderAction(formData: FormData) {
  const values = formValues(formData)
  const parsed = parseOrderInput(values)
  if (!parsed.success) redirect(`/orders/new?error=${encodeURIComponent(parsed.error.issues[0])}`)

  const { supabase, user } = await requireUser()
  const order = await createOrder(supabase, user.id, values)
  revalidatePath('/orders')
  redirect(`/orders/${order.id}?saved=1`)
}

export async function updateOrderAction(orderId: string, formData: FormData) {
  const values = formValues(formData)
  const parsed = parseOrderInput(values)
  if (!parsed.success) redirect(`/orders/${orderId}?error=${encodeURIComponent(parsed.error.issues[0])}`)

  const { supabase } = await requireUser()
  await updateOrder(supabase, orderId, values)
  revalidatePath('/orders')
  revalidatePath(`/orders/${orderId}`)
  redirect(`/orders/${orderId}?saved=1`)
}
