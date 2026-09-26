const invalidPhoneMessage = 'Ingresá un teléfono argentino válido'

export function normalizeArgentinePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null

  const nationalDigits = digits.startsWith('549')
    ? digits.slice(3)
    : digits.startsWith('54')
      ? digits.slice(2)
      : digits

  return nationalDigits.length === 10 ? `549${nationalDigits}` : null
}

export function validateArgentinePhone(raw: string): string | null {
  return raw.trim() && !normalizeArgentinePhone(raw) ? invalidPhoneMessage : null
}
