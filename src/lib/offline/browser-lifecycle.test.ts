/* @vitest-environment jsdom */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { activateBrowserOwner, createBrowserOrderStore, getActiveBrowserOwner } from './order-store'

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('IDBKeyRange', IDBKeyRange)
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_: string, work: () => Promise<unknown>) => work() } })
})

describe('browser lifecycle fencing', () => {
  it('does not re-activate identity after delayed verification finishes after logout', async () => {
    const { initializeOfflineIdentity, logoutOffline } = await import('./browser-runtime')
    let respond!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { respond = resolve })))
    const starting = initializeOfflineIdentity('a')
    await logoutOffline()
    respond(new Response(JSON.stringify({ ownerId: 'a', expiresAt: Date.now() + 3600000 })))
    await expect(starting).rejects.toThrow()
    expect(getActiveBrowserOwner()).toBeNull()
    await expect(initializeOfflineIdentity('a')).rejects.toThrow()
  })
  it('retains a synchronous invalidation across navigation before IndexedDB can be updated', async () => {
    await activateBrowserOwner('a', Date.now() + 3600000)
    const store = createBrowserOrderStore()
    await store.replaceRecentSnapshot({ schemaVersion: 1, ownerId: 'a', windowStart: '2026-10-16', generatedAt: new Date().toISOString(), orders: [] })
    expect(await store.getSnapshotFreshness()).toBeGreaterThan(0)
    localStorage.setItem('adan-offline-invalidation', 'changed-during-native-navigation')
    expect(await createBrowserOrderStore().getSnapshotFreshness()).toBe(0)
    expect((await store.getRecentSnapshot())?.orders).toEqual([])
  })
})

it('revokes a definitive 401 or owner mismatch, while not confusing network failure with revocation', async () => {
  const runtime = await import('./browser-runtime')
  await activateBrowserOwner('a', Date.now() + 3600000)
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
  await expect(runtime.initializeOfflineIdentity('a')).rejects.toThrow()
  expect(getActiveBrowserOwner()).toBeNull()
})

it('checks every expected owner even when sharing verification work', async () => {
  const runtime = await import('./browser-runtime')
  let respond!: (value: Response) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { respond = resolve })))
  const a = runtime.initializeOfflineIdentity('a')
  const b = runtime.initializeOfflineIdentity('b')
  const rejected = expect(b).rejects.toThrow()
  respond(new Response(JSON.stringify({ ownerId: 'a', sessionId: 'session-a', expiresAt: Date.now() + 3600000 })))
  await a
  await rejected
})

it('fences a freshly loaded tab throughout server logout and allows a new authenticated session afterward', async () => {
  const first = await import('./browser-runtime')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ownerId: 'a', sessionId: 'session-a', expiresAt: Date.now() + 3600000 }))))
  await first.initializeOfflineIdentity('a')
  await first.logoutOffline()
  vi.resetModules()
  const fresh = await import('./browser-runtime')
  await expect(fresh.initializeOfflineIdentity('a')).rejects.toThrow()
  expect(getActiveBrowserOwner()).toBeNull()
  first.completeOfflineLogout()
  vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ ownerId: 'b', sessionId: 'session-b', expiresAt: Date.now() + 3600000 })))
  await fresh.initializeOfflineIdentity('b')
  expect(getActiveBrowserOwner()).toBe('b')
})

it('revokes old local owner on verified account mismatch, but retains it on network failure', async () => {
  const runtime = await import('./browser-runtime')
  await activateBrowserOwner('a', Date.now() + 3600000)
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network unavailable') }))
  await expect(runtime.initializeOfflineIdentity('a')).rejects.toThrow()
  expect(getActiveBrowserOwner()).toBe('a')
  vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ ownerId: 'b', sessionId: 'b', expiresAt: Date.now() + 3600000 })))
  await expect(runtime.initializeOfflineIdentity('a')).rejects.toThrow()
  expect(getActiveBrowserOwner()).toBeNull()
})

it('retains unsynced owner-scoped work through revocation and verified reauthentication', async () => {
  const runtime = await import('./browser-runtime')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ownerId: 'a', sessionId: 'old', expiresAt: Date.now() + 3600000 }))))
  await runtime.initializeOfflineIdentity('a')
  await createBrowserOrderStore().enqueueCreate({ localId: 'unsynced', createdAt: '', draft: { customerName: 'Synthetic', equipment: 'TV' } })
  vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 401 }))
  await expect(runtime.initializeOfflineIdentity('a')).rejects.toThrow()
  expect(await createBrowserOrderStore().listPending()).toHaveLength(0)
  vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ ownerId: 'a', sessionId: 'new', expiresAt: Date.now() + 3600000 })))
  await runtime.initializeOfflineIdentity('a')
  expect(await createBrowserOrderStore().listPending()).toHaveLength(1)
})

it.each([401, 403, 'wrong-owner'])('revokes cached access when snapshot authorization fails (%s)', async (failure) => {
  const runtime = await import('./browser-runtime')
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (url === '/api/offline/session') return new Response(JSON.stringify({ ownerId: 'a', sessionId: 'a', expiresAt: Date.now() + 3600000 }))
    return failure === 'wrong-owner'
      ? new Response(JSON.stringify({ schemaVersion: 1, ownerId: 'b', windowStart: '2026-10-16', generatedAt: new Date().toISOString(), orders: [] }))
      : new Response('{}', { status: failure as number })
  }))
  await runtime.initializeOfflineIdentity('a')
  await expect(runtime.refreshOfflineSnapshot()).rejects.toThrow()
  expect(getActiveBrowserOwner()).toBeNull()
})

it('reuses verified server-render metadata only for initialization, without exposing tokens or authorizing data locally', async () => {
  const runtime = await import('./browser-runtime')
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await runtime.initializeOfflineIdentity('a', { ownerId: 'a', sessionId: 'verified-render', expiresAt: Date.now() + 3600000 })
  expect(getActiveBrowserOwner()).toBe('a')
  expect(fetch).not.toHaveBeenCalled()
  fetch.mockResolvedValue(new Response('{}', { status: 401 }))
  await expect(runtime.refreshOfflineSnapshot()).rejects.toThrow()
  expect(fetch).toHaveBeenCalledWith('/api/orders/offline-snapshot', expect.anything())
  expect(getActiveBrowserOwner()).toBeNull()
})

it('does not let stale server bootstrap metadata replace a different current account', async () => {
  const runtime = await import('./browser-runtime')
  await activateBrowserOwner('b', Date.now() + 3600000, () => true, 'current-b')
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ownerId: 'b', sessionId: 'current-b', expiresAt: Date.now() + 3600000 })))
  vi.stubGlobal('fetch', fetch)
  await expect(runtime.initializeOfflineIdentity('a', { ownerId: 'a', sessionId: 'stale-a', expiresAt: Date.now() + 3600000 })).rejects.toThrow()
  expect(getActiveBrowserOwner()).toBe('b')
  expect(fetch).toHaveBeenCalledWith('/api/offline/session', expect.anything())
})
