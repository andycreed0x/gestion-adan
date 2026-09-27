import { notFound } from 'next/navigation'

import { AttachmentForm } from '@/components/attachment-form'
import { CachedOrderDetail } from '@/components/cached-order-detail'
import { AttachmentList } from '@/components/attachment-list'
import { OrderForm } from '@/components/order-form'
import { WhatsAppOrderButton } from '@/components/whatsapp-order-button'
import { buildAttachmentLinks } from '@/lib/attachments'
import { formatCurrency, type OrderStatus } from '@/lib/orders'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { updateOrderAction } from '../actions'
import { uploadAttachmentAction } from './attachment-actions'

type OrderPageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; saved?: string; attached?: string }>
}

export default async function OrderPage({ params, searchParams }: OrderPageProps) {
  const [{ id }, { error, saved, attached }] = await Promise.all([params, searchParams])
  const supabase = await createServerSupabaseClient()
  const { data: order, error: queryError } = await supabase
    .from('repair_orders')
    .select('id, order_number, equipment, accessories, reported_fault, resolution, budget_cents, status, received_on, picked_up_on, customers(full_name, address, phone)')
    .eq('id', id)
    .maybeSingle()
  if (queryError) throw new Error(queryError.message)
  if (!order) notFound()

  const customer = Array.isArray(order.customers) ? order.customers[0] : order.customers
  const action = updateOrderAction.bind(null, id)
  const attachmentAction = uploadAttachmentAction.bind(null, id)
  const { data: attachments } = await supabase
    .from('repair_order_attachments')
    .select('id, storage_path, file_name, mime_type, size_bytes, created_at')
    .eq('repair_order_id', id)
    .order('created_at', { ascending: false })
  const attachmentLinks = await buildAttachmentLinks(attachments ?? [], async (storagePath, downloadName) => {
    const { data } = await supabase.storage
      .from('order-attachments')
      .createSignedUrl(storagePath, 3600, downloadName ? { download: downloadName } : undefined)
    return data?.signedUrl ?? null
  })
  const budget = order.budget_cents === null ? '' : (order.budget_cents / 100).toFixed(2).replace('.', ',')

  return (
    <section className="page-section">
      <div className="page-heading"><div><a href="/orders">← Órdenes</a><h1>Orden #{order.order_number}</h1><p className="muted">{formatCurrency(order.budget_cents)}</p></div><div className="detail-actions"><a className="button" href="/orders/new">Nueva orden</a><a className="button secondary" href={`/orders/${id}/print`}>Imprimir ticket</a><WhatsAppOrderButton order={{ persistence: 'persisted', orderNumber: order.order_number, customerName: customer?.full_name ?? '', customerAddress: customer?.address ?? '', customerPhone: customer?.phone ?? '', equipment: order.equipment, accessories: order.accessories, reportedFault: order.reported_fault, resolution: order.resolution, budgetCents: order.budget_cents, status: order.status as OrderStatus, receivedOn: order.received_on, pickedUpOn: order.picked_up_on ?? null }} /></div></div>
      <CachedOrderDetail order={{ id: order.id, orderNumber: order.order_number, customerName: customer?.full_name ?? '', customerAddress: customer?.address ?? '', customerPhone: customer?.phone ?? '', equipment: order.equipment, accessories: order.accessories, reportedFault: order.reported_fault, resolution: order.resolution, budgetCents: order.budget_cents, status: order.status as OrderStatus, receivedOn: order.received_on, pickedUpOn: order.picked_up_on ?? null }} />
      <OrderForm mode="update" action={action} error={error} submitLabel="Guardar cambios" confirmed={saved === '1'} values={{
        customerName: customer?.full_name,
        customerAddress: customer?.address,
        customerPhone: customer?.phone,
        equipment: order.equipment,
        accessories: order.accessories,
        reportedFault: order.reported_fault,
        resolution: order.resolution,
        budget,
        status: order.status as OrderStatus,
        receivedOn: order.received_on,
        pickedUpOn: order.picked_up_on ?? undefined,
      }} />
      <section className="attachments">
        <h2>Adjuntos</h2>
        <AttachmentForm action={attachmentAction} confirmed={attached === '1'} />
        <AttachmentList attachments={attachmentLinks} />
      </section>
    </section>
  )
}
