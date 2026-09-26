'use client'

import { useEffect, useState } from 'react'

import { OfflineBanner } from '@/components/offline-banner'
import { createBrowserOrderStore } from '@/lib/offline/order-store'
import type { PendingCreate } from '@/lib/offline/types'

import { OrderTable, type OrderRow, type PersistedOrderRow } from './order-table'

export function mergeCachedPending(serverOrders: PersistedOrderRow[], pendingOrders: PendingCreate[]): OrderRow[] {
  const pending: OrderRow[] = pendingOrders.map((item) => ({
    persistence: 'pending',
    localId: item.localId,
    equipment: item.draft.equipment ?? '',
    status: 'pending',
    budget_cents: null,
    received_on: item.draft.receivedOn ?? item.createdAt.slice(0, 10),
    customers: { full_name: item.draft.customerName ?? '', phone: item.draft.customerPhone ?? '' },
  }))
  return [...pending, ...serverOrders.map((order) => ({ ...order, persistence: 'persisted' as const }))]
}

export function shouldShowOfflineBanner(online: boolean, hasCachedContent: boolean): boolean {
  return !online && hasCachedContent
}

type OrdersWorkspaceProps = {
  orders: PersistedOrderRow[]
  prefetchAllRecent: boolean
}

export function buildOrderCacheRoutes(orders: Array<{ id: string }>, listUrls: string[] = ['/orders']): string[] {
  return [...new Set([...listUrls, ...orders.flatMap((order) => [`/orders/${order.id}`, `/orders/${order.id}/print`])])]
}

async function cacheOrderRoutes(orders: Array<{ id: string }>, listUrls: string[] = ['/orders']) {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.ready
  registration.active?.postMessage({ type: 'CACHE_ORDER_ROUTES', urls: buildOrderCacheRoutes(orders, listUrls) })
}

export function OrdersWorkspace({ orders, prefetchAllRecent }: OrdersWorkspaceProps) {
  const [online, setOnline] = useState(true)
  const [rows, setRows] = useState<OrderRow[]>(orders.map((order) => ({ ...order, persistence: 'persisted' })))

  useEffect(() => {
    const refresh = async () => {
      const isOnline = navigator.onLine
      setOnline(isOnline)
      const pending = await createBrowserOrderStore().listPending()
      setRows(mergeCachedPending(orders, pending))
    }
    const preload = async () => {
      if (!navigator.onLine) return
      const all = [...orders]
      const listUrls = ['/orders']
      if (prefetchAllRecent) {
        try {
          const first = await fetch('/api/orders')
          if (!first.ok) throw new Error('Could not preload recent orders')
          const firstPage = await first.json()
          const pages = Math.ceil((firstPage.total ?? 0) / (firstPage.pageSize ?? 25))
          all.splice(0, all.length, ...(firstPage.orders ?? []))
          for (let page = 2; page <= pages; page += 1) {
            const response = await fetch(`/api/orders?page=${page}`)
            if (!response.ok) throw new Error('Could not preload a recent orders page')
            const body = await response.json()
            all.push(...(body.orders ?? []))
            listUrls.push(`/orders?page=${page}`)
          }
        } catch {
          // The current server-rendered page remains available; the worker cannot prefetch more routes offline.
        }
      }
      await cacheOrderRoutes(all, listUrls)
    }
    void refresh()
    void preload()
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    window.addEventListener('adan-offline-sync', refresh)
    return () => {
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
      window.removeEventListener('adan-offline-sync', refresh)
    }
  }, [orders, prefetchAllRecent])

  return <><OfflineBanner visible={shouldShowOfflineBanner(online, rows.length > 0)} /><OrderTable orders={rows} /></>
}
