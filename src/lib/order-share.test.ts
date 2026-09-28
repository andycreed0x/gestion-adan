import { describe, expect, it } from 'vitest'

import { buildWhatsAppOrderUrl } from './order-share'
import { formatCurrency } from './orders'

const order = {
  persistence: 'persisted' as const,
  orderNumber: 9380,
  customerName: 'Ana Pérez',
  customerAddress: 'Rivadavia 123',
  customerPhone: '11 4444-5555',
  equipment: 'TV Samsung',
  accessories: 'Control remoto',
  reportedFault: 'No enciende',
  resolution: 'Pendiente',
  budgetCents: 125000,
  status: 'ready' as const,
  receivedOn: '2026-09-26',
  pickedUpOn: '2026-09-27',
}

describe('WhatsApp order sharing', () => {
  it('builds a complete wa.me summary for a persisted order', () => {
    const url = buildWhatsAppOrderUrl(order)

    expect(url?.host).toBe('wa.me')
    expect(url?.pathname).toBe('/1144445555')
    const message = url?.searchParams.get('text') ?? ''
    expect(message).toBe(
      'Hola Ana Pérez! 👋 Te escribimos de Servicio Técnico ADAN.\n\n'
      + 'Te pasamos el presupuesto de tu equipo (TV Samsung) correspondiente a la Orden #9380:\n'
      + `💰 Presupuesto: ${formatCurrency(125000)}\n\n`
      + 'Por favor, avísanos si estás de acuerdo para avanzar con la reparación. ¡Muchas gracias!',
    )
  })

  it('refuses pending or phone-less orders', () => {
    expect(buildWhatsAppOrderUrl({ ...order, persistence: 'pending' })).toBeNull()
    expect(buildWhatsAppOrderUrl({ ...order, customerPhone: '' })).toBeNull()
  })
})
