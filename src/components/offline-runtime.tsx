'use client'

import { useEffect } from 'react'

import { initializeOfflineIdentity, observeOfflineIdentity, prepareOfflineShell, refreshOfflineSnapshot, syncBrowserPending } from '@/lib/offline/browser-runtime'
import { getActiveBrowserOwner } from '@/lib/offline/order-store'
import type { OfflineIdentityMetadata } from '@/lib/offline/types'

export function OfflineRuntime({ ownerId, initialIdentity }: { ownerId?: string; initialIdentity?: OfflineIdentityMetadata }) {
  useEffect(() => {
    let stopped = false
    let serverIdentity = initialIdentity
    const stopObserving = observeOfflineIdentity()
    const run = async () => {
      if (!navigator.onLine || stopped) return
      try {
        const verifiedRenderIdentity = serverIdentity
        serverIdentity = undefined
        await initializeOfflineIdentity(ownerId ?? getActiveBrowserOwner() ?? undefined, verifiedRenderIdentity)
        if (stopped) return
        await syncBrowserPending()
        if (window.location.pathname === '/orders') await refreshOfflineSnapshot()
        if (stopped) return
        await prepareOfflineShell()
        if (!stopped) window.dispatchEvent(new Event('adan-offline-ready'))
      } catch (error) {
        if (!stopped) window.dispatchEvent(new CustomEvent('adan-offline-error', { detail: error instanceof Error ? error.message : 'Preparación offline incompleta' }))
      }
    }
    void run()
    window.addEventListener('online', run)
    window.addEventListener('focus', run)
    return () => {
      stopped = true
      stopObserving()
      window.removeEventListener('online', run)
      window.removeEventListener('focus', run)
    }
  }, [ownerId, initialIdentity?.sessionId, initialIdentity?.expiresAt])
  return null
}
