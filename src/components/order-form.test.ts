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
