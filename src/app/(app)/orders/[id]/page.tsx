import Link from 'next/link'
import { notFound } from 'next/navigation'

import { OrderForm } from '@/components/order-form'
import { formatCurrency, type OrderStatus } from '@/lib/orders'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { updateOrderAction } from '../actions'

type OrderPageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }

export default async function OrderPage({ params, searchParams }: OrderPageProps) {
  const [{ id }, { error }] = await Promise.all([params, searchParams])
  const supabase = await createServerSupabaseClient()
  const { data: order, error: queryError } = await supabase
    .from('repair_orders')
    .select('id, order_number, equipment, accessories, reported_fault, resolution, budget_cents, status, received_on, picked_up_on, customers(full_name, address, phone)')
    .eq('id', id)
    .maybeSingle()
  if (queryError) throw new Error(queryError.message)
  if (!order) notFound()

  const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers
  const action = updateOrderAction.bind(null, id)
  const budget = order.budget_cents === null ? '' : (order.budget_cents / 100).toFixed(2).replace('.', ',')

  return (
    <section className="page-section">
      <div className="page-heading"><div><Link href="/orders">← Órdenes</Link><h1>Orden #{order.order_number}</h1><p className="muted">{formatCurrency(order.budget_cents)}</p></div><Link className="button secondary" href={`/orders/${id}/print`}>Imprimir ticket</Link></div>
      <OrderForm action={action} error={error} submitLabel="Guardar cambios" values={{
        customerName: customer?.full_name,
        customerAddress: customer?.address,
        customerPhone: customer?.phone,
        equipment: order.equipment,
        accessories: order.accessories,
        reportedFault: order.reported_fault,
        resolution: order.resolution,
        budget,
        status: order.status as OrderStatus,
        receivedOn: order.received_on,
        pickedUpOn: order.picked_up_on ?? undefined,
      }} />
    </section>
  )
}
