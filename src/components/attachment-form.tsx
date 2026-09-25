type AttachmentFormProps = {
  action: (formData: FormData) => void | Promise<void>
}

export function AttachmentForm({ action }: AttachmentFormProps) {
  return (
    <form action={action} className="attachment-form">
      <label>Adjuntar foto o PDF
        <input name="attachment" type="file" accept="image/jpeg,image/png,application/pdf" required />
      </label>
      <button type="submit">Adjuntar archivo</button>
    </form>
  )
}
