'use client'

import { useEffect, useState } from 'react'

import type { AttachmentLink } from '@/lib/attachments'

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB'
}

export function AttachmentList({ attachments }: { attachments: AttachmentLink[] }) {
  const [preview, setPreview] = useState<AttachmentLink | null>(null)

  useEffect(() => {
    if (!preview) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreview(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [preview])

  if (!attachments.length) return <p className="muted">Todavía no hay archivos adjuntos.</p>

  return (
    <>
      <ul className="attachment-list">
        {attachments.map((attachment) => (
          <li key={attachment.id}>
            {attachment.viewUrl ? (
              <button type="button" className="attachment-thumb" onClick={() => setPreview(attachment)} aria-label={'Ver ' + attachment.file_name}>
                <img src={attachment.viewUrl} alt={attachment.file_name} />
              </button>
            ) : null}
            <div className="attachment-meta">
              <strong>{attachment.file_name}</strong>
              <small>{attachment.mime_type} · {formatSize(attachment.size_bytes)}</small>
              <div className="attachment-actions">
                {attachment.viewUrl ? (
                  <button type="button" className="secondary" onClick={() => setPreview(attachment)}>Ver</button>
                ) : null}
                {attachment.downloadUrl ? (
                  <a className="button secondary" href={attachment.downloadUrl}>Descargar</a>
                ) : (
                  <small className="muted">Sin enlace disponible</small>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {preview && preview.viewUrl ? (
        <div className="attachment-viewer" role="dialog" aria-modal="true" aria-label={preview.file_name} onClick={() => setPreview(null)}>
          <div className="attachment-viewer-panel" onClick={(event) => event.stopPropagation()}>
            <header>
              <strong>{preview.file_name}</strong>
              <button type="button" className="secondary" onClick={() => setPreview(null)}>Cerrar</button>
            </header>
            <img src={preview.viewUrl} alt={preview.file_name} />
          </div>
        </div>
      ) : null}
    </>
  )
}

