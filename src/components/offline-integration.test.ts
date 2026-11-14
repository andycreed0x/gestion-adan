/* @vitest-environment jsdom */
import { readFileSync } from 'node:fs'
import { createElement, Profiler } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LogoutButton } from './logout-button'
import { OrdersWorkspace } from './orders-workspace'

const mocks = vi.hoisted(() => ({ logout: vi.fn(), refresh: vi.fn() }))
vi.mock('@/lib/offline/browser-runtime', () => ({ logoutOffline: mocks.logout, completeOfflineLogout: vi.fn(), refreshOfflineSnapshot: mocks.refresh }))
vi.mock('@/lib/offline/order-store', () => ({ createBrowserOrderStore: () => ({ listPending: async () => [] }), getActiveBrowserOwner: () => 'synthetic-owner' }))
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('offline wiring regressions', () => {
  it('never requests list JSON pagination or private detail/ticket HTML to prepare offline', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    mocks.refresh.mockResolvedValue(undefined)
    render(createElement(OrdersWorkspace, { orders: [], prefetchAllRecent: true, deleteAction: vi.fn() }))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
    expect(fetch).not.toHaveBeenCalled()
    const source = readFileSync('src/components/orders-workspace.tsx', 'utf8')
    expect(source).not.toContain('CACHE_ORDER_ROUTES')
    expect(source).not.toContain("fetch('/api/orders')")
  })
  it('awaits private cleanup before signing out; failed cleanup never navigates', async () => {
    let release!: () => void
    mocks.logout.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
    const action = vi.fn(async () => {})
    render(createElement(LogoutButton, { action }))
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }))
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1))
    expect(action).not.toHaveBeenCalled()
    release()
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1))
    cleanup()
    mocks.logout.mockRejectedValueOnce(new Error('quota'))
    render(createElement(LogoutButton, { action }))
    fireEvent.click(screen.getByRole('button', { name: 'Salir' }))
    await screen.findByRole('alert')
    expect(action).toHaveBeenCalledTimes(1)
  })
})

it('does not rerender unchanged table data on snapshot/sync notifications', async () => {
  const onRender = vi.fn()
  render(createElement(Profiler, { id: 'workspace', onRender }, createElement(OrdersWorkspace, { orders: [], prefetchAllRecent: true, deleteAction: vi.fn() })))
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  await act(async () => { await Promise.resolve() })
  const before = onRender.mock.calls.length
  await act(async () => { window.dispatchEvent(new Event('adan-offline-sync')); await Promise.resolve() })
  expect(onRender.mock.calls.length).toBe(before)
})
