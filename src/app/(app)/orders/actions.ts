'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { parseOrderInput } from '@/lib/orders'
import { createServerSupabaseClient } from '@/lib/supabase/server'

function formValues(formData: FormData) {
  return Object.fromEntries([...formData.entries()].map(([key, value]) => [key, String(value)]))
}

async function requireUser() {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, user }
}

async function resolveCustomer(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  input: { customerName: string; customerAddress: string; customerPhone: string },
) {
  const { data: existing, error: searchError } = await supabase
    .from('customers')
    .select('id')
    .eq('full_name', input.customerName)
    .eq('phone', input.customerPhone)
    .limit(1)
    .maybeSingle()
  if (searchError) throw searchError

  if (existing) {
    const { error } = await supabase
      .from('customers')
      .update({ address: input.customerAddress })
      .eq('id', existing.id)
    if (error) throw error
    return existing.id
  }

  const { data: customer, error } = await supabase
    .from('customers')
    .insert({
      full_name: input.customerName,
      address: input.customerAddress,
      phone: input.customerPhone,
    })
    .select('id')
    .single()
  if (error) throw error
  return customer.id
}

export async function createOrderAction(formData: FormData) {
  const parsed = parseOrderInput(formValues(formData))
  if (!parsed.success) redirect(`/orders/new?error=${encodeURIComponent(parsed.error.issues[0])}`)

  const { supabase, user } = await requireUser()
  const customerId = await resolveCustomer(supabase, parsed.data)
  const { data, error } = await supabase
    .from('repair_orders')
    .insert({
      customer_id: customerId,
      equipment: parsed.data.equipment,
      accessories: parsed.data.accessories,
      reported_fault: parsed.data.reportedFault,
      resolution: parsed.data.resolution,
      budget_cents: parsed.data.budgetCents,
      status: parsed.data.status,
      received_on: parsed.data.receivedOn,
      picked_up_on: parsed.data.pickedUpOn,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error) redirect(`/orders/new?error=${encodeURIComponent(error.message)}`)

  revalidatePath('/orders')
  redirect(`/orders/${data.id}?saved=1`)
}

export async function updateOrderAction(orderId: string, formData: FormData) {
  const parsed = parseOrderInput(formValues(formData))
  if (!parsed.success) redirect(`/orders/${orderId}?error=${encodeURIComponent(parsed.error.issues[0])}`)

  const { supabase } = await requireUser()
  const customerId = await resolveCustomer(supabase, parsed.data)
  const { error } = await supabase
    .from('repair_orders')
    .update({
      customer_id: customerId,
      equipment: parsed.data.equipment,
      accessories: parsed.data.accessories,
      reported_fault: parsed.data.reportedFault,
      resolution: parsed.data.resolution,
      budget_cents: parsed.data.budgetCents,
      status: parsed.data.status,
      received_on: parsed.data.receivedOn,
      picked_up_on: parsed.data.pickedUpOn,
    })
    .eq('id', orderId)
  if (error) redirect(`/orders/${orderId}?error=${encodeURIComponent(error.message)}`)

  revalidatePath('/orders')
  revalidatePath(`/orders/${orderId}`)
  redirect(`/orders/${orderId}?saved=1`)
}
