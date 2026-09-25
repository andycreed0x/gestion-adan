'use server'

import { redirect } from 'next/navigation'

import { getSafeRedirect } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export async function loginAction(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')
  const next = getSafeRedirect(String(formData.get('next') ?? ''))

  if (!email || !password) redirect('/login?error=Completá+email+y+contraseña')

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) redirect('/login?error=Credenciales+inválidas')
  redirect(next)
}

export async function logoutAction() {
  const supabase = await createServerSupabaseClient()
  await supabase.auth.signOut()
  redirect('/login')
}
