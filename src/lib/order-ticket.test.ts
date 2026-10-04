import { describe, expect, it } from 'vitest'

import { buildOrderTicketLines } from './order-ticket'

describe('order ticket lines', () => {
  it('includes the persisted number once and omits the duplicate title and budget field', () => {
    const lines = buildOrderTicketLines({
      persistence: 'persisted',
      orderNumber: 1234,
      customerName: 'Ana Pérez',
      customerAddress: 'Rivadavia 123',
      customerPhone: '1144445555',
      equipment: 'TV Samsung',
      accessories: '',
      reportedFault: 'No enciende',
      resolution: '',
      budgetCents: 125000,
      status: 'received',
      receivedOn: '2026-10-04',
      pickedUpOn: null,
    })

    expect(lines.filter((line) => line.startsWith('N° Orden:'))).toEqual(['N° Orden: 1234'])
    expect(lines).not.toContain('ORDEN DE REPARACIÓN')
    expect(lines.some((line) => line.startsWith('Presupuesto:'))).toBe(false)
    expect(lines).toContain('Cliente: Ana Pérez')
  })

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
