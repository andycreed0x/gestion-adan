import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { logoutAction } from '@/app/login/actions'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link href="/orders" className="brand">Servicio Técnico ADAN</Link>
        <nav>
          <Link href="/orders">Órdenes</Link>
          <Link href="/reports">Reportes</Link>
          <form action={logoutAction}><button className="link-button" type="submit">Salir</button></form>
        </nav>
      </header>
      <main className="app-main">{children}</main>
    </div>
  )
}
