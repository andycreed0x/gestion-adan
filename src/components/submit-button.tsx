'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
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
  const searchParams = useSearchParams()
  const [showSuccess, setShowSuccess] = useState(confirmed)

  useEffect(() => {
    if (!confirmed) return
    setShowSuccess(true)
    const timer = setTimeout(() => {
      const nextParams = new URLSearchParams(searchParams.toString())
      nextParams.delete('saved')
      nextParams.delete('attached')
      setShowSuccess(false)
      router.replace(nextParams.size ? pathname + '?' + nextParams.toString() : pathname)
    }, successMillis)
    return () => clearTimeout(timer)
  }, [confirmed, pathname, router, searchParams])

  if (pending) return <button type="submit" disabled>{pendingLabel}</button>
  if (showSuccess) return <button type="submit" className="is-success" disabled>{successLabel}</button>
  return <button type="submit">{label}</button>
}
