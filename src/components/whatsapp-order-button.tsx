'use client'

import { useEffect, useState } from 'react'

import { buildWhatsAppOrderUrl, type ShareableOrder } from '@/lib/order-share'

export function WhatsAppOrderButton({ order }: { order: ShareableOrder }) {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const refresh = () => setOnline(navigator.onLine)
    refresh()
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    return () => {
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
    }
  }, [])

  const url = online ? buildWhatsAppOrderUrl(order) : null
  const message = !online ? 'WhatsApp requiere conexión' : !order.customerPhone ? 'La orden no tiene teléfono' : 'WhatsApp no está disponible para esta orden'

  return url
    ? <a className="button secondary" href={url.toString()} target="_blank" rel="noopener noreferrer">Enviar por WhatsApp</a>
    : <button type="button" className="button secondary" disabled title={message}>Enviar por WhatsApp</button>
}
