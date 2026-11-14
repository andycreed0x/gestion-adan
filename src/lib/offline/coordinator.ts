import type { OfflineSnapshot, OrderStore, PendingCreate } from './types'
import { syncPendingOrders, type SyncPostResult, type SyncReceipts } from './sync'

export const SNAPSHOT_TTL_MS = 120_000

type CoordinatorOptions = {
  ownerId: string
  store: OrderStore
  fetchSnapshot: (signal: AbortSignal) => Promise<OfflineSnapshot>
  verify: (signal: AbortSignal) => Promise<string | null>
  isActive: () => boolean
  lock?: <T>(work: () => Promise<T>) => Promise<T>
  now?: () => number
  revision?: () => string
  onChange?: () => void
  receipts?: SyncReceipts
}

export function createOfflineCoordinator(options: CoordinatorOptions) {
  const controller = new AbortController()
  const lock = options.lock ?? (async <T>(work: () => Promise<T>) => work())
  const now = options.now ?? Date.now
  let localRevision = 0
  let update: Promise<void> | null = null
  let syncing: Promise<unknown> | null = null
  const active = () => !controller.signal.aborted && options.isActive()
  const check = () => { if (!active()) throw new Error('La sesión cambió o la actualización fue cancelada') }
  const revision = () => `${localRevision}:${options.revision?.() ?? ''}`
  const verify = async () => {
    check()
    if (await options.verify(controller.signal) !== options.ownerId) throw new Error('La cuenta activa cambió; volvé a iniciar sesión')
    check()
  }
  const invalidate = async () => {
    check()
    localRevision += 1
    await options.store.invalidateSnapshot()
    options.onChange?.()
  }
  return {
    cancel() { controller.abort() },
    invalidate,
    refresh(): Promise<void> {
      if (update) return update
      update = lock(async () => {
        check()
        let changed: boolean
        do {
          changed = false
          const freshness = await options.store.getSnapshotFreshness()
          const snapshot = await options.store.getRecentSnapshot()
          if (snapshot && freshness > 0 && now() - freshness < SNAPSHOT_TTL_MS) return
          // fetchSnapshot is the authenticated data boundary (getUser + RLS).
          // Its owner and the still-active local identity are checked before commit.
          const started = revision()
          const next = await options.fetchSnapshot(controller.signal)
          check()
          if (started !== revision()) { changed = true; continue }
          if (next.ownerId !== options.ownerId) throw new Error('Snapshot de otra cuenta')
          await options.store.replaceRecentSnapshot(next)
          check()
          if (started !== revision()) { await options.store.invalidateSnapshot(); changed = true }
        } while (changed)
        options.onChange?.()
      }).finally(() => { update = null })
      return update
    },
    sync(post: (pending: PendingCreate, signal: AbortSignal) => Promise<SyncPostResult>, retryErrors = false): Promise<unknown> {
      if (syncing) return syncing
      syncing = lock(async () => {
        check()
        if (!(await options.store.listPending()).length) return { synced: 0, failed: 0, stoppedForNetwork: false, warnings: [] }
        await verify()
        const result = await syncPendingOrders(options.store, async (pending) => {
          check()
          const response = await post(pending, controller.signal)
          check()
          return response
        }, { retryErrors, isActive: active, receipts: options.receipts })
        check()
        if (result.synced) await invalidate()
        options.onChange?.()
        return result
      }).finally(() => { syncing = null })
      return syncing
    },
  }
}
