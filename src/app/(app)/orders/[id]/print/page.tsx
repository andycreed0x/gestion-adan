import { Fragment } from 'react'
import { notFound } from 'next/navigation'

import { PrintButton } from '@/components/print-button'
import { OrderTicketFooter, OrderTicketHeader } from '@/components/order-ticket-layout'
import { buildOrderTicketLines } from '@/lib/order-ticket'
import { type OrderStatus } from '@/lib/orders'
import { createServerSupabaseClient } from '@/lib/supabase/server'

type PrintPageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ autoPrint?: string }> }

export default async function PrintOrderPage({ params, searchParams }: PrintPageProps) {
  const [{ id }, { autoPrint }] = await Promise.all([params, searchParams])
  const supabase = await createServerSupabaseClient()
  const { data: order } = await supabase
    .from('repair_orders')
    .select('order_number, equipment, accessories, reported_fault, resolution, budget_cents, status, received_on, picked_up_on, customers(full_name, address, phone)')
    .eq('id', id)
    .maybeSingle()
  if (!order) notFound()
  const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers

  return (
    <main className="ticket-page">
      <div className="ticket-actions"><PrintButton autoPrint={autoPrint === '1'} /></div>
      <article className="ticket">
        <OrderTicketHeader />
        <dl>{buildOrderTicketLines({ persistence: 'persisted', orderNumber: order.order_number, customerName: customer?.full_name ?? '', customerAddress: customer?.address ?? '', customerPhone: customer?.phone ?? '', equipment: order.equipment, accessories: order.accessories, reportedFault: order.reported_fault, resolution: order.resolution, budgetCents: order.budget_cents, status: order.status as OrderStatus, receivedOn: order.received_on, pickedUpOn: order.picked_up_on ?? null }).map((line) => { const [label, value = '—'] = line.split(': ', 2); return <Fragment key={line}><dt>{label}</dt><dd>{value}</dd></Fragment> })}</dl>
        <OrderTicketFooter />
      </article>
    </main>
  )
}
