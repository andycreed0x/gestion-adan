'use client'

export function OfflineBanner({ visible }: { visible: boolean }) {
  return visible ? <p className="offline-banner" role="status">Sin conexión</p> : null
}
