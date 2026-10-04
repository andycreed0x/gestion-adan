/* @vitest-environment jsdom */

import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import PrintOrderPage from '@/app/(app)/orders/[id]/print/page'
import { createBrowserOrderStore, createMemoryOrderStore } from '@/lib/offline/order-store'
import { createServerSupabaseClient } from '@/lib/supabase/server'

import { PendingOrderDetail } from './pending-order-detail'

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock('@/lib/offline/order-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/offline/order-store')>(),
  createBrowserOrderStore: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const terms = [
  'El presupuesto tiene validez por 10 días, pasada dicha fecha el presupuesto será actualizado según el costo que los componentes sufran en el mercado.',
  'De no ser retirado pasados los 10 días de presupuestado, el equipo pasa a depósito y tiene un costo de $3000 por día por cargos de almacenamiento, sin excepción. Pasados 30 días se considera abandono quedando a disposición nuestra.',
  'Las reparaciones tienen 2 meses de garantía sobre lo reparado.',
]

const appStyles = readFileSync('src/app/globals.css', 'utf8')

async function renderPersistedOrder(searchParams: { autoPrint?: string } = { autoPrint: '0' }) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: {
      order_number: 1234,
      equipment: 'TV Samsung',
      accessories: 'Control remoto',
      reported_fault: 'No enciende',
      resolution: 'Reemplazar fuente',
      budget_cents: 125000,
      status: 'received',
      received_on: '2026-10-04',
      picked_up_on: null,
      customers: { full_name: 'Ana Pérez', address: 'Rivadavia 123', phone: '1144445555' },
    }, error: null }),
  }
  vi.mocked(createServerSupabaseClient).mockResolvedValue({ from: () => query } as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>)
  return render(await PrintOrderPage({
    params: Promise.resolve({ id: 'order-1234' }),
    searchParams: Promise.resolve(searchParams),
  }))
}

async function renderPendingOrder() {
  const store = createMemoryOrderStore()
  await store.enqueueCreate({
    localId: 'local-1',
    createdAt: '2026-10-04T12:00:00Z',
    draft: {
      customerName: 'Ana Pérez', customerAddress: 'Rivadavia 123', customerPhone: '1144445555',
      equipment: 'TV Samsung', budget: '1250', status: 'received', receivedOn: '2026-10-04',
    },
  })
  vi.mocked(createBrowserOrderStore).mockReturnValue(store)
  render(createElement(PendingOrderDetail, { localId: 'local-1' }))
  await screen.findByText('Pendiente de sincronización')
}

describe('printed order content', () => {
  it('shows the official number only among the fields, without repeated titles or a budget field', async () => {
    await renderPersistedOrder()
    const ticket = within(screen.getByRole('article'))

    expect(ticket.queryByRole('heading', { level: 2 })).toBeNull()
    expect(ticket.queryByText('ORDEN DE REPARACIÓN')).toBeNull()
    expect(ticket.getAllByText('N° Orden')).toHaveLength(1)
    expect(ticket.getByText('1234').tagName).toBe('DD')
    expect(ticket.queryByText('Presupuesto')).toBeNull()
    expect(ticket.getByText('Ana Pérez')).toBeTruthy()
    expect(ticket.getByText('TV Samsung')).toBeTruthy()
  })

  it.each([
    ['persisted', renderPersistedOrder],
    ['pending offline', renderPendingOrder],
  ])('prints the business contacts, hours and all terms for a %s order', async (_, renderOrder) => {
    await renderOrder()
    const article = screen.getByRole('article')
    const header = article.querySelector('header')
    const footer = article.querySelector('footer')

    expect(header?.textContent).toContain('Tel: (011) 4744-7009 · Whatsapp: 1158128304 (SOLO MENSAJES)')
    expect(header?.textContent).toContain('Lunes a viernes de 10 a 13 - 15.30 a 17.30')
    expect(header!.querySelectorAll('p')).toHaveLength(1)
    expect(header!.querySelector('p')?.textContent).toContain('(SOLO MENSAJES) - Lunes a viernes')
    expect(footer).not.toBeNull()
    expect(Array.from(footer!.querySelectorAll('p'), (paragraph) => paragraph.textContent)).toEqual(terms)
  })

  it.each([
    ['persisted', renderPersistedOrder],
    ['pending offline', renderPendingOrder],
  ])('removes inter-paragraph margins from the terms of a %s order', async (_, renderOrder) => {
    const style = document.createElement('style')
    style.textContent = appStyles
    document.head.appendChild(style)
    try {
      await renderOrder()
      const paragraphs = screen.getByRole('article').querySelectorAll('footer p')

      expect(paragraphs).toHaveLength(3)
      for (const paragraph of paragraphs) {
        const computed = window.getComputedStyle(paragraph)
        expect(computed.marginBlock).toBe('0px')
      }
    } finally {
      style.remove()
    }
  })

  it('opens the browser print dialog on entering the ticket route without a second click', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    await renderPersistedOrder({})

    expect(print).toHaveBeenCalledTimes(1)
    expect(screen.getByText('1234')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir' }))
    expect(print).toHaveBeenCalledTimes(2)
  })

  it('allows opening the ticket without automatic printing when explicitly disabled', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    await renderPersistedOrder({ autoPrint: '0' })

    expect(print).not.toHaveBeenCalled()
    expect(screen.getByRole('article')).toBeTruthy()
  })

  it('keeps offline orders pending without inventing an official number or printing the budget', async () => {
    await renderPendingOrder()
    const ticket = within(screen.getByRole('article'))

    expect(ticket.getByText('Pendiente de sincronización')).toBeTruthy()
    expect(ticket.queryByText(/N° Orden/)).toBeNull()
    expect(ticket.queryByText('ORDEN DE REPARACIÓN')).toBeNull()
    expect(ticket.queryByText(/^Presupuesto:/)).toBeNull()
    expect(ticket.getByText('Cliente: Ana Pérez')).toBeTruthy()
  })
})
