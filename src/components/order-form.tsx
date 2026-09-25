import { SubmitButton } from '@/components/submit-button'
import { orderStatuses, type OrderStatus } from '@/lib/orders'

type OrderFormValues = {
  customerName?: string
  customerAddress?: string
  customerPhone?: string
  equipment?: string
  accessories?: string
  reportedFault?: string
  resolution?: string
  budget?: string
  status?: OrderStatus
  receivedOn?: string
  pickedUpOn?: string
}

type OrderFormProps = {
  action: (formData: FormData) => void | Promise<void>
  values?: OrderFormValues
  error?: string
  submitLabel: string
  confirmed?: boolean
}

export function OrderForm({ action, values = {}, error, submitLabel, confirmed }: OrderFormProps) {
  return (
    <form action={action} className="order-form">
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <fieldset>
        <legend>Cliente</legend>
        <label>Nombre<input name="customerName" required defaultValue={values.customerName} /></label>
        <label>Dirección<input name="customerAddress" defaultValue={values.customerAddress} /></label>
        <label>Teléfono<input name="customerPhone" defaultValue={values.customerPhone} /></label>
      </fieldset>
      <fieldset>
        <legend>Equipo</legend>
        <label>Tipo / marca / modelo<input name="equipment" required defaultValue={values.equipment} /></label>
        <label>Accesorios<input name="accessories" defaultValue={values.accessories} /></label>
      </fieldset>
      <fieldset>
        <legend>Diagnóstico</legend>
        <label>Falla reportada<textarea name="reportedFault" rows={3} defaultValue={values.reportedFault} /></label>
        <label>Resolución / reparación<textarea name="resolution" rows={3} defaultValue={values.resolution} /></label>
        <label>Presupuesto (ARS)<input name="budget" inputMode="decimal" placeholder="12.500,00" defaultValue={values.budget} /></label>
      </fieldset>
      <fieldset>
        <legend>Estado</legend>
        <label>Estado
          <select name="status" defaultValue={values.status ?? 'received'}>
            {orderStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label>Fecha de ingreso<input name="receivedOn" type="date" defaultValue={values.receivedOn} /></label>
        <label>Fecha de retiro<input name="pickedUpOn" type="date" defaultValue={values.pickedUpOn} /></label>
      </fieldset>
      <SubmitButton label={submitLabel} pendingLabel="Guardando…" successLabel="Guardado ✓" confirmed={confirmed} />
    </form>
  )
}
