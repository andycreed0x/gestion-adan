/* @vitest-environment jsdom */
import { createElement } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { PrivateOwnerBoundary } from './private-owner-boundary'

const identity = vi.hoisted(() => ({ value: { ownerId: 'a', epoch: 'one', expiresAt: Date.now() + 10000 } as { ownerId: string; epoch: string; expiresAt: number } | null }))
vi.mock('@/lib/offline/order-store', () => ({ getBrowserIdentity: () => identity.value }))
afterEach(() => cleanup())

it('hides rendered private online data when another tab logs out or switches account', () => {
  render(createElement(PrivateOwnerBoundary, { ownerId: 'a', children: createElement('p', null, 'Private synthetic data') }))
  expect(screen.getByText('Private synthetic data')).toBeTruthy()
  act(() => { identity.value = null; window.dispatchEvent(new Event('adan-offline-identity')) })
  expect(screen.queryByText('Private synthetic data')).toBeNull()
  expect(screen.getByRole('alert')).toBeTruthy()
  act(() => { identity.value = { ownerId: 'b', epoch: 'two', expiresAt: Date.now() + 10000 }; window.dispatchEvent(new Event('adan-offline-identity')) })
  expect(screen.queryByText('Private synthetic data')).toBeNull()
})
