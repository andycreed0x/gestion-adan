'use client'

import { useEffect, useRef, useState } from 'react'

import { buildOrderTicketRows } from '@/lib/order-ticket'
import { createBrowserOrderStore } from '@/lib/offline/order-store'
import { syncBrowserPending } from '@/lib/offline/browser-runtime'
import type { PendingCreate } from '@/lib/offline/types'

import { OrderTicketFields, OrderTicketFooter, OrderTicketHeader } from './order-ticket-layout'

export function PendingOrderDetail({ localId, autoPrint = false }: { localId: string; autoPrint?: boolean }) {
  const [pending, setPending] = useState<PendingCreate | null>(null)
  const [missing, setMissing] = useState(false)
  const hasAutoPrinted = useRef(false)

  const refresh = async () => {
    const store = createBrowserOrderStore()
    const next = await store.getPending(localId)
    if (!next) {
      const persisted = await store.takePersistedForPending(localId)
      if (persisted) {
        window.location.replace(`/orders/${persisted.id}`)
        return
      }
    }
    setPending(next)
    setMissing(!next)
  }

  useEffect(() => {
    void refresh()
    window.addEventListener('adan-offline-sync', refresh)
    return () => window.removeEventListener('adan-offline-sync', refresh)
  }, [localId])

  useEffect(() => {
    if (!autoPrint || !pending || hasAutoPrinted.current) return
    hasAutoPrinted.current = true
    window.print()
  }, [autoPrint, pending])

  if (missing) return <p className="form-error">No se encontró la orden pendiente en este navegador.</p>
  if (!pending) return <p className="muted">Cargando orden pendiente…</p>

  const rows = buildOrderTicketRows({
    persistence: 'pending',
    customerName: pending.draft.customerName ?? '',
    customerAddress: pending.draft.customerAddress ?? '',
    customerPhone: pending.draft.customerPhone ?? '',
    equipment: pending.draft.equipment ?? '',
    accessories: pending.draft.accessories ?? '',
    reportedFault: pending.draft.reportedFault ?? '',
    resolution: pending.draft.resolution ?? '',
    budgetCents: null,
    status: (pending.draft.status as 'received' | 'in_progress' | 'ready' | 'picked_up' | 'cancelled' | undefined) ?? 'received',
    receivedOn: pending.draft.receivedOn ?? pending.createdAt.slice(0, 10),
    pickedUpOn: pending.draft.pickedUpOn || null,
  })

  return (
    <section className="pending-order">
      <div className="ticket-actions no-print">
        <button type="button" onClick={() => window.print()}>Imprimir orden</button>
        <button type="button" className="button secondary" onClick={async () => {
          await syncBrowserPending(true).catch((error) => setPending((item) => item ? { ...item, syncError: error.message } : null))
          await refresh()
        }}>Reintentar sincronización</button>
      </div>
      <article className="ticket">
        <OrderTicketHeader />
        <OrderTicketFields rows={rows} />
        <OrderTicketFooter />
      </article>
      {pending.syncError ? <p className="form-error">{pending.syncError}</p> : <p className="muted">La orden todavía no se guardó en la base de datos.</p>}
    </section>
  )
}
