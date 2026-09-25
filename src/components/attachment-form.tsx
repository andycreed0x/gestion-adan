import { SubmitButton } from '@/components/submit-button'

type AttachmentFormProps = {
  action: (formData: FormData) => void | Promise<void>
  confirmed?: boolean
}

export function AttachmentForm({ action, confirmed }: AttachmentFormProps) {
  return (
    <form action={action} className="attachment-form">
      <label>Adjuntar foto o PDF
        <input name="attachment" type="file" accept="image/jpeg,image/png,application/pdf" required />
      </label>
      <SubmitButton label="Adjuntar archivo" pendingLabel="Adjuntando…" successLabel="Adjuntado ✓" confirmed={confirmed} />
    </form>
  )
}

