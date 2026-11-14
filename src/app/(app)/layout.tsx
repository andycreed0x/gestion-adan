import type { ReactNode } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { logoutAction } from '@/app/login/actions'
import { LogoutButton } from '@/components/logout-button'
import { OfflineRuntime } from '@/components/offline-runtime'
import { PrivateOwnerBoundary } from '@/components/private-owner-boundary'
import { offlineMetadataForVerifiedUser } from '@/lib/offline/session-metadata'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')
  const { data: { session } } = await supabase.auth.getSession()
  const initialIdentity = offlineMetadataForVerifiedUser(user.id, session)

  return (
    <div className="app-shell">
      <header className="app-header">
        <a href="/orders" className="brand">Servicio Técnico ADAN</a>
        <nav>
          <a href="/orders">Órdenes</a>
          <Link href="/reports" prefetch={false}>Reportes</Link>
          <LogoutButton action={logoutAction} />
        </nav>
      </header>
      <OfflineRuntime ownerId={user.id} initialIdentity={initialIdentity ?? undefined} />
      <main className="app-main">{process.env.LOCAL_REAL_DATA_PREVIEW === '1' ? <p className="muted no-print" role="note">Vista local conectada a datos reales</p> : null}<PrivateOwnerBoundary ownerId={user.id}>{children}</PrivateOwnerBoundary></main>
    </div>
  )
}
