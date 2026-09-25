import { getSafeRedirect } from '@/lib/auth'

import { LoginForm } from './login-form'

type LoginPageProps = {
  searchParams: Promise<{ error?: string; next?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  return <LoginForm error={params.error} next={getSafeRedirect(params.next)} />
}
