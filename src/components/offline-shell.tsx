'use client'

import { type FormEvent, useEffect, useState } from 'react'

import { OfflineRuntime } from '@/components/offline-runtime'
import { OrderForm } from '@/components/order-form'
import { OrderTable } from '@/components/order-table'
import { OrderTicketFields, OrderTicketFooter, OrderTicketHeader } from '@/components/order-ticket-layout'
import { PendingOrderDetail } from '@/components/pending-order-detail'
import { PrintButton } from '@/components/print-button'
import { orderListHref } from '@/lib/order-list'
import { buildOrderTicketRows } from '@/lib/order-ticket'
import { countQuarantinedPending, createBrowserOrderStore, getActiveBrowserOwner, getBrowserIdentity } from '@/lib/offline/order-store'
import { shellOrderPage } from '@/lib/offline/shell-list'
import type { CachedOrder, OfflineSnapshot, PendingCreate } from '@/lib/offline/types'
import { formatCurrency, orderStatusLabels, orderStatuses } from '@/lib/orders'

type ShellData = {
  url: URL
  snapshot: OfflineSnapshot | null
  pending: PendingCreate[]
  order: CachedOrder | null
  quarantined: number
}
type ShellState = { ownerId: string | null; status: 'loading' | 'locked' | 'error' | 'ready'; data: ShellData | null }

function routeOrderId(url: URL) {
  return /^\/orders\/([\w-]+)(?:\/print)?\/?$/.exec(url.pathname)?.[1] ?? null
}

function LocalOrderList({ data, navigate }: { data: ShellData; navigate: (url: string) => void }) {
  const { filters, page, totalPages, total, rows } = shellOrderPage(data.snapshot?.orders ?? [], data.pending, data.url.searchParams)
  const filter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const params = new URLSearchParams()
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === 'string' && value) params.set(key, value)
    }
    navigate(params.size ? `/orders?${params}` : '/orders')
  }
  return (
    <section className="page-section">
      <div className="page-heading"><h1>Órdenes de reparación</h1><a className="button" href="/orders/new">Nueva orden</a></div>
      <form className="search-form" onSubmit={filter} key={data.url.search}>
        <input name="q" aria-label="Buscar órdenes" defaultValue={filters.q} placeholder="Buscar por número, cliente, teléfono o equipo" />
        <select name="status" aria-label="Estado" defaultValue={filters.status}><option value="">Todos los estados</option>{orderStatuses.map((status) => <option key={status} value={status}>{orderStatusLabels[status]}</option>)}</select>
        <label>Desde<input name="receivedFrom" type="date" defaultValue={filters.receivedFrom} /></label>
        <label>Hasta<input name="receivedTo" type="date" defaultValue={filters.receivedTo} /></label>
        <button type="submit">Filtrar</button>
      </form>
      <p className="muted">{total} órdenes · Página {page} de {totalPages} · Solo datos guardados en este navegador.</p>
      <OrderTable orders={rows} />
      <nav className="filter-actions" aria-label="Paginación de órdenes">
        {page > 1 ? <a className="button secondary" href={orderListHref(filters, page - 1)}>Anterior</a> : null}
        {page < totalPages ? <a className="button secondary" href={orderListHref(filters, page + 1)}>Siguiente</a> : null}
        <a href="/orders">Limpiar filtros</a>
      </nav>
    </section>
  )
}

function LocalOrder({ order, print, autoPrint }: { order: CachedOrder; print: boolean; autoPrint: boolean }) {
  if (print) return (
    <section className="ticket-page">
      <div className="ticket-actions"><PrintButton autoPrint={autoPrint} /></div>
      <article className="ticket">
        <OrderTicketHeader />
        <OrderTicketFields rows={buildOrderTicketRows({ ...order, persistence: 'persisted' })} />
        <OrderTicketFooter />
      </article>
    </section>
  )
  const fields = [
    ['Cliente', order.customerName], ['Teléfono', order.customerPhone], ['Dirección', order.customerAddress],
    ['Equipo', order.equipment], ['Accesorios', order.accessories], ['Falla reportada', order.reportedFault],
    ['Resolución', order.resolution], ['Presupuesto', formatCurrency(order.budgetCents)],
    ['Estado', orderStatusLabels[order.status]], ['Fecha de ingreso', order.receivedOn], ['Fecha de retiro', order.pickedUpOn],
  ]
  return (
    <section className="page-section">
      <div className="page-heading"><h1>Orden #{order.orderNumber}</h1><a className="button" href={`/orders/${order.id}/print`}>Imprimir ticket</a></div>
      <p className="muted">Consulta de solo lectura. Edición, eliminación, WhatsApp y adjuntos requieren conexión.</p>
      <dl>{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>
    </section>
  )
}

export function OfflineShell() {
  // Initial markup is deliberately public, deterministic and safe to prerender.
  const [state, setState] = useState<ShellState>({ ownerId: null, status: 'loading', data: null })
  const [revision, setRevision] = useState(0)
  const [preparationError, setPreparationError] = useState(false)

  useEffect(() => {
    let disposed = false
    let generation = 0
    let expiryTimer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      const current = ++generation
      const ownerId = getActiveBrowserOwner()
      clearTimeout(expiryTimer)
      const identity = getBrowserIdentity()
      if (ownerId && identity?.ownerId === ownerId) {
        expiryTimer = setTimeout(() => { void refresh() }, Math.min(2_147_483_647, Math.max(0, identity.expiresAt - Date.now()) + 1))
      }
      // Drop rendered private content synchronously when identity changes.
      setState((previous) => ownerId && previous.ownerId === ownerId && previous.data
        ? previous
        : { ownerId, status: ownerId ? 'loading' : 'locked', data: null })
      if (!ownerId) return
      try {
        const store = createBrowserOrderStore()
        const url = new URL(window.location.href)
        const [snapshot, pending, quarantined] = await Promise.all([
          store.getRecentSnapshot(), store.listPending(), countQuarantinedPending(),
        ])
        if (snapshot && (snapshot.schemaVersion !== 1 || snapshot.ownerId !== ownerId)) throw new Error('Snapshot de otra cuenta')
        const id = routeOrderId(url)
        const order = id && id !== 'new' ? snapshot?.orders.find((item) => item.id === id) ?? await store.getOrder(id) : null
        if (disposed || current !== generation) return
        if (getActiveBrowserOwner() !== ownerId) {
          setState({ ownerId: null, status: 'locked', data: null })
          return
        }
        setState({ ownerId, status: 'ready', data: { url, snapshot, pending, order, quarantined } })
      } catch {
        if (!disposed && current === generation) setState({ ownerId: null, status: 'error', data: null })
      }
    }
    const events = ['adan-offline-identity', 'adan-offline-sync', 'adan-offline-snapshot', 'popstate', 'focus']
    const update = () => { void refresh() }
    const preparationFailed = () => setPreparationError(true)
    const preparationReady = () => setPreparationError(false)
    window.addEventListener('adan-offline-error', preparationFailed)
    window.addEventListener('adan-offline-ready', preparationReady)
    void refresh()
    events.forEach((name) => window.addEventListener(name, update))
    return () => {
      disposed = true
      clearTimeout(expiryTimer)
      window.removeEventListener('adan-offline-error', preparationFailed)
      window.removeEventListener('adan-offline-ready', preparationReady)
      generation += 1
      events.forEach((name) => window.removeEventListener(name, update))
    }
  }, [revision])

  const navigate = (url: string) => {
    window.history.pushState(null, '', url)
    setRevision((value) => value + 1)
  }
  const data = state.data
  const isNew = data?.url.pathname.replace(/\/$/, '') === '/orders/new'
  const isList = data?.url.pathname === '/offline' || /^\/orders\/?$/.test(data?.url.pathname ?? '')
  const print = /\/print\/?$/.test(data?.url.pathname ?? '')
  const pendingId = isNew ? data?.url.searchParams.get('pending') : null

  return (
    <div className="app-shell">
      <header className="app-header no-print"><a className="brand" href="/orders">Servicio Técnico ADAN</a><nav><a href="/orders">Órdenes</a></nav></header>
      {state.ownerId ? <OfflineRuntime key={state.ownerId} /> : null}
      <main className="app-main">
        <p className="offline-banner no-print" role="status">Modo offline · Datos locales de este navegador</p>
        {state.status === 'loading' ? <p>Cargando datos locales…</p> : null}
        {state.status === 'locked' ? <p role="alert">Iniciá sesión con conexión para habilitar tus datos offline. No hay una cuenta activa guardada.</p> : null}
        {state.status === 'error' ? <p role="alert">No se pudieron leer los datos locales de tu cuenta. Volvé a iniciar sesión con conexión.</p> : null}
        {data ? <>
          {preparationError && data.snapshot ? <p className="form-error no-print" role="status">Preparación offline incompleta: no se pudo confirmar la disponibilidad del shell y sus recursos. Volvé a intentar con conexión.</p> : null}
          {!data.snapshot ? <p className="form-error no-print" role="status">Preparación offline incompleta: no hay un conjunto reciente guardado. Solo están disponibles las órdenes locales y pendientes que se puedan leer.</p> : <p className="muted no-print">Copia local desde {data.snapshot.windowStart} · Actualizada {data.snapshot.generatedAt}. Puede haber cambios más recientes en el servidor.</p>}
          {data.quarantined > 0 ? <p className="muted no-print">{data.quarantined} pendientes heredados conservados para recuperación manual explícita. No se asignarán ni enviarán a esta cuenta automáticamente.</p> : null}
          {isList ? <LocalOrderList data={data} navigate={navigate} /> : <>
            <p className="no-print"><a href="/orders">← Volver a órdenes</a></p>
            {isNew ? pendingId ? <PendingOrderDetail localId={pendingId} autoPrint={data.url.searchParams.get('print') === '1'} /> : <section className="page-section"><h1>Nueva orden</h1><OrderForm mode="create" submitLabel="Guardar orden" /></section>
              : data.order ? <LocalOrder order={data.order} print={print} autoPrint={data.url.searchParams.get('autoPrint') !== '0'} /> : <p role="alert">Esta orden no está disponible en este navegador. Necesitás conexión para consultarla.</p>}
          </>}
        </> : null}
      </main>
    </div>
  )
}
