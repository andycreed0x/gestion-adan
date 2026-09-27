import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { logoutAction } from '@/app/login/actions'
import { LogoutButton } from '@/components/logout-button'
import { OfflineRuntime } from '@/components/offline-runtime'
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
        <a href="/orders" className="brand">Servicio Técnico ADAN</a>
        <nav>
          <a href="/orders">Órdenes</a>
          <Link href="/reports">Reportes</Link>
          <LogoutButton action={logoutAction} />
        </nav>
      </header>
      <OfflineRuntime />
      <main className="app-main">{children}</main>
    </div>
  )
}
