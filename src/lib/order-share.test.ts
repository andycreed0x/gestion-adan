import { describe, expect, it } from 'vitest'

import { buildWhatsAppOrderUrl } from './order-share'

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
    expect(url?.pathname).toBe('/5491144445555')
    const message = url?.searchParams.get('text') ?? ''
    expect(message).toContain('Orden #9380')
    for (const value of ['Ana Pérez', 'Rivadavia 123', '11 4444-5555', 'TV Samsung', 'Control remoto', 'No enciende', 'Pendiente', 'ready', '2026-09-26', '2026-09-27', '$']) {
      expect(message).toContain(value)
    }
  })

  it('refuses pending or phone-less orders', () => {
    expect(buildWhatsAppOrderUrl({ ...order, persistence: 'pending' })).toBeNull()
    expect(buildWhatsAppOrderUrl({ ...order, customerPhone: '' })).toBeNull()
  })
})
