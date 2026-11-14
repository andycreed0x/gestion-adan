'use client'

import { useEffect, useState } from 'react'

import { OfflineBanner } from '@/components/offline-banner'
import { createBrowserOrderStore, getActiveBrowserOwner } from '@/lib/offline/order-store'
import { refreshOfflineSnapshot } from '@/lib/offline/browser-runtime'
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
  deleteAction: (formData: FormData) => void | Promise<void>
}

export function OrdersWorkspace({ orders, prefetchAllRecent, deleteAction }: OrdersWorkspaceProps) {
  const [preparation, setPreparation] = useState('Preparación offline incompleta')
  const [online, setOnline] = useState(true)
  const [rows, setRows] = useState<OrderRow[]>(orders.map((order) => ({ ...order, persistence: 'persisted' })))

  useEffect(() => {
    const refresh = async () => {
      const isOnline = navigator.onLine
      setOnline(isOnline)
      const pending = await createBrowserOrderStore().listPending()
      const next = mergeCachedPending(orders, pending)
      setRows((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next)
    }
    const prepare = async () => {
      if (!navigator.onLine || !getActiveBrowserOwner()) return
      try { await refreshOfflineSnapshot() } catch { setPreparation('Preparación offline incompleta: se conserva la copia anterior') }
    }
    const ready = () => { setPreparation('Órdenes recientes disponibles sin conexión'); void refresh() }
    const error = (event: Event) => setPreparation((event as CustomEvent<string>).detail)
    window.addEventListener('adan-offline-ready', ready)
    window.addEventListener('adan-offline-error', error)
    window.addEventListener('adan-offline-invalidated', prepare)
    void refresh()
    void prepare()
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    window.addEventListener('adan-offline-sync', refresh)
    return () => {
      window.removeEventListener('adan-offline-ready', ready)
      window.removeEventListener('adan-offline-error', error)
      window.removeEventListener('adan-offline-invalidated', prepare)
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
      window.removeEventListener('adan-offline-sync', refresh)
    }
  }, [orders, prefetchAllRecent])

  return <><p className="muted no-print" role="status" data-offline-preparation>{preparation}</p><OfflineBanner visible={shouldShowOfflineBanner(online, rows.length > 0)} /><OrderTable orders={rows} deleteAction={deleteAction} /></>
}
