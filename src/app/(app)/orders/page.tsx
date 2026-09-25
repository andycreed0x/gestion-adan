import Link from 'next/link'

import { OrderTable } from '@/components/order-table'
import { matchesOrderFilters, orderStatuses, type OrderStatus } from '@/lib/orders'
import { createServerSupabaseClient } from '@/lib/supabase/server'

type OrdersPageProps = {
  searchParams: Promise<{ q?: string; status?: string; receivedFrom?: string; receivedTo?: string }>
}

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const { q = '', status = '', receivedFrom = '', receivedTo = '' } = await searchParams
  const selectedStatus = orderStatuses.includes(status as OrderStatus) ? status as OrderStatus : ''
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('repair_orders')
    .select('id, order_number, equipment, status, budget_cents, received_on, picked_up_on, customers(full_name, phone)')
    .order('order_number', { ascending: false })
    .limit(250)
  if (error) throw new Error(error.message)

  const orders = (data ?? []).filter((order) => {
    const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers
    return matchesOrderFilters({
      orderNumber: order.order_number,
      equipment: order.equipment,
      customerName: customer?.full_name,
      customerPhone: customer?.phone,
      status: order.status as OrderStatus,
      receivedOn: order.received_on,
    }, { query: q, status: selectedStatus, receivedFrom, receivedTo })
  })

  const tableOrders = orders.map((order) => ({
    ...order,
    customers: Array.isArray(order.customers) ? order.customers[0] ?? null : order.customers,
  }))

  const activeFilters = new URLSearchParams()
  if (q) activeFilters.set('q', q)
  if (selectedStatus) activeFilters.set('status', selectedStatus)
  if (receivedFrom) activeFilters.set('receivedFrom', receivedFrom)
  if (receivedTo) activeFilters.set('receivedTo', receivedTo)
  const filterQuery = activeFilters.toString()

  return (
    <section className="page-section">
      <div className="page-heading"><div><p className="eyebrow">Operación diaria</p><h1>Órdenes de reparación</h1></div><Link className="button" href="/orders/new">Nueva orden</Link></div>
      <form className="search-form">
        <input name="q" defaultValue={q} placeholder="Buscar por número, cliente, teléfono o equipo" />
        <select name="status" defaultValue={selectedStatus}><option value="">Todos los estados</option>{orderStatuses.map((option) => <option key={option} value={option}>{option}</option>)}</select>
        <label>Desde<input name="receivedFrom" type="date" defaultValue={receivedFrom} /></label>
        <label>Hasta<input name="receivedTo" type="date" defaultValue={receivedTo} /></label>
        <button type="submit">Filtrar</button>
      </form>
      <div className="filter-actions">
        <a className="button secondary" href={filterQuery ? `/orders/export?${filterQuery}` : '/orders/export'}>Descargar CSV</a>
        {filterQuery ? <Link href="/orders">Limpiar filtros</Link> : null}
        <span className="muted">{tableOrders.length} órdenes</span>
      </div>
      <OrderTable orders={tableOrders} />
    </section>
  )
}
