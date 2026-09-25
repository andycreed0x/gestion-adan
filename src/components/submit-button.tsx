'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'

const successMillis = 3000

type SubmitButtonProps = {
  label: string
  pendingLabel: string
  successLabel: string
  confirmed?: boolean
}

export function SubmitButton({ label, pendingLabel, successLabel, confirmed = false }: SubmitButtonProps) {
  const { pending } = useFormStatus()
  const router = useRouter()
  const pathname = usePathname()
  const [showSuccess, setShowSuccess] = useState(confirmed)

  useEffect(() => {
    if (!confirmed) return
    setShowSuccess(true)
    const timer = setTimeout(() => {
      setShowSuccess(false)
      router.replace(pathname)
    }, successMillis)
    return () => clearTimeout(timer)
  }, [confirmed, pathname, router])

  if (pending) return <button type="submit" disabled>{pendingLabel}</button>
  if (showSuccess) return <button type="submit" className="is-success">{successLabel}</button>
  return <button type="submit">{label}</button>
}

