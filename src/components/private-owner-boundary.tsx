'use client'

import { type ReactNode, useEffect, useState } from 'react'

import { getBrowserIdentity } from '@/lib/offline/order-store'

export function PrivateOwnerBoundary({ ownerId, children }: { ownerId: string; children: ReactNode }) {
  // Server HTML is authorized by the layout. Subsequent identity changes revoke it.
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      const identity = getBrowserIdentity()
      setVisible(identity?.ownerId === ownerId)
      if (identity?.ownerId === ownerId) timer = setTimeout(refresh, Math.min(identity.expiresAt - Date.now() + 1, 2_147_483_647))
    }
    window.addEventListener('adan-offline-identity', refresh)
    return () => { clearTimeout(timer); window.removeEventListener('adan-offline-identity', refresh) }
  }, [ownerId])
  return visible ? children : <p role="alert">La sesión cambió o venció. <a href="/login">Iniciá sesión con conexión</a> para continuar.</p>
}
