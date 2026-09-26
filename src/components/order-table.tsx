import Link from 'next/link'

import { formatCurrency } from '@/lib/orders'

export type PersistedOrderRow = {
  persistence?: 'persisted'
  id: string
  order_number: number
  equipment: string
  status: string
  budget_cents: number | null
  received_on: string
  picked_up_on: string | null
  customers: { full_name: string; phone: string } | null
}

export type PendingOrderRow = {
  persistence: 'pending'
  localId: string
  equipment: string
  status: string
  budget_cents: number | null
  received_on: string
  customers: { full_name: string; phone: string } | null
}

export type OrderRow = PersistedOrderRow | PendingOrderRow

export function OrderTable({ orders }: { orders: OrderRow[] }) {
  if (!orders.length) return <p className="empty-state">No hay órdenes que coincidan con la búsqueda.</p>

  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Orden</th><th>Cliente</th><th>Equipo</th><th>Estado</th><th>Presupuesto</th><th>Ingreso</th></tr></thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.persistence === 'pending' ? order.localId : order.id}>
              <td>{order.persistence === 'pending' ? <Link href={`/orders/new?pending=${order.localId}`}>Pendiente</Link> : <Link href={`/orders/${order.id}`}>#{order.order_number}</Link>}</td>
              <td>{order.customers?.full_name ?? 'Sin cliente'}<br /><small>{order.customers?.phone}</small></td>
              <td>{order.equipment}</td>
              <td><span className={`status status-${order.status}`}>{order.persistence === 'pending' ? 'pendiente' : order.status}</span></td>
              <td>{formatCurrency(order.budget_cents)}</td>
              <td>{order.received_on}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
