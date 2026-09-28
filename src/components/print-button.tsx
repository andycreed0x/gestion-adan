'use client'

import { useEffect, useRef } from 'react'

export function PrintButton({ autoPrint = false }: { autoPrint?: boolean }) {
  const hasAutoPrinted = useRef(false)

  useEffect(() => {
    if (!autoPrint || hasAutoPrinted.current) return
    hasAutoPrinted.current = true
    window.print()
  }, [autoPrint])

  return <button type="button" className="no-print" onClick={() => window.print()}>Imprimir</button>
}
