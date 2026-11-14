import { describe, expect, it, vi } from 'vitest'

import { createOfflineCoordinator, SNAPSHOT_TTL_MS } from './coordinator'
import { createMemoryOrderStore } from './order-store'
import type { OfflineSnapshot } from './types'

const snapshot: OfflineSnapshot = { schemaVersion: 1, ownerId: 'memory-owner', windowStart: '2026-10-16', generatedAt: '2026-11-14T12:00:00Z', orders: [] }
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }
const setup = () => {
  let now = Date.now()
  let active = true
  const store = createMemoryOrderStore()
  const fetchSnapshot = vi.fn(async () => snapshot)
  const verify = vi.fn(async () => 'memory-owner')
  const coordinator = createOfflineCoordinator({ ownerId: 'memory-owner', store, fetchSnapshot, verify, isActive: () => active, now: () => now })
  return { store, fetchSnapshot, verify, coordinator, advance: () => { now += SNAPSHOT_TTL_MS + 1000 }, logout: () => { active = false; coordinator.cancel() } }
}

describe('offline refresh coordination', () => {
  it('shares concurrent work and downloads nothing on revisits in TTL', async () => {
    const env = setup()
    await Promise.all([env.coordinator.refresh(), env.coordinator.refresh()])
    await env.coordinator.refresh()
    expect(env.fetchSnapshot).toHaveBeenCalledTimes(1)
    env.advance()
    await env.coordinator.refresh()
    expect(env.fetchSnapshot).toHaveBeenCalledTimes(2)
  })
  it('keeps previous snapshot after interrupted transfer and refreshes after invalidation', async () => {
    const env = setup()
    await env.coordinator.refresh()
    await env.coordinator.invalidate()
    env.fetchSnapshot.mockRejectedValueOnce(new TypeError('network'))
    await expect(env.coordinator.refresh()).rejects.toThrow('network')
    expect(await env.store.getRecentSnapshot()).toEqual(snapshot)
    await env.coordinator.refresh()
    expect(env.fetchSnapshot).toHaveBeenCalledTimes(3)
  })
  it('rejects late snapshots and stops posts after logout or identity mismatch', async () => {
    const env = setup()
    const download = deferred<OfflineSnapshot>()
    env.fetchSnapshot.mockImplementation(() => download.promise)
    const work = env.coordinator.refresh()
    await vi.waitFor(() => expect(env.fetchSnapshot).toHaveBeenCalled())
    env.logout()
    download.resolve(snapshot)
    await work.catch(() => {})
    expect(await env.store.getRecentSnapshot()).toBeNull()
    const other = setup()
    other.fetchSnapshot.mockResolvedValue({ ...snapshot, ownerId: 'another-user' })
    await expect(other.coordinator.refresh()).rejects.toThrow()
    expect(await other.store.getRecentSnapshot()).toBeNull()
  })
  it('serializes two tabs under the same browser lock, rechecking freshness', async () => {
    const env = setup()
    let tail = Promise.resolve()
    const lock = <T,>(work: () => Promise<T>): Promise<T> => { const next = tail.then(work); tail = next.then(() => {}, () => {}); return next }
    const config = { ownerId: 'memory-owner', store: env.store, fetchSnapshot: env.fetchSnapshot, verify: env.verify, isActive: () => true, lock }
    await Promise.all([createOfflineCoordinator(config).refresh(), createOfflineCoordinator(config).refresh()])
    expect(env.fetchSnapshot).toHaveBeenCalledTimes(1)
  })
  it('does not mark a snapshot fresh when a mutation occurred during download', async () => {
    const env = setup()
    const download = deferred<OfflineSnapshot>()
    env.fetchSnapshot.mockImplementationOnce(() => download.promise)
    const work = env.coordinator.refresh()
    await vi.waitFor(() => expect(env.fetchSnapshot).toHaveBeenCalled())
    await env.coordinator.invalidate()
    download.resolve(snapshot)
    await work
    expect(env.fetchSnapshot).toHaveBeenCalledTimes(2)
  })
})

it('does no session verification or UI invalidation for an empty sync queue', async () => {
  const store = createMemoryOrderStore()
  const verify = vi.fn(async () => 'memory-owner')
  const onChange = vi.fn()
  const post = vi.fn()
  const coordinator = createOfflineCoordinator({ ownerId: 'memory-owner', store, verify, onChange, fetchSnapshot: async () => snapshot, isActive: () => true })
  await coordinator.sync(post)
  expect(verify).not.toHaveBeenCalled()
  expect(onChange).not.toHaveBeenCalled()
  expect(post).not.toHaveBeenCalled()
})

it('uses the authenticated snapshot response as verification instead of a duplicate preflight', async () => {
  const env = setup()
  await env.coordinator.refresh()
  expect(env.verify).not.toHaveBeenCalled()
  expect(env.fetchSnapshot).toHaveBeenCalledTimes(1)
})
