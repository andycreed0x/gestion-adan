/* @vitest-environment jsdom */

import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { OrderTable } from './order-table'

describe('OrderTable', () => {
  it('offers permanent deletion for persisted orders but not offline pending orders', () => {
    render(createElement(OrderTable, {
      deleteAction: vi.fn(),
      orders: [
        { id: 'order-id', order_number: 9380, equipment: 'TV', status: 'received', budget_cents: null, received_on: '2026-09-27', picked_up_on: null, customers: { full_name: 'Ana', phone: '23452345' } },
        { persistence: 'pending', localId: 'local-id', equipment: 'Radio', status: 'pending', budget_cents: null, received_on: '2026-09-27', customers: { full_name: 'Bea', phone: '12341234' } },
      ],
    } as any))

    expect(screen.getByRole('button', { name: 'Borrar orden #9380' }).tagName).toBe('BUTTON')
    expect(screen.queryByRole('button', { name: /Borrar orden pendiente/i })).toBeNull()
  })
})
