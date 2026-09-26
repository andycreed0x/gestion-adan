'use client'

import { useEffect } from 'react'

import { createBrowserOrderStore } from '@/lib/offline/order-store'
import { syncPendingOrders } from '@/lib/offline/sync'

async function postPendingOrder(pending: { draft: Record<string, string | undefined> }) {
  const response = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(pending.draft),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const fieldError = body.fieldErrors ? Object.values(body.fieldErrors)[0] : null
    return { ok: false as const, error: fieldError || body.error || 'No se pudo sincronizar la orden' }
  }
  return { ok: true as const, order: { id: body.id as string, orderNumber: body.order_number as number } }
}

export function OfflineRuntime() {
  useEffect(() => {
    const store = createBrowserOrderStore()
    const sync = async () => {
      if (!navigator.onLine) return
      await syncPendingOrders(store, postPendingOrder)
      window.dispatchEvent(new Event('adan-offline-sync'))
    }

    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/order-offline-sw.js').then((registration) => {
        registration.active?.postMessage({ type: 'CACHE_NEW_ORDER_ROUTE' })
      })
    }
    void sync()
    window.addEventListener('online', sync)
    return () => window.removeEventListener('online', sync)
  }, [])

  return null
}
