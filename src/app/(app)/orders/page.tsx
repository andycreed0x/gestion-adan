import Link from 'next/link'

import { OrderTable } from '@/components/order-table'
import { createServerSupabaseClient } from '@/lib/supabase/server'

type OrdersPageProps = { searchParams: Promise<{ q?: string }> }

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const { q = '' } = await searchParams
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('repair_orders')
    .select('id, order_number, equipment, status, budget_cents, received_on, picked_up_on, customers(full_name, phone)')
    .order('order_number', { ascending: false })
    .limit(250)
  if (error) throw new Error(error.message)

  const needle = q.trim().toLocaleLowerCase('es-AR')
  const orders = (data ?? []).filter((order) => {
    if (!needle) return true
    const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers
    return [order.order_number, order.equipment, customer?.full_name, customer?.phone]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase('es-AR').includes(needle))
  })

  const tableOrders = orders.map((order) => ({
    ...order,
    customers: Array.isArray(order.customers) ? order.customers[0] ?? null : order.customers,
  }))

  return (
    <section className="page-section">
      <div className="page-heading"><div><p className="eyebrow">Operación diaria</p><h1>Órdenes de reparación</h1></div><Link className="button" href="/orders/new">Nueva orden</Link></div>
      <form className="search-form"><input name="q" defaultValue={q} placeholder="Buscar por número, cliente, teléfono o equipo" /><button type="submit">Buscar</button></form>
      <OrderTable orders={tableOrders} />
    </section>
  )
}
