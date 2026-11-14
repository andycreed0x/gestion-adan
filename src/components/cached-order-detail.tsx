'use client'

import { useEffect, useState } from 'react'

import { OfflineBanner } from '@/components/offline-banner'
import { createBrowserOrderStore } from '@/lib/offline/order-store'
import type { CachedOrder } from '@/lib/offline/types'

export function CachedOrderDetail({ order }: { order: CachedOrder }) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      const cached = await createBrowserOrderStore().getOrder(order.id)
      if (!cancelled) setVisible(!navigator.onLine && Boolean(cached))
    }
    void refresh()
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    return () => { cancelled = true; window.removeEventListener('online', refresh); window.removeEventListener('offline', refresh) }
  }, [order.id])
  return <OfflineBanner visible={visible} />
}
