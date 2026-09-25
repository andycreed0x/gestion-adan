import { formatCurrency, isOverdue, type OrderStatus } from '@/lib/orders'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export default async function ReportsPage() {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('repair_orders')
    .select('order_number, status, received_on, budget_cents')
    .limit(1000)
  if (error) throw new Error(error.message)

  const orders = data ?? []
  const counts = orders.reduce<Record<string, number>>((accumulator, order) => {
    accumulator[order.status] = (accumulator[order.status] ?? 0) + 1
    return accumulator
  }, {})
  const overdue = orders.filter((order) => isOverdue({
    receivedOn: order.received_on,
    status: order.status as OrderStatus,
  }, new Date()))
  const budgetedCents = orders.reduce((sum, order) => sum + (order.budget_cents ?? 0), 0)

  return (
    <section className="page-section">
      <div><p className="eyebrow">Seguimiento</p><h1>Reportes</h1></div>
      <div className="report-grid">
        <article><strong>{orders.length}</strong><span>Órdenes totales</span></article>
        <article><strong>{counts.ready ?? 0}</strong><span>Listas para retirar</span></article>
        <article><strong>{overdue.length}</strong><span>Más de 90 días</span></article>
        <article><strong>{formatCurrency(budgetedCents)}</strong><span>Presupuesto acumulado</span></article>
      </div>
      <section className="report-list"><h2>Órdenes vencidas</h2>{overdue.length ? <ul>{overdue.map((order) => <li key={order.order_number}>#{order.order_number} · ingresó el {order.received_on}</li>)}</ul> : <p>No hay órdenes vencidas.</p>}</section>
    </section>
  )
}
