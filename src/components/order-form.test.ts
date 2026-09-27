/* @vitest-environment jsdom */

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./submit-button', () => ({
  SubmitButton: ({ label }: { label: string }) => createElement('button', { type: 'submit' }, label),
}))

import { OrderForm } from './order-form'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderCreateForm() {
  return render(createElement(OrderForm, { mode: 'create', submitLabel: 'Guardar orden' }))
}

function renderUpdateForm() {
  return render(createElement(OrderForm, {
    mode: 'update',
    submitLabel: 'Guardar cambios',
    values: { customerName: 'Ana', equipment: 'TV', receivedOn: '2026-09-27' },
  }))
}

describe('OrderForm', () => {
  it('marks an invalid budget, disables save, and preserves the other typed values', () => {
    renderCreateForm()
    const name = screen.getByRole('textbox', { name: /^Nombre/ }) as HTMLInputElement
    const equipment = screen.getByRole('textbox', { name: /^Tipo \/ marca \/ modelo/ }) as HTMLInputElement
    const budget = screen.getByRole('textbox', { name: /^Presupuesto \(ARS\)/ }) as HTMLInputElement

    fireEvent.change(name, { target: { value: 'Ana' } })
    fireEvent.change(equipment, { target: { value: 'TV' } })
    fireEvent.change(budget, { target: { value: 'doce mil' } })

    expect(budget.getAttribute('aria-invalid')).toBe('true')
    expect((screen.getByRole('button', { name: 'Guardar orden' }) as HTMLButtonElement).disabled).toBe(true)
    expect(name.value).toBe('Ana')
  })

  it('moves from phone to name with Enter and reserves Shift+Enter for a textarea newline', async () => {
    renderCreateForm()
    const phone = screen.getByRole('textbox', { name: /^Teléfono/ })
    const name = screen.getByRole('textbox', { name: /^Nombre/ })
    const fault = screen.getByRole('textbox', { name: /^Falla reportada/ })

    fireEvent.keyDown(phone, { key: 'Enter' })
    await waitFor(() => expect(document.activeElement).toBe(name))

    fault.focus()
    fireEvent.keyDown(fault, { key: 'Enter', shiftKey: true })
    expect(document.activeElement).toBe(fault)
  })

  it('starts in the phone field and fills the received date with today', async () => {
    renderCreateForm()

    const phone = screen.getByRole('textbox', { name: /^Teléfono/ })
    const receivedOn = screen.getByLabelText('Fecha de ingreso') as HTMLInputElement

    await waitFor(() => expect(document.activeElement).toBe(phone))
    await waitFor(() => expect(receivedOn.value).toMatch(/^\d{4}-\d{2}-\d{2}$/))
  })

  it('keeps only typed phone digits and moves from pickup date to save with Enter', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    renderCreateForm()
    const phone = screen.getByRole('textbox', { name: /^Teléfono/ }) as HTMLInputElement
    const pickupDate = screen.getByLabelText('Fecha de retiro')
    const save = screen.getByRole('button', { name: 'Guardar orden' })

    fireEvent.change(phone, { target: { value: '2345-2345' } })
    fireEvent.change(screen.getByRole('textbox', { name: /^Nombre/ }), { target: { value: 'Ana' } })
    fireEvent.change(screen.getByRole('textbox', { name: /^Tipo \/ marca \/ modelo/ }), { target: { value: 'TV' } })
    expect(phone.value).toBe('23452345')

    pickupDate.focus()
    fireEvent.keyDown(pickupDate, { key: 'Enter' })
    await waitFor(() => expect(document.activeElement).toBe(save))
  })

  it('shows processing while an online create request is in flight', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)))
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
    renderCreateForm()

    fireEvent.change(screen.getByRole('textbox', { name: /^Nombre/ }), { target: { value: 'Ana' } })
    fireEvent.change(screen.getByRole('textbox', { name: /^Tipo \/ marca \/ modelo/ }), { target: { value: 'TV' } })
    fireEvent.submit(screen.getByRole('button', { name: 'Guardar orden' }).closest('form')!)

    expect((await screen.findByRole('button', { name: 'Procesando…' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows processing while an online update request is in flight', async () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
    renderUpdateForm()

    fireEvent.submit(screen.getByRole('button', { name: 'Guardar cambios' }).closest('form')!)

    expect((await screen.findByRole('button', { name: 'Procesando…' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the confirmed update state in green', () => {
    render(createElement(OrderForm, {
      mode: 'update',
      confirmed: true,
      submitLabel: 'Guardar cambios',
      values: { customerName: 'Ana', equipment: 'TV', receivedOn: '2026-09-27' },
    }))

    const save = screen.getByRole('button', { name: 'Cambios guardados ✓' }) as HTMLButtonElement
    expect(save.className).toBe('is-success')
    expect(save.disabled).toBe(true)
  })

  it('fills editable customer data after a phone lookup', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ customer: { full_name: 'Ana Pérez', address: 'Rivadavia 123', phone: '11 4444-5555' } }),
    }))
    renderCreateForm()
    const phone = screen.getByRole('textbox', { name: /^Teléfono/ })

    fireEvent.change(phone, { target: { value: '11 4444-5555' } })
    fireEvent.blur(phone)

    await waitFor(() => expect((screen.getByRole('textbox', { name: /^Nombre/ }) as HTMLInputElement).value).toBe('Ana Pérez'))
    expect((screen.getByRole('textbox', { name: /^Dirección/ }) as HTMLInputElement).value).toBe('Rivadavia 123')
  })
})
