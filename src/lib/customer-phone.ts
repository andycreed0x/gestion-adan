const invalidPhoneMessage = 'Ingresá al menos un número de teléfono'

export function normalizeArgentinePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return null

  return digits
}

export function validateArgentinePhone(raw: string): string | null {
  return raw.trim() && !normalizeArgentinePhone(raw) ? invalidPhoneMessage : null
}
