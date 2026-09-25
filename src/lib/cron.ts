export function hasValidCronSecret(
  authorization: string | null | undefined,
  expectedSecret: string | undefined,
): boolean {
  return Boolean(expectedSecret) && authorization === `Bearer ${expectedSecret}`
}
