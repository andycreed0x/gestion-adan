export type RepairOrderAttachment = {
  id: string
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number
  created_at: string
}

export type AttachmentLink = RepairOrderAttachment & {
  viewUrl: string | null
  downloadUrl: string | null
}

const viewableMimeTypes = new Set(['image/jpeg', 'image/png'])

export function isViewableImage(mimeType: string): boolean {
  return viewableMimeTypes.has(mimeType)
}

export async function buildAttachmentLinks(
  attachments: RepairOrderAttachment[],
  createSignedUrl: (storagePath: string, downloadName?: string) => Promise<string | null>,
): Promise<AttachmentLink[]> {
  return Promise.all(attachments.map(async (attachment) => {
    const [viewUrl, downloadUrl] = await Promise.all([
      isViewableImage(attachment.mime_type)
        ? createSignedUrl(attachment.storage_path)
        : Promise.resolve(null),
      createSignedUrl(attachment.storage_path, attachment.file_name),
    ])
    return { ...attachment, viewUrl, downloadUrl }
  }))
}
