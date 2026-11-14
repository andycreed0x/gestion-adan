'use client'

import { useState } from 'react'

import { completeOfflineLogout, logoutOffline } from '@/lib/offline/browser-runtime'

type LogoutButtonProps = { action: () => Promise<void> }

export function LogoutButton({ action }: LogoutButtonProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <form action={async () => {
    setBusy(true)
    setError('')
    try { await logoutOffline() } catch {
      setError('No se pudo limpiar la copia privada. Reintentá salir.')
      setBusy(false)
      return
    }
    try { await action() } finally { completeOfflineLogout() }
  }}>
    <button className="link-button" type="submit" disabled={busy}>Salir</button>
    {error ? <small role="alert">{error}</small> : null}
  </form>
}
