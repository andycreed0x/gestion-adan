import { formatCurrency, type OrderStatus } from './orders'

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

export function buildOrderTicketLines(ticket: OrderTicket): string[] {
  const lines = [
    'ORDEN DE REPARACIÓN',
    ...(ticket.persistence === 'persisted' ? [`N° Orden: ${ticket.orderNumber}`] : ['Pendiente de sincronización']),
    `Cliente: ${ticket.customerName}`,
    `Dirección: ${ticket.customerAddress}`,
    `Teléfono: ${ticket.customerPhone}`,
    `Equipo: ${ticket.equipment}`,
    `Accesorios: ${ticket.accessories}`,
    `Falla reportada: ${ticket.reportedFault}`,
    `Resolución: ${ticket.resolution}`,
    `Presupuesto: ${formatCurrency(ticket.budgetCents)}`,
    `Estado: ${ticket.status}`,
    `Fecha de ingreso: ${ticket.receivedOn}`,
    `Fecha de retiro: ${ticket.pickedUpOn ?? ''}`,
  ]

  return lines.filter((line) => !line.endsWith(': '))
}
