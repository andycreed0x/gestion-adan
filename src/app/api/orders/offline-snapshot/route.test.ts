import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { queryOfflineSnapshot, type OfflineSnapshot } from '@/lib/offline/snapshot-server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { GET } from './route'

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock('@/lib/offline/snapshot-server', () => ({ queryOfflineSnapshot: vi.fn() }))

const snapshot: OfflineSnapshot = {
  schemaVersion: 1, ownerId: 'verified-owner', windowStart: '2026-10-16', generatedAt: '2026-11-14T12:00:00.000Z',
  orders: [{
    id: 'synthetic-order', orderNumber: 9380, customerName: 'Cliente sintético', customerAddress: 'Calle 123',
    customerPhone: '23452345', equipment: 'TV', accessories: 'Control', reportedFault: 'No enciende',
    resolution: '', budgetCents: null, status: 'received', receivedOn: '2026-11-14', pickedUpOn: null,
  }],
}

const request = (signal?: AbortSignal) => new NextRequest('http://localhost/api/orders/offline-snapshot?ownerId=untrusted&page=99', { signal })
const getUser = vi.fn()
const client = { auth: { getUser } }

beforeEach(() => {
  vi.resetAllMocks()
  getUser.mockResolvedValue({ data: { user: { id: 'verified-owner' } }, error: null })
  vi.mocked(createServerSupabaseClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createServerSupabaseClient>>)
  vi.mocked(queryOfflineSnapshot).mockResolvedValue(snapshot)
})

function expectPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
}

describe('GET /api/orders/offline-snapshot', () => {
  it('verifies getUser once, uses the user-scoped client, and returns the complete snapshot', async () => {
    const req = request()
    const response = await GET(req)
    expect(response.status).toBe(200)
    expectPrivate(response)
    expect(await response.json()).toEqual(snapshot)
    expect(createServerSupabaseClient).toHaveBeenCalledTimes(1)
    expect(getUser).toHaveBeenCalledTimes(1)
    expect(queryOfflineSnapshot).toHaveBeenCalledWith(client, 'verified-owner', { signal: req.signal })
    expect(getUser.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(queryOfflineSnapshot).mock.invocationCallOrder[0])
  })

  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id: 'unverified' } }, error: { message: 'Invalid token' } },
  ])('denies unauthenticated or failed verification without reading data', async (authResult) => {
    getUser.mockResolvedValue(authResult)
    const response = await GET(request())
    expect(response.status).toBe(401)
    expectPrivate(response)
    expect(await response.json()).toEqual({ error: 'No autorizado' })
    expect(queryOfflineSnapshot).not.toHaveBeenCalled()
  })

  it('returns an empty snapshot successfully', async () => {
    vi.mocked(queryOfflineSnapshot).mockResolvedValue({ ...snapshot, orders: [] })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expectPrivate(response)
    expect(await response.json()).toEqual({ ...snapshot, orders: [] })
  })

  it.each(['client', 'auth', 'query'])('returns private no-store errors on %s failure without leaking backend details', async (stage) => {
    const error = new Error('sensitive synthetic backend detail')
    if (stage === 'client') vi.mocked(createServerSupabaseClient).mockRejectedValue(error)
    if (stage === 'auth') getUser.mockRejectedValue(error)
    if (stage === 'query') vi.mocked(queryOfflineSnapshot).mockRejectedValue(error)
    const response = await GET(request())
    expect(response.status).toBe(500)
    expectPrivate(response)
    const body = await response.json()
    expect(body.error).toEqual(expect.any(String))
    expect(JSON.stringify(body)).not.toContain(error.message)
    expect(body).not.toHaveProperty('orders')
  })

  it('skips authentication and data work for an already disconnected request', async () => {
    const controller = new AbortController()
    controller.abort()
    const response = await GET(request(controller.signal))
    expect(response.status).toBe(499)
    expectPrivate(response)
    expect(createServerSupabaseClient).not.toHaveBeenCalled()
    expect(queryOfflineSnapshot).not.toHaveBeenCalled()
  })

  it('does not start data work after disconnecting during authentication', async () => {
    const controller = new AbortController()
    getUser.mockImplementation(async () => {
      controller.abort()
      return { data: { user: { id: 'verified-owner' } }, error: null }
    })
    const response = await GET(request(controller.signal))
    expect(response.status).toBe(499)
    expectPrivate(response)
    expect(queryOfflineSnapshot).not.toHaveBeenCalled()
  })

  it('discards a late snapshot after the request disconnects', async () => {
    const controller = new AbortController()
    vi.mocked(queryOfflineSnapshot).mockImplementation(async () => {
      controller.abort()
      return snapshot
    })
    const response = await GET(request(controller.signal))
    expect(response.status).toBe(499)
    expectPrivate(response)
    expect(await response.json()).not.toHaveProperty('orders')
  })
})
