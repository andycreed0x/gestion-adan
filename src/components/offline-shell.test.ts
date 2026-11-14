/* @vitest-environment jsdom */

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OfflinePage from '@/app/offline/page'
import { createBrowserOrderStore, createMemoryOrderStore, getActiveBrowserOwner, getBrowserIdentity, countQuarantinedPending } from '@/lib/offline/order-store'
import type { CachedOrder, OfflineSnapshot, OrderStore } from '@/lib/offline/types'
import { OfflineShell } from './offline-shell'

vi.mock('@/lib/offline/order-store', async (original) => ({
  ...await original<typeof import('@/lib/offline/order-store')>(),
  createBrowserOrderStore: vi.fn(),
  getActiveBrowserOwner: vi.fn(),
  getBrowserIdentity: vi.fn(),
  countQuarantinedPending: vi.fn(),
}))
vi.mock('./offline-runtime', () => ({ OfflineRuntime: () => null }))

function order(number: number, extra: Partial<CachedOrder> = {}): CachedOrder {
  return { id: `synthetic-${number}`, orderNumber: number, customerName: `Cliente ${number}`, customerAddress: 'Dirección sintética', customerPhone: '1144445555', equipment: `TV ${number}`, accessories: 'Control remoto', reportedFault: 'No enciende', resolution: 'Revisión', budgetCents: 1234567, status: 'received', receivedOn: '2026-11-14', pickedUpOn: null, ...extra }
}

const snapshot = (orders: CachedOrder[]): OfflineSnapshot => ({ schemaVersion: 1, ownerId: 'owner-a', windowStart: '2026-10-16', generatedAt: '2026-11-14T12:00:00Z', orders })
let store: OrderStore

beforeEach(async () => {
  window.history.replaceState(null, '', '/orders')
  vi.mocked(getActiveBrowserOwner).mockReturnValue('owner-a')
  vi.mocked(getBrowserIdentity).mockReturnValue(null)
  vi.mocked(countQuarantinedPending).mockResolvedValue(0)
  store = createMemoryOrderStore('owner-a')
  vi.mocked(createBrowserOrderStore).mockReturnValue(store)
  vi.spyOn(window, 'print').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('static offline UI shell', () => {
  it('renders public build-time HTML without reading identity, IndexedDB or private records', () => {
    vi.mocked(createBrowserOrderStore).mockClear()
    vi.mocked(getActiveBrowserOwner).mockClear()
    const html = renderToString(createElement(OfflinePage))
    expect(html).toContain('Cargando datos locales')
    expect(html).not.toContain('Cliente 1')
    expect(createBrowserOrderStore).not.toHaveBeenCalled()
    expect(getActiveBrowserOwner).not.toHaveBeenCalled()
  })

  it('requires a stored active owner even if old records exist', async () => {
    await store.replaceRecentSnapshot(snapshot([order(1)]))
    vi.mocked(getActiveBrowserOwner).mockReturnValue(null)
    render(createElement(OfflineShell))
    expect(await screen.findByText(/Iniciá sesión con conexión/)).toBeTruthy()
    expect(screen.queryByText('Cliente 1')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Nueva orden' })).toBeNull()
    expect(createBrowserOrderStore).not.toHaveBeenCalled()
  })

  it('paginates the snapshot at 25 rows in online order without any order-page fetches', async () => {
    await store.replaceRecentSnapshot(snapshot(Array.from({ length: 52 }, (_, i) => order(i + 1))))
    window.history.replaceState(null, '', '/orders?page=2')
    const fetch = vi.spyOn(globalThis, 'fetch')
    render(createElement(OfflineShell))
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(26)
    expect(within(table).getByRole('link', { name: '#27' }).getAttribute('href')).toBe('/orders/synthetic-27')
    expect(within(table).getByRole('link', { name: '#3' })).toBeTruthy()
    expect(within(table).queryByRole('link', { name: '#2' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Siguiente' }).getAttribute('href')).toBe('/orders?page=3')
    expect(screen.getByText(/52 órdenes.*Página 2 de 3/)).toBeTruthy()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('filters locally with the existing query/status/date parameter names and resets pagination', async () => {
    await store.replaceRecentSnapshot(snapshot([order(1), order(2, { customerName: 'Ana Sintética', status: 'ready' }), order(3, { customerName: 'Ana Sintética', status: 'cancelled' })]))
    window.history.replaceState(null, '', '/orders?q=Ana&status=ready&receivedFrom=2026-11-01&receivedTo=2026-11-14')
    render(createElement(OfflineShell))
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).getByRole('link', { name: '#2' })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar órdenes' }), { target: { value: 'TV 1' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Estado' }), { target: { value: '' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Filtrar' }).closest('form')!)
    expect(await screen.findByRole('link', { name: '#1' })).toBeTruthy()
    expect(window.location.search).toContain('q=TV+1')
    expect(window.location.search).not.toContain('page=')
  })

  it('reads an individually unvisited snapshot detail, read-only with exact budget formatting', async () => {
    await store.replaceRecentSnapshot(snapshot([order(52)]))
    window.history.replaceState(null, '', '/orders/synthetic-52')
    render(createElement(OfflineShell))
    expect(await screen.findByRole('heading', { name: 'Orden #52' })).toBeTruthy()
    expect(screen.getByText(/12\.345,67/)).toBeTruthy()
    expect(screen.getByText('Dirección sintética')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Imprimir ticket' }).getAttribute('href')).toBe('/orders/synthetic-52/print')
    expect(screen.queryByRole('button', { name: /Guardar|Borrar|WhatsApp/ })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText(/adjuntos requieren conexión/)).toBeTruthy()
  })

  it.each([['', 1], ['?autoPrint=0', 0]])('reuses the two-column ticket, conditions and autoPrint semantics (%s)', async (query, prints) => {
    await store.replaceRecentSnapshot(snapshot([order(52)]))
    window.history.replaceState(null, '', `/orders/synthetic-52/print${query}`)
    render(createElement(OfflineShell))
    const article = await screen.findByRole('article')
    const table = within(article).getByRole('table', { name: 'Datos de la orden' })
    expect(table.querySelectorAll('col')).toHaveLength(4)
    expect(Array.from(table.querySelectorAll('tr'), (row) => Array.from(row.children, (cell) => cell.textContent))).toEqual([
      ['N° Orden', '52'], ['Cliente', 'Cliente 52', 'Teléfono', '1144445555'], ['Equipo', 'TV 52', 'Accesorios', 'Control remoto'], ['Falla reportada', 'No enciende', 'Fecha de ingreso', '2026-11-14'],
    ])
    expect(article.querySelectorAll('footer p')).toHaveLength(3)
    expect(within(article).getByText('Las reparaciones tienen 2 meses de garantía sobre lo reparado.')).toBeTruthy()
    expect(window.print).toHaveBeenCalledTimes(prints)
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))
    expect(window.print).toHaveBeenCalledTimes(prints + 1)
  })

  it('does not reprint or discard a creation draft when the browser regains focus', async () => {
    await store.replaceRecentSnapshot(snapshot([order(52)]))
    window.history.replaceState(null, '', '/orders/synthetic-52/print')
    render(createElement(OfflineShell))
    await screen.findByRole('article')
    expect(window.print).toHaveBeenCalledOnce()
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(window.print).toHaveBeenCalledOnce()
    cleanup()
    window.history.replaceState(null, '', '/orders/new')
    render(createElement(OfflineShell))
    fireEvent.change(await screen.findByRole('textbox', { name: /^Nombre/ }), { target: { value: 'Borrador sin guardar' } })
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect((screen.getByRole('textbox', { name: /^Nombre/ }) as HTMLInputElement).value).toBe('Borrador sin guardar')
  })

  it('reports missing detail and incomplete preparation without claiming the order is saved', async () => {
    window.history.replaceState(null, '', '/orders/not-cached')
    render(createElement(OfflineShell))
    expect(await screen.findByText(/Esta orden no está disponible/)).toBeTruthy()
    expect(screen.getByText(/Preparación offline incompleta/)).toBeTruthy()
    expect(window.print).not.toHaveBeenCalled()
  })

  it('distinguishes a successfully saved empty snapshot from incomplete preparation', async () => {
    await store.replaceRecentSnapshot(snapshot([]))
    render(createElement(OfflineShell))
    expect(await screen.findByText(/No hay órdenes que coincidan/)).toBeTruthy()
    expect(screen.queryByText(/Preparación offline incompleta/)).toBeNull()
  })

  it('reuses OrderForm to create and print a local pending order and reloads it via PendingOrderDetail', async () => {
    window.history.replaceState(null, '', '/orders/new')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    render(createElement(OfflineShell))
    fireEvent.change(await screen.findByRole('textbox', { name: /^Nombre/ }), { target: { value: 'Cliente offline' } })
    fireEvent.change(screen.getByRole('textbox', { name: /^Tipo \/ marca \/ modelo/ }), { target: { value: 'TV sintética' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar e Imprimir' }))
    expect(await screen.findByText('Pendiente de sincronización')).toBeTruthy()
    expect(window.print).toHaveBeenCalledOnce()
    expect(await store.listPending()).toHaveLength(1)
    cleanup()
    render(createElement(OfflineShell))
    expect(await screen.findByText('Cliente offline')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Órdenes' }).getAttribute('href')).toBe('/orders')
    expect(screen.queryByText('N° Orden')).toBeNull()
  })

  it('includes pending orders in the local list and warns about quarantined legacy records without exposing them', async () => {
    await store.enqueueCreate({ localId: 'local-synthetic', createdAt: '2026-11-14T11:00:00Z', draft: { customerName: 'Cliente pendiente', equipment: 'Radio' } })
    vi.mocked(countQuarantinedPending).mockResolvedValue(2)
    render(createElement(OfflineShell))
    expect(await screen.findByRole('link', { name: 'Pendiente' })).toBeTruthy()
    expect(screen.getByText(/2 pendientes heredados.*recuperación manual/)).toBeTruthy()
  })

  it('hides already rendered private data immediately on logout and prevents a stale read from restoring it', async () => {
    await store.replaceRecentSnapshot(snapshot([order(52)]))
    render(createElement(OfflineShell))
    expect(await screen.findByText('Cliente 52')).toBeTruthy()
    let finishRead!: (value: OfflineSnapshot) => void
    vi.spyOn(store, 'getRecentSnapshot').mockImplementation(() => new Promise((resolve) => { finishRead = resolve }))
    act(() => { window.dispatchEvent(new Event('adan-offline-sync')) })
    vi.mocked(getActiveBrowserOwner).mockReturnValue(null)
    act(() => { window.dispatchEvent(new Event('adan-offline-identity')) })
    expect(screen.queryByText('Cliente 52')).toBeNull()
    await act(async () => { finishRead(snapshot([order(52)])) })
    expect(await screen.findByText(/Iniciá sesión con conexión/)).toBeTruthy()
    expect(screen.queryByText('Cliente 52')).toBeNull()
  })

  it('clears private content at the stored identity expiry without waiting for another interaction', async () => {
    await store.replaceRecentSnapshot(snapshot([order(52)]))
    const expiresAt = Date.now() + 5000
    vi.mocked(getBrowserIdentity).mockReturnValue({ ownerId: 'owner-a', epoch: 'epoch-a', expiresAt })
    vi.mocked(getActiveBrowserOwner).mockImplementation(() => Date.now() < expiresAt ? 'owner-a' : null)
    vi.useFakeTimers()
    render(createElement(OfflineShell))
    await act(async () => {})
    expect(screen.getByText('Cliente 52')).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(5001) })
    expect(screen.queryByText('Cliente 52')).toBeNull()
    expect(screen.getByText(/Iniciá sesión con conexión/)).toBeTruthy()
  })

  it('shows preparation failures even when a data snapshot is already saved', async () => {
    await store.replaceRecentSnapshot(snapshot([order(52)]))
    render(createElement(OfflineShell))
    await screen.findByText('Cliente 52')
    act(() => { window.dispatchEvent(new Event('adan-offline-error')) })
    expect(screen.getByText(/Preparación offline incompleta/)).toBeTruthy()
    act(() => { window.dispatchEvent(new Event('adan-offline-ready')) })
    expect(screen.queryByText(/Preparación offline incompleta/)).toBeNull()
  })

  it('clears the previous account while loading a newly active account', async () => {
    await store.replaceRecentSnapshot(snapshot([order(52)]))
    render(createElement(OfflineShell))
    await screen.findByText('Cliente 52')
    const next = createMemoryOrderStore('owner-b')
    await next.replaceRecentSnapshot({ ...snapshot([order(99)]), ownerId: 'owner-b' })
    vi.mocked(createBrowserOrderStore).mockReturnValue(next)
    vi.mocked(getActiveBrowserOwner).mockReturnValue('owner-b')
    act(() => { window.dispatchEvent(new Event('adan-offline-identity')) })
    expect(screen.queryByText('Cliente 52')).toBeNull()
    expect(await screen.findByText('Cliente 99')).toBeTruthy()
    expect(screen.queryByText('Cliente 52')).toBeNull()
  })

  it('rejects a snapshot with an owner different from the active stored identity', async () => {
    vi.spyOn(store, 'getRecentSnapshot').mockResolvedValue({ ...snapshot([order(52)]), ownerId: 'other-owner' })
    render(createElement(OfflineShell))
    await waitFor(() => expect(screen.queryByText(/Cargando datos locales/)).toBeNull())
    expect(screen.queryByText('Cliente 52')).toBeNull()
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
