export const orderStatuses = [
  'received',
  'in_progress',
  'ready',
  'picked_up',
  'cancelled',
] as const

export type OrderStatus = (typeof orderStatuses)[number]

export const orderStatusLabels: Record<OrderStatus, string> = {
  received: 'Recibida',
  in_progress: 'En reparación',
  ready: 'Lista para retirar',
  picked_up: 'Retirada',
  cancelled: 'Cancelada',
}

export function parseBudgetCents(raw: string): number | null {
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
    if (!/^\d+$/.test(fraction)) {
      throw new Error('El presupuesto debe ser numérico')
    }
    if (fraction.length > 2) {
      const hasMixedSeparators = comma >= 0 && dot >= 0
      const groupingOnly = decimalSeparator === '.'
        ? /^\d{1,3}(?:\.\d{3})+$/
        : /^\d{1,3}(?:,\d{3})+$/
      if (hasMixedSeparators || !groupingOnly.test(value)) {
        throw new Error('El presupuesto admite como máximo dos decimales')
      }
      normalized = value.replace(/[.,]/g, '')
    } else {
      normalized = `${integerPart.replace(/[.,]/g, '')}.${fraction}`
    }
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

const currencyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
})

export function formatCurrency(cents: number | null): string {
  return cents === null ? 'Sin presupuesto' : currencyFormatter.format(cents / 100)
}

