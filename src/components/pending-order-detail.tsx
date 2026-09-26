'use client'

import { useEffect, useState } from 'react'

import { buildOrderTicketLines } from '@/lib/order-ticket'
import { createBrowserOrderStore } from '@/lib/offline/order-store'
import { syncPendingOrders } from '@/lib/offline/sync'
import type { PendingCreate } from '@/lib/offline/types'

async function postPendingOrder(pending: PendingCreate) {
  const response = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(pending.draft),
  })
  const body = await response.json().catch(() => ({}))
  return response.ok
    ? { ok: true as const, order: { id: body.id as string, orderNumber: body.order_number as number } }
    : { ok: false as const, error: Object.values(body.fieldErrors ?? {})[0] || body.error || 'No se pudo sincronizar la orden' }
}

export function PendingOrderDetail({ localId }: { localId: string }) {
  const [pending, setPending] = useState<PendingCreate | null>(null)
  const [missing, setMissing] = useState(false)

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

  if (missing) return <p className="form-error">No se encontró la orden pendiente en este navegador.</p>
  if (!pending) return <p className="muted">Cargando orden pendiente…</p>

  const lines = buildOrderTicketLines({
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
          await syncPendingOrders(createBrowserOrderStore(), postPendingOrder)
          await refresh()
        }}>Reintentar sincronización</button>
      </div>
      <article className="ticket">
        {lines.map((line) => <p key={line}>{line}</p>)}
      </article>
      {pending.syncError ? <p className="form-error">{pending.syncError}</p> : <p className="muted">La orden todavía no se guardó en la base de datos.</p>}
    </section>
  )
}
