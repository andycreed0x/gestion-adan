import { describe, expect, it } from 'vitest'

import { buildOrderTicketRows } from './order-ticket'

const fields = {
  customerName: 'Ana Pérez',
  customerAddress: 'Rivadavia 123',
  customerPhone: '',
  equipment: 'TV Samsung',
  accessories: 'Control remoto',
  reportedFault: 'No enciende',
  resolution: 'Reemplazar fuente',
  budgetCents: 125000,
  status: 'ready' as const,
  receivedOn: '2026-10-04',
  pickedUpOn: '2026-10-05',
}

describe('order ticket rows', () => {
  it('keeps the approved pairs aligned and omits fields excluded from print', () => {
    expect(buildOrderTicketRows({ ...fields, persistence: 'persisted', orderNumber: 1234 })).toEqual([
      [{ label: 'N° Orden', value: '1234' }],
      [{ label: 'Cliente', value: 'Ana Pérez' }, { label: 'Teléfono', value: '—' }],
      [{ label: 'Equipo', value: 'TV Samsung' }, { label: 'Accesorios', value: 'Control remoto' }],
      [{ label: 'Falla reportada', value: 'No enciende' }, { label: 'Fecha de ingreso', value: '2026-10-04' }],
    ])
  })

  it('marks a locally queued order as pending without an official order number', () => {
    expect(buildOrderTicketRows({ ...fields, persistence: 'pending' })[0]).toEqual([
      { label: 'Orden', value: 'Pendiente de sincronización' },
    ])
  })
})
