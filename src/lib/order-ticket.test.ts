import { describe, expect, it } from 'vitest'

import { buildOrderTicketLines } from './order-ticket'

describe('order ticket lines', () => {
  it('marks a locally queued order as pending without an official order number', () => {
    const lines = buildOrderTicketLines({
      persistence: 'pending',
      customerName: 'Ana Pérez',
      customerAddress: 'Rivadavia 123',
      customerPhone: '11 4444-5555',
      equipment: 'TV Samsung',
      accessories: '',
      reportedFault: 'No enciende',
      resolution: '',
      budgetCents: null,
      status: 'received',
      receivedOn: '2026-09-26',
      pickedUpOn: null,
    })

    expect(lines).toContain('Pendiente de sincronización')
    expect(lines.some((line) => line.startsWith('N° Orden:'))).toBe(false)
  })
})
