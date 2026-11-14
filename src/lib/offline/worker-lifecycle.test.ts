import { describe, expect, it } from 'vitest'

import { waitForOfflineWorker } from './worker-lifecycle'

class Worker extends EventTarget {
  state = 'installing'
  activate() { this.state = 'activated'; this.dispatchEvent(new Event('statechange')) }
}

describe('worker update preparation', () => {
  it('waits for the replacing worker instead of messaging the old incompatible one', async () => {
    const oldWorker = new Worker(); oldWorker.activate()
    const nextWorker = new Worker()
    const registration = { active: oldWorker, installing: nextWorker } as unknown as ServiceWorkerRegistration
    const waiting = waitForOfflineWorker(registration)
    let done = false
    void waiting.then(() => { done = true })
    await Promise.resolve()
    expect(done).toBe(false)
    nextWorker.activate()
    expect(await waiting).toBe(nextWorker)
  })
  it('returns an already activated worker and rejects a missing worker', async () => {
    const active = new Worker(); active.activate()
    expect(await waitForOfflineWorker({ active } as unknown as ServiceWorkerRegistration)).toBe(active)
    await expect(waitForOfflineWorker({} as ServiceWorkerRegistration)).rejects.toThrow()
  })
})
