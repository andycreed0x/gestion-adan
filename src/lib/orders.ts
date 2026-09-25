import { z } from 'zod'

export const orderStatuses = [
  'received',
  'in_progress',
  'ready',
  'picked_up',
  'cancelled',
] as const

export type OrderStatus = (typeof orderStatuses)[number]

export type RepairOrderInput = {
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

type ParseSuccess = { success: true; data: RepairOrderInput }
type ParseFailure = { success: false; error: { issues: string[] } }
export type OrderParseResult = ParseSuccess | ParseFailure

const rawOrderSchema = z.object({
  customerName: z.string().trim().min(1, 'El cliente es obligatorio'),
  customerAddress: z.string().trim().optional().default(''),
  customerPhone: z.string().trim().optional().default(''),
  equipment: z.string().trim().min(1, 'El equipo es obligatorio'),
  accessories: z.string().trim().optional().default(''),
  reportedFault: z.string().trim().optional().default(''),
  resolution: z.string().trim().optional().default(''),
  budget: z.string().trim().optional().default(''),
  status: z.enum(orderStatuses).optional().default('received'),
  receivedOn: z.string().date().optional(),
  pickedUpOn: z.string().date().optional().or(z.literal('')).default(''),
})

function parseBudgetCents(raw: string): number | null {
  const value = raw.replace(/\$/g, '').replace(/\s/g, '')
  if (!value) return null

  const comma = value.lastIndexOf(',')
  const dot = value.lastIndexOf('.')
  const decimalSeparator =
    comma >= 0 && dot >= 0
      ? comma > dot
        ? ','
        : '.'
      : comma >= 0
        ? ','
        : dot >= 0
          ? '.'
          : null

  let normalized = value
  if (decimalSeparator) {
    const [integerPart, ...fractionParts] = value.split(decimalSeparator)
    const fraction = fractionParts.join(decimalSeparator)
    if (fraction.length > 2 || !/^\d+$/.test(fraction)) {
      throw new Error('El presupuesto admite como máximo dos decimales')
    }
    normalized = `${integerPart.replace(/[.,]/g, '')}.${fraction}`
  }

  if (!/^-?\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new Error('El presupuesto debe ser numérico')
  }

  const cents = Math.round(Number(normalized) * 100)
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error('El presupuesto debe ser un importe positivo')
  }
  return cents
}

export function parseOrderInput(input: unknown): OrderParseResult {
  const parsed = rawOrderSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      error: { issues: parsed.error.issues.map((issue) => issue.message) },
    }
  }

  try {
    const pickedUpOn = parsed.data.pickedUpOn || null
    return {
      success: true,
      data: {
        customerName: parsed.data.customerName,
        customerAddress: parsed.data.customerAddress,
        customerPhone: parsed.data.customerPhone,
        equipment: parsed.data.equipment,
        accessories: parsed.data.accessories,
        reportedFault: parsed.data.reportedFault,
        resolution: parsed.data.resolution,
        budgetCents: parseBudgetCents(parsed.data.budget),
        status: pickedUpOn ? 'picked_up' : parsed.data.status,
        receivedOn: parsed.data.receivedOn ?? new Date().toISOString().slice(0, 10),
        pickedUpOn,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: {
        issues: [error instanceof Error ? error.message : 'Presupuesto inválido'],
      },
    }
  }
}

export function formatCurrency(cents: number | null): string {
  if (cents === null) return 'Sin presupuesto'
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  }).format(cents / 100)
}

export function makeAttachmentPath(orderId: string, originalName: string): string {
  const name = originalName.split(/[\\/]/).at(-1) ?? ''
  const extension = name.match(/\.([a-zA-Z0-9]{1,10})$/)?.[1]?.toLowerCase() ?? 'bin'
  return `${orderId}/${crypto.randomUUID()}.${extension}`
}

export function isOverdue(
  order: { receivedOn: string; status: OrderStatus },
  today: Date,
): boolean {
  if (order.status === 'picked_up' || order.status === 'cancelled') return false
  const received = new Date(`${order.receivedOn}T00:00:00Z`)
  const reference = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  const elapsedDays = Math.floor((reference.getTime() - received.getTime()) / 86_400_000)
  return elapsedDays > 90
}

const legacyLabels = [
  'N° Orden',
  'Fecha Ingreso',
  'Cliente',
  'Dir',
  'Tel',
  'Equipo',
  'Accesorios',
  'Falla',
  'Resolución',
  'Presupuesto',
  'Fecha Retiro',
] as const

export type LegacyOrder = {
  orderNumber: number
  fields: Partial<Record<(typeof legacyLabels)[number], string>>
}

export function parseLegacyLine(line: string): LegacyOrder {
  const labelPattern = new RegExp(`(?:^|\\s\\|\\s)(${legacyLabels.join('|')}):\\s*`, 'g')
  const matches = [...line.matchAll(labelPattern)]
  const fields: LegacyOrder['fields'] = {}

  for (const [index, match] of matches.entries()) {
    const label = match[1] as (typeof legacyLabels)[number]
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? line.length
    fields[label] = line.slice(start, end).replace(/\s\|\s$/, '').trim()
  }

  const digits = fields['N° Orden']?.replace(/\D/g, '') ?? ''
  if (!digits) throw new Error('La línea no contiene un número de orden válido')

  return { orderNumber: Number(digits), fields }
}
