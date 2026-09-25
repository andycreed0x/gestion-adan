'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { makeAttachmentPath } from '@/lib/orders'
import { createServerSupabaseClient } from '@/lib/supabase/server'

const allowedTypes = new Set(['image/jpeg', 'image/png', 'application/pdf'])
const maxBytes = 5 * 1024 * 1024

export async function uploadAttachmentAction(orderId: string, formData: FormData) {
  const attachment = formData.get('attachment')
  if (!(attachment instanceof File) || attachment.size === 0) {
    redirect(`/orders/${orderId}?error=Elegí+un+archivo+válido`)
  }
  if (!allowedTypes.has(attachment.type) || attachment.size > maxBytes) {
    redirect(`/orders/${orderId}?error=El+archivo+debe+ser+JPG,+PNG+o+PDF+de+hasta+5+MB`)
  }

  const supabase = await createServerSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const storagePath = makeAttachmentPath(orderId, attachment.name)
  const { error: uploadError } = await supabase.storage
    .from('order-attachments')
    .upload(storagePath, attachment, { contentType: attachment.type, upsert: false })
  if (uploadError) redirect(`/orders/${orderId}?error=${encodeURIComponent(uploadError.message)}`)

  const { error: metadataError } = await supabase.from('repair_order_attachments').insert({
    repair_order_id: orderId,
    storage_path: storagePath,
    file_name: attachment.name,
    mime_type: attachment.type,
    size_bytes: attachment.size,
    uploaded_by: user.id,
  })
  if (metadataError) {
    await supabase.storage.from('order-attachments').remove([storagePath])
    redirect(`/orders/${orderId}?error=${encodeURIComponent(metadataError.message)}`)
  }

  revalidatePath(`/orders/${orderId}`)
  redirect(`/orders/${orderId}?attached=1`)
}
