import type { OrderStatus } from './orders'

export type OrderCsvRow = {
  orderNumber: number
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

export const ordersCsvHeader = [
  'N° Orden',
  'Cliente',
  'Dirección',
  'Teléfono',
  'Equipo',
  'Accesorios',
  'Falla reportada',
  'Resolución',
  'Presupuesto',
  'Estado',
  'Fecha de ingreso',
  'Fecha de retiro',
] as const

const budgetFormatter = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function escapeCell(value: string): string {
  if (!/[";\r\n]/.test(value)) return value
  return '"' + value.replace(/"/g, '""') + '"'
}

function formatBudget(cents: number | null): string {
  if (cents === null) return ''
  return budgetFormatter.format(cents / 100)
}

// Excel in Spanish splits columns on semicolons and needs the BOM to detect UTF-8.
export function buildOrdersCsv(rows: OrderCsvRow[]): string {
  const lines = [ordersCsvHeader.join(';')]

  for (const row of rows) {
    lines.push([
      String(row.orderNumber),
      row.customerName,
      row.customerAddress,
      row.customerPhone,
      row.equipment,
      row.accessories,
      row.reportedFault,
      row.resolution,
      formatBudget(row.budgetCents),
      row.status,
      row.receivedOn,
      row.pickedUpOn ?? '',
    ].map(escapeCell).join(';'))
  }

  return '\uFEFF' + lines.join('\r\n')
}

export function buildOrdersCsvFilename(
  filters: { receivedFrom?: string; receivedTo?: string },
  today: string,
): string {
  const from = filters.receivedFrom ?? ''
  const to = filters.receivedTo ?? ''
  if (from && to) return `ordenes-${from}_${to}.csv`
  if (from) return `ordenes-desde-${from}.csv`
  if (to) return `ordenes-hasta-${to}.csv`
  return `ordenes-${today}.csv`
}

