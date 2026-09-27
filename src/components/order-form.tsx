'use client'

import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react'

import { PendingOrderDetail } from '@/components/pending-order-detail'
import { createBrowserOrderStore } from '@/lib/offline/order-store'
import { orderStatuses, type OrderDraft, type OrderField, type OrderStatus, validateOrderDraft } from '@/lib/orders'

type OrderFormValues = OrderDraft

type OrderFormProps = {
  action?: (formData: FormData) => void | Promise<void>
  values?: OrderFormValues
  error?: string
  submitLabel: string
  confirmed?: boolean
  mode: 'create' | 'update'
}

const fieldOrder: OrderField[] = [
  'customerPhone', 'customerName', 'customerAddress', 'equipment', 'accessories',
  'reportedFault', 'resolution', 'budget', 'status', 'receivedOn', 'pickedUpOn',
]

function localDateInputValue(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function initialValues(values: OrderFormValues): OrderDraft {
  return {
    customerPhone: (values.customerPhone ?? '').replace(/\D/g, ''),
    customerName: values.customerName ?? '',
    customerAddress: values.customerAddress ?? '',
    equipment: values.equipment ?? '',
    accessories: values.accessories ?? '',
    reportedFault: values.reportedFault ?? '',
    resolution: values.resolution ?? '',
    budget: values.budget ?? '',
    status: values.status ?? 'received',
    receivedOn: values.receivedOn ?? '',
    pickedUpOn: values.pickedUpOn ?? '',
  }
}

export function OrderForm({ action, values: suppliedValues = {}, error, submitLabel, confirmed = false, mode }: OrderFormProps) {
  const initial = () => initialValues(suppliedValues)
  const [values, setValues] = useState<OrderDraft>(initial)
  const [fieldErrors, setFieldErrors] = useState(() => validateOrderDraft(initial()).fieldErrors)
  const [connectionError, setConnectionError] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showSuccess, setShowSuccess] = useState(confirmed)
  const refs = useRef<Partial<Record<OrderField, HTMLElement | null>>>({})
  const submitRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('pending')
    if (fromUrl) setPendingId(fromUrl)
  }, [])

  useEffect(() => {
    if (mode === 'create') refs.current.customerPhone?.focus()
  }, [mode])

  useEffect(() => {
    if (mode !== 'create') return
    setValues((current) => {
      if (current.receivedOn) return current
      const next = { ...current, receivedOn: localDateInputValue() }
      setFieldErrors(validateOrderDraft(next).fieldErrors)
      return next
    })
  }, [mode])

  useEffect(() => {
    if (!confirmed) return
    setShowSuccess(true)
    const timer = window.setTimeout(() => {
      const nextParams = new URLSearchParams(window.location.search)
      nextParams.delete('saved')
      setShowSuccess(false)
      window.history.replaceState(null, '', nextParams.size ? `${window.location.pathname}?${nextParams.toString()}` : window.location.pathname)
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [confirmed])

  const change = (field: OrderField, value: string) => {
    const next = { ...values, [field]: field === 'customerPhone' ? value.replace(/\D/g, '') : value }
    setValues(next)
    setFieldErrors(validateOrderDraft(next).fieldErrors)
    setConnectionError('')
  }

  const lookupPhone = async () => {
    const phone = values.customerPhone ?? ''
    if (!phone || validateOrderDraft({ ...values, customerName: values.customerName || 'x', equipment: values.equipment || 'x' }).fieldErrors.customerPhone) return

    try {
      const response = await fetch(`/api/customers/by-phone?phone=${encodeURIComponent(phone)}`)
      if (!response.ok) return
      const { customer } = await response.json()
      if (customer) {
        const next = { ...values, customerName: customer.full_name, customerAddress: customer.address }
        setValues(next)
        setFieldErrors(validateOrderDraft(next).fieldErrors)
      }
    } catch {
      const customer = await createBrowserOrderStore().findCachedCustomer(phone)
      if (customer) {
        const next = { ...values, customerName: customer.customerName, customerAddress: customer.customerAddress }
        setValues(next)
        setFieldErrors(validateOrderDraft(next).fieldErrors)
      }
    }
  }

  const focusNext = async (field: OrderField) => {
    const index = fieldOrder.indexOf(field)
    if (field === 'customerPhone') await lookupPhone()
    if (field === 'pickedUpOn') {
      submitRef.current?.focus()
      return
    }
    refs.current[fieldOrder[index + 1]]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, field: OrderField) => {
    if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey) return
    if ((field === 'reportedFault' || field === 'resolution') && event.shiftKey) return
    event.preventDefault()
    void focusNext(field)
  }

  const enqueuePending = async () => {
    const localId = crypto.randomUUID()
    await createBrowserOrderStore().enqueueCreate({ localId, createdAt: new Date().toISOString(), draft: values })
    navigator.serviceWorker?.controller?.postMessage({ type: 'CACHE_NEW_ORDER_ROUTE' })
    window.history.replaceState(null, '', `/orders/new?pending=${localId}`)
    setPendingId(localId)
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    const validation = validateOrderDraft(values)
    setFieldErrors(validation.fieldErrors)
    if (Object.keys(validation.fieldErrors).length) {
      event.preventDefault()
      return
    }

    if (mode === 'update') {
      if (!navigator.onLine) {
        event.preventDefault()
        setConnectionError('Se necesita conexión para guardar cambios en una orden existente.')
        return
      }
      setIsSubmitting(true)
      return
    }

    event.preventDefault()
    if (!navigator.onLine) {
      await enqueuePending()
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      })
      const body = await response.json().catch(() => ({}))
      if (response.status === 422) {
        setFieldErrors(body.fieldErrors ?? {})
        return
      }
      if (!response.ok) {
        setConnectionError(body.error ?? 'No se pudo guardar la orden.')
        return
      }
      window.location.assign(`/orders/${body.id}?saved=1`)
    } catch (caught) {
      if (caught instanceof TypeError) {
        await enqueuePending()
        return
      }
      setConnectionError('No se pudo guardar la orden.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (pendingId) return <PendingOrderDetail localId={pendingId} />
  const disabled = Object.keys(fieldErrors).length > 0
  const field = (name: OrderField) => ({
    name,
    value: values[name] ?? '',
    ref: (element: HTMLElement | null) => { refs.current[name] = element },
    onChange: (event: { target: { value: string } }) => change(name, event.target.value),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => onKeyDown(event, name),
    'aria-invalid': fieldErrors[name] ? true : undefined,
  })
  const fieldMessage = (name: OrderField) => fieldErrors[name] ? <small className="field-error" role="alert">{fieldErrors[name]}</small> : null

  return (
    <form action={action} onSubmit={onSubmit} className="order-form" noValidate>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {connectionError ? <p className="form-error" role="alert">{connectionError}</p> : null}
      <fieldset>
        <legend>Cliente</legend>
        <label>Teléfono<input {...field('customerPhone')} onBlur={() => { void lookupPhone() }} inputMode="numeric" pattern="[0-9]*" />{fieldMessage('customerPhone')}</label>
        <label>Nombre<input {...field('customerName')} />{fieldMessage('customerName')}</label>
        <label>Dirección<input {...field('customerAddress')} />{fieldMessage('customerAddress')}</label>
      </fieldset>
      <fieldset>
        <legend>Equipo</legend>
        <label>Tipo / marca / modelo<input {...field('equipment')} />{fieldMessage('equipment')}</label>
        <label>Accesorios<input {...field('accessories')} />{fieldMessage('accessories')}</label>
      </fieldset>
      <fieldset>
        <legend>Diagnóstico</legend>
        <label>Falla reportada<textarea {...field('reportedFault')} rows={3} />{fieldMessage('reportedFault')}</label>
        <label>Resolución / reparación<textarea {...field('resolution')} rows={3} />{fieldMessage('resolution')}</label>
        <label>Presupuesto (ARS)<input {...field('budget')} inputMode="decimal" placeholder="12.500,00" />{fieldMessage('budget')}</label>
      </fieldset>
      <fieldset>
        <legend>Estado</legend>
        <label>Estado
          <select {...field('status')}>{orderStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select>{fieldMessage('status')}
        </label>
        <label>Fecha de ingreso<input {...field('receivedOn')} type="date" />{fieldMessage('receivedOn')}</label>
        <label>Fecha de retiro<input {...field('pickedUpOn')} type="date" />{fieldMessage('pickedUpOn')}</label>
      </fieldset>
      <button ref={submitRef} type="submit" className={showSuccess ? 'is-success' : undefined} disabled={disabled || isSubmitting || showSuccess}>{isSubmitting ? 'Procesando…' : showSuccess ? `${mode === 'create' ? 'Orden guardada' : 'Cambios guardados'} ✓` : submitLabel}</button>
    </form>
  )
}
