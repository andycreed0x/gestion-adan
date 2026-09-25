import { notFound } from 'next/navigation'

import { PrintButton } from '@/components/print-button'
import { formatCurrency } from '@/lib/orders'
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
        <dl>
          <dt>Ingreso</dt><dd>{order.received_on}</dd>
          <dt>Cliente</dt><dd>{customer?.full_name}</dd>
          <dt>Dirección</dt><dd>{customer?.address || '—'}</dd>
          <dt>Teléfono</dt><dd>{customer?.phone || '—'}</dd>
          <dt>Equipo</dt><dd>{order.equipment}</dd>
          <dt>Accesorios</dt><dd>{order.accessories || '—'}</dd>
          <dt>Falla</dt><dd>{order.reported_fault || '—'}</dd>
          <dt>Resolución</dt><dd>{order.resolution || '—'}</dd>
          <dt>Presupuesto</dt><dd>{formatCurrency(order.budget_cents)}</dd>
          <dt>Estado</dt><dd>{order.status}</dd>
          <dt>Retiro</dt><dd>{order.picked_up_on || 'Pendiente'}</dd>
        </dl>
        <footer>Validez del presupuesto: 30 días corridos. Pasados los 90 días sin retiro, el equipo se considera abandonado.</footer>
      </article>
    </main>
  )
}
