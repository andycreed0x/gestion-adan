import type { OrderStatus } from './orders'

type TicketFields = {
  customerName: string
  customerAddress: string
  customerPhone: string
  equipment: string
  accessories: string
  reportedFault: string
  resolution: string
  budgetCents: number | null
  status: OrderStatus
  receivedOn: string
  pickedUpOn: string | null
}

export type OrderTicket = TicketFields & (
  | { persistence: 'persisted'; orderNumber: number }
  | { persistence: 'pending' }
)

export type OrderTicketField = { label: string; value: string }

function field(label: string, value: string): OrderTicketField {
  return { label, value: value || '—' }
}

export function buildOrderTicketRows(ticket: OrderTicket): OrderTicketField[][] {
  return [
    [ticket.persistence === 'persisted' ? field('N° Orden', String(ticket.orderNumber)) : field('Orden', 'Pendiente de sincronización')],
    [field('Cliente', ticket.customerName), field('Teléfono', ticket.customerPhone)],
    [field('Equipo', ticket.equipment), field('Accesorios', ticket.accessories)],
    [field('Falla reportada', ticket.reportedFault), field('Fecha de ingreso', ticket.receivedOn)],
  ]
}
