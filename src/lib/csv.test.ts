import { describe, expect, it } from 'vitest'

import {
  buildOrdersCsv,
  buildOrdersCsvFilename,
  ordersCsvHeader,
  type OrderCsvRow,
} from './csv'

const baseRow: OrderCsvRow = {
  orderNumber: 9380,
  customerName: 'Ana Pérez',
  customerAddress: 'Av. Siempre Viva 742',
  customerPhone: '1144445555',
  equipment: 'Smart TV Samsung',
  accessories: 'Control remoto',
  reportedFault: 'No enciende',
  resolution: 'Cambio de fuente',
  budgetCents: 1_250_000,
  status: 'ready',
  receivedOn: '2026-09-10',
  pickedUpOn: '2026-09-20',
}

describe('buildOrdersCsv', () => {
  it('returns only the header for an empty result', () => {
    expect(buildOrdersCsv([])).toBe('\uFEFF' + ordersCsvHeader.join(';'))
  })

  it('writes the columns in the documented order', () => {
    const [, row] = buildOrdersCsv([baseRow]).split('\r\n')

    expect(row).toBe(
      '9380;Ana Pérez;Av. Siempre Viva 742;1144445555;Smart TV Samsung;Control remoto;' +
      'No enciende;Cambio de fuente;12.500,00;ready;2026-09-10;2026-09-20',
    )
  })

  it('quotes cells holding a semicolon, a quote, or a line break', () => {
    const csv = buildOrdersCsv([{
      ...baseRow,
      reportedFault: 'No enciende; hace "clic"\nal prender',
    }])

    expect(csv).toContain('"No enciende; hace ""clic""\nal prender"')
  })

  it('leaves the budget and the pickup date empty when they are missing', () => {
    const [, row] = buildOrdersCsv([{ ...baseRow, budgetCents: null, pickedUpOn: null }]).split('\r\n')

    expect(row.endsWith('Cambio de fuente;;ready;2026-09-10;')).toBe(true)
  })
})

describe('buildOrdersCsvFilename', () => {
  it('names the file after the requested period', () => {
    expect(buildOrdersCsvFilename({ receivedFrom: '2026-01-01', receivedTo: '2026-03-31' }, '2026-09-25'))
      .toBe('ordenes-2026-01-01_2026-03-31.csv')
  })

  it('keeps the open end visible when only one bound is set', () => {
    expect(buildOrdersCsvFilename({ receivedFrom: '2026-01-01' }, '2026-09-25')).toBe('ordenes-desde-2026-01-01.csv')
    expect(buildOrdersCsvFilename({ receivedTo: '2026-03-31' }, '2026-09-25')).toBe('ordenes-hasta-2026-03-31.csv')
  })

  it('falls back to the current day without a period', () => {
    expect(buildOrdersCsvFilename({}, '2026-09-25')).toBe('ordenes-2026-09-25.csv')
  })
})
