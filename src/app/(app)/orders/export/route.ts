import { redirect } from 'next/navigation'
import type { NextRequest } from 'next/server'

import { buildOrdersCsv, buildOrdersCsvFilename, type OrderCsvRow } from '@/lib/csv'
import { matchesOrderFilters, orderStatuses, type OrderStatus } from '@/lib/orders'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const params = request.nextUrl.searchParams
  const q = params.get('q') ?? ''
  const rawStatus = params.get('status') ?? ''
  const status = orderStatuses.includes(rawStatus as OrderStatus) ? rawStatus as OrderStatus : ''
  const receivedFrom = params.get('receivedFrom') ?? ''
  const receivedTo = params.get('receivedTo') ?? ''

  const { data, error } = await supabase
    .from('repair_orders')
    .select('order_number, equipment, accessories, reported_fault, resolution, budget_cents, status, received_on, picked_up_on, customers(full_name, address, phone)')
    .order('order_number', { ascending: false })
    .limit(250)
  if (error) throw new Error(error.message)

  const rows: OrderCsvRow[] = (data ?? []).map((order) => {
    const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers
    return {
      orderNumber: order.order_number,
      customerName: customer?.full_name ?? '',
      customerAddress: customer?.address ?? '',
      customerPhone: customer?.phone ?? '',
      equipment: order.equipment,
      accessories: order.accessories ?? '',
      reportedFault: order.reported_fault ?? '',
      resolution: order.resolution ?? '',
      budgetCents: order.budget_cents,
      status: order.status as OrderStatus,
      receivedOn: order.received_on,
      pickedUpOn: order.picked_up_on,
    }
  }).filter((row) => matchesOrderFilters({
    orderNumber: row.orderNumber,
    equipment: row.equipment,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    status: row.status,
    receivedOn: row.receivedOn,
  }, { query: q, status, receivedFrom, receivedTo }))

  const filename = buildOrdersCsvFilename(
    { receivedFrom, receivedTo },
    new Date().toISOString().slice(0, 10),
  )

  return new Response(buildOrdersCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + filename + '"',
      'Cache-Control': 'no-store',
    },
  })
}
