export function getSafeRedirect(value: string | null | undefined): string {
  if (!value?.startsWith('/') || value.startsWith('//')) return '/orders'
  return value
}
