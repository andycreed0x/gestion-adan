'use client'

import { formatCurrency, orderStatusLabels, type OrderStatus } from '@/lib/orders'

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

type OrderTableProps = {
  orders: OrderRow[]
  deleteAction?: (formData: FormData) => void | Promise<void>
}

export function OrderTable({ orders, deleteAction }: OrderTableProps) {
  if (!orders.length) return <p className="empty-state">No hay órdenes que coincidan con la búsqueda.</p>

  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Orden</th><th>Cliente</th><th>Equipo</th><th>Estado</th><th>Presupuesto</th><th>Ingreso</th><th>Acciones</th></tr></thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.persistence === 'pending' ? order.localId : order.id}>
              <td>{order.persistence === 'pending' ? <a href={`/orders/new?pending=${order.localId}`}>Pendiente</a> : <a href={`/orders/${order.id}`}>#{order.order_number}</a>}</td>
              <td>{order.customers?.full_name ?? 'Sin cliente'}<br /><small>{order.customers?.phone}</small></td>
              <td>{order.equipment}</td>
              <td><span className={`status status-${order.status}`}>{order.persistence === 'pending' ? 'Pendiente' : orderStatusLabels[order.status as OrderStatus]}</span></td>
              <td>{formatCurrency(order.budget_cents)}</td>
              <td>{order.received_on}</td>
              <td>{order.persistence === 'pending' || !deleteAction ? null : <form action={deleteAction} onSubmit={(event) => {
                if (!window.confirm(`¿Borrar definitivamente la orden #${order.order_number}?`)) event.preventDefault()
              }}><input type="hidden" name="orderId" value={order.id} /><button type="submit" className="button-danger" aria-label={`Borrar orden #${order.order_number}`}>Borrar</button></form>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
