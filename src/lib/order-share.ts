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

  const customer = order.customerName.trim() || 'cliente'
  const message = [
    `Hola ${customer}! 👋 Te escribimos de Servicio Técnico ADAN.`,
    '',
    `Te pasamos el presupuesto de tu equipo (${order.equipment}) correspondiente a la Orden #${order.orderNumber}:`,
    `💰 Presupuesto: ${formatCurrency(order.budgetCents)}`,
    '',
    'Por favor, avísanos si estás de acuerdo para avanzar con la reparación. ¡Muchas gracias!',
  ].join('\n')

  const url = new URL(`https://wa.me/${phone}`)
  url.searchParams.set('text', message)
  return url
}
