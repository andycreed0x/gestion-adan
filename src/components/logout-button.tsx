'use client'

import { clearBrowserOrderStore } from '@/lib/offline/order-store'

type LogoutButtonProps = { action: () => Promise<void> }

export function LogoutButton({ action }: LogoutButtonProps) {
  return (
    <form action={action} onSubmit={() => {
      navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_PRIVATE_ORDER_CACHE' })
      void clearBrowserOrderStore()
    }}>
      <button className="link-button" type="submit">Salir</button>
    </form>
  )
}
