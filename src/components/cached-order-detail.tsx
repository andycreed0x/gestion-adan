'use client'

import { useEffect, useState } from 'react'

import { OfflineBanner } from '@/components/offline-banner'
import { createBrowserOrderStore } from '@/lib/offline/order-store'
import type { CachedOrder } from '@/lib/offline/types'

export function CachedOrderDetail({ order }: { order: CachedOrder }) {
  const [online, setOnline] = useState(true)
  const [hasCachedCopy, setHasCachedCopy] = useState(false)

  useEffect(() => {
    const store = createBrowserOrderStore()
    const refresh = async () => {
      const isOnline = navigator.onLine
      setOnline(isOnline)
      if (isOnline) {
        await store.putOrder(order)
        setHasCachedCopy(true)
      } else {
        setHasCachedCopy(Boolean(await store.getOrder(order.id)))
      }
    }
    void refresh()
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    return () => {
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
    }
  }, [order])

  return <OfflineBanner visible={shouldShowOfflineBanner(online, hasCachedCopy)} />
}

function shouldShowOfflineBanner(online: boolean, hasCachedCopy: boolean) {
  return !online && hasCachedCopy
}
