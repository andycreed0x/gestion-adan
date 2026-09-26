import { notFound } from 'next/navigation'

import { PrintButton } from '@/components/print-button'
import { buildOrderTicketLines } from '@/lib/order-ticket'
import { type OrderStatus } from '@/lib/orders'
import { createServerSupabaseClient } from '@/lib/supabase/server'

type PrintPageProps = { params: Promise<{ id: string }> }

export default async function PrintOrderPage({ params }: PrintPageProps) {
  const { id } = await params
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
      <div className="ticket-actions"><PrintButton /></div>
      <article className="ticket">
        <header><h1>SERVICIO TÉCNICO ADAN</h1><p>25 de Mayo 1231, San Fernando · Tel: (011) 4744-7009</p></header>
        <h2>Orden de reparación #{order.order_number}</h2>
        <dl>{buildOrderTicketLines({ persistence: 'persisted', orderNumber: order.order_number, customerName: customer?.full_name ?? '', customerAddress: customer?.address ?? '', customerPhone: customer?.phone ?? '', equipment: order.equipment, accessories: order.accessories, reportedFault: order.reported_fault, resolution: order.resolution, budgetCents: order.budget_cents, status: order.status as OrderStatus, receivedOn: order.received_on, pickedUpOn: order.picked_up_on ?? null }).map((line) => { const [label, value = '—'] = line.split(': ', 2); return <><dt key={`${line}-label`}>{label}</dt><dd key={`${line}-value`}>{value}</dd></> })}</dl>
        <footer>Validez del presupuesto: 30 días corridos. Pasados los 90 días sin retiro, el equipo se considera abandonado.</footer>
      </article>
    </main>
  )
}
