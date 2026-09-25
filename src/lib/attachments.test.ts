import { describe, expect, it } from 'vitest'

import { buildAttachmentDownloadLinks } from './attachments'

describe('buildAttachmentDownloadLinks', () => {
  it('keeps attachment metadata and exposes only the signed URLs returned by storage', async () => {
    const attachments = [
      { id: 'a', storage_path: 'order-a/a.pdf', file_name: 'a.pdf', mime_type: 'application/pdf', size_bytes: 100, created_at: '2026-09-25T00:00:00Z' },
      { id: 'b', storage_path: 'order-a/b.jpg', file_name: 'b.jpg', mime_type: 'image/jpeg', size_bytes: 200, created_at: '2026-09-25T00:00:01Z' },
    ]
    const createSignedUrl = async (path: string) => path.endsWith('.pdf') ? 'https://storage.test/a.pdf?token=signed' : null

    await expect(buildAttachmentDownloadLinks(attachments, createSignedUrl)).resolves.toEqual([
      { ...attachments[0], downloadUrl: 'https://storage.test/a.pdf?token=signed' },
      { ...attachments[1], downloadUrl: null },
    ])
  })
})
