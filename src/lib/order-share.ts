import { normalizeArgentinePhone } from './customer-phone'
import { formatCurrency, type OrderStatus } from './orders'

export type ShareableOrder = {
  persistence: 'persisted' | 'pending'
  orderNumber?: number
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

export function buildWhatsAppOrderUrl(order: ShareableOrder): URL | null {
  const phone = normalizeArgentinePhone(order.customerPhone)
  if (order.persistence !== 'persisted' || !order.orderNumber || !phone) return null

  const message = [
    `Orden #${order.orderNumber}`,
    `Cliente: ${order.customerName}`,
    `Teléfono: ${order.customerPhone}`,
    `Dirección: ${order.customerAddress}`,
    `Equipo: ${order.equipment}`,
    `Accesorios: ${order.accessories}`,
    `Falla: ${order.reportedFault}`,
    `Resolución: ${order.resolution}`,
    `Presupuesto: ${formatCurrency(order.budgetCents)}`,
    `Estado: ${order.status}`,
    `Fecha de ingreso: ${order.receivedOn}`,
    `Fecha de retiro: ${order.pickedUpOn ?? 'Pendiente'}`,
  ].join('\n')

  const url = new URL(`https://wa.me/${phone}`)
  url.searchParams.set('text', message)
  return url
}
