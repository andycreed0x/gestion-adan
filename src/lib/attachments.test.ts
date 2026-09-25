import { describe, expect, it } from 'vitest'

import { buildAttachmentLinks, isViewableImage } from './attachments'

const pdf = { id: 'a', storage_path: 'order-a/a.pdf', file_name: 'manual.pdf', mime_type: 'application/pdf', size_bytes: 100, created_at: '2026-09-25T00:00:00Z' }
const jpg = { id: 'b', storage_path: 'order-a/b.jpg', file_name: 'frente.jpg', mime_type: 'image/jpeg', size_bytes: 200, created_at: '2026-09-25T00:00:01Z' }
const png = { id: 'c', storage_path: 'order-a/c.png', file_name: 'etiqueta.png', mime_type: 'image/png', size_bytes: 300, created_at: '2026-09-25T00:00:02Z' }

type SignerCall = { path: string; downloadName?: string }

function signer(calls: SignerCall[]) {
  return async (path: string, downloadName?: string) => {
    calls.push({ path, downloadName })
    return 'https://storage.test/' + path + (downloadName ? '?download' : '?view')
  }
}

describe('buildAttachmentLinks', () => {
  it('offers a download link for every attachment and a view link only for images', async () => {
    const links = await buildAttachmentLinks([pdf, jpg, png], signer([]))

    expect(links.map((link) => link.downloadUrl)).toEqual([
      'https://storage.test/order-a/a.pdf?download',
      'https://storage.test/order-a/b.jpg?download',
      'https://storage.test/order-a/c.png?download',
    ])
    expect(links.map((link) => link.viewUrl)).toEqual([
      null,
      'https://storage.test/order-a/b.jpg?view',
      'https://storage.test/order-a/c.png?view',
    ])
  })

  it('asks storage for the download using the original file name', async () => {
    const calls: SignerCall[] = []

    await buildAttachmentLinks([pdf], signer(calls))

    expect(calls).toEqual([{ path: 'order-a/a.pdf', downloadName: 'manual.pdf' }])
  })

  it('keeps the metadata and exposes no link when storage returns nothing', async () => {
    const [link] = await buildAttachmentLinks([jpg], async () => null)

    expect(link).toEqual({ ...jpg, viewUrl: null, downloadUrl: null })
  })

  it('treats only JPEG and PNG as viewable', () => {
    expect(isViewableImage('image/jpeg')).toBe(true)
    expect(isViewableImage('image/png')).toBe(true)
    expect(isViewableImage('application/pdf')).toBe(false)
  })
})
