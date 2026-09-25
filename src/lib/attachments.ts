export type RepairOrderAttachment = {
  id: string
  storage_path: string
  file_name: string
  mime_type: string
  size_bytes: number
  created_at: string
}

export async function buildAttachmentDownloadLinks(
  attachments: RepairOrderAttachment[],
  createSignedUrl: (storagePath: string) => Promise<string | null>,
): Promise<Array<RepairOrderAttachment & { downloadUrl: string | null }>> {
  return Promise.all(attachments.map(async (attachment) => ({
    ...attachment,
    downloadUrl: await createSignedUrl(attachment.storage_path),
  })))
}
