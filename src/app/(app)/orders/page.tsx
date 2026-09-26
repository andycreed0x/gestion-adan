import Link from 'next/link'

import { OrderTable } from '@/components/order-table'
import { orderListHref, parseOrderListSearchParams, queryOrderPage } from '@/lib/order-list'
import { orderStatuses } from '@/lib/orders'
import { createServerSupabaseClient } from '@/lib/supabase/server'

type OrdersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const filters = parseOrderListSearchParams(await searchParams)
  const supabase = await createServerSupabaseClient()
  const result = await queryOrderPage(supabase, filters)
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize))
  const tableOrders = result.orders.map((order) => ({
    ...order,
    customers: { full_name: order.customer_name, phone: order.customer_phone },
  }))
  const exportQuery = new URLSearchParams()
  if (filters.q) exportQuery.set('q', filters.q)
  if (filters.status) exportQuery.set('status', filters.status)
  if (filters.receivedFrom) exportQuery.set('receivedFrom', filters.receivedFrom)
  if (filters.receivedTo) exportQuery.set('receivedTo', filters.receivedTo)

  return (
    <section className="page-section">
      <div className="page-heading"><div><p className="eyebrow">Operación diaria</p><h1>Órdenes de reparación</h1></div><Link className="button" href="/orders/new">Nueva orden</Link></div>
      <form className="search-form">
        <input name="q" defaultValue={filters.q} placeholder="Buscar por número, cliente, teléfono o equipo" />
        <select name="status" defaultValue={filters.status}><option value="">Todos los estados</option>{orderStatuses.map((option) => <option key={option} value={option}>{option}</option>)}</select>
        <label>Desde<input name="receivedFrom" type="date" defaultValue={filters.receivedFrom} /></label>
        <label>Hasta<input name="receivedTo" type="date" defaultValue={filters.receivedTo} /></label>
        <button type="submit">Filtrar</button>
      </form>
      <div className="filter-actions">
        <a className="button secondary" href={exportQuery.size ? `/orders/export?${exportQuery}` : '/orders/export'}>Descargar CSV</a>
        {!filters.implicitRecentWindow ? <Link href="/orders">Limpiar filtros</Link> : null}
        <span className="muted">{result.total} órdenes · Página {result.page} de {totalPages}</span>
      </div>
      <OrderTable orders={tableOrders} />
      <nav className="filter-actions" aria-label="Paginación de órdenes">
        {result.page > 1 ? <Link className="button secondary" href={orderListHref(filters, result.page - 1)}>Anterior</Link> : <span />}
        {result.page < totalPages ? <Link className="button secondary" href={orderListHref(filters, result.page + 1)}>Siguiente</Link> : null}
      </nav>
    </section>
  )
}
