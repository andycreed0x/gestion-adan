import { describe, expect, it } from 'vitest'

import { createOrder, lookupCustomerByPhone, updateOrder } from './order-service'

function fakeSupabase(existingCustomer: { id: string } | null = null) {
  const calls: Array<[string, string, unknown?]> = []
  const customers = {
    select: () => customers,
    eq: (column: string, value: string) => { calls.push(['customers.eq', column, value]); return customers },
    maybeSingle: async () => ({ data: existingCustomer, error: null }),
    update: (payload: unknown) => { calls.push(['customers.update', '', payload]); return customers },
    insert: (payload: unknown) => { calls.push(['customers.insert', '', payload]); return customers },
    single: async () => ({ data: { id: 'new-customer' }, error: null }),
  }
  const orders = {
    insert: (payload: unknown) => { calls.push(['orders.insert', '', payload]); return orders },
    select: (columns?: string) => { calls.push(['orders.select', '', columns]); return orders },
    eq: (column: string, value: string) => { calls.push(['orders.eq', column, value]); return orders },
    maybeSingle: async () => ({ data: { customer_id: 'existing-customer' }, error: null }),
    update: (payload: unknown) => { calls.push(['orders.update', '', payload]); return orders },
    single: async () => ({ data: { id: 'order-id', order_number: 9380 }, error: null }),
  }
  return { calls, from: (table: string) => table === 'customers' ? customers : orders }
}

describe('order service customer identity', () => {
  it('looks up a customer through the canonical phone column', async () => {
    const supabase = fakeSupabase({ id: 'customer-id' })

    await lookupCustomerByPhone(supabase, '+54 9 11 4444-5555')

    expect(supabase.calls).toContainEqual(['customers.eq', 'phone_normalized', '5491144445555'])
  })

  it('updates the matching phone customer before creating its order', async () => {
    const supabase = fakeSupabase({ id: 'customer-id' })

    await createOrder(supabase, 'user-id', { customerName: 'Ana', customerAddress: 'Nueva 123', customerPhone: '11 4444-5555', equipment: 'TV' })

    expect(supabase.calls).toContainEqual(['customers.update', '', { full_name: 'Ana', address: 'Nueva 123', phone: '1144445555' }])
    expect(supabase.calls).toContainEqual(['orders.insert', '', expect.objectContaining({ customer_id: 'customer-id', created_by: 'user-id' })])
  })

  it('creates a separate customer when the optional phone is blank', async () => {
    const supabase = fakeSupabase()

    await createOrder(supabase, 'user-id', { customerName: 'Ana', customerAddress: '', customerPhone: '', equipment: 'TV' })

    expect(supabase.calls).toContainEqual(['customers.insert', '', { full_name: 'Ana', address: '', phone: '' }])
  })

  it('updates the current customer instead of orphaning it when an edited order has no phone', async () => {
    const supabase = fakeSupabase()

    await updateOrder(supabase, 'order-id', { customerName: 'Ana', customerAddress: 'Nueva 123', customerPhone: '', equipment: 'TV' })

    expect(supabase.calls).toContainEqual(['customers.update', '', { full_name: 'Ana', address: 'Nueva 123', phone: '' }])
    expect(supabase.calls).not.toContainEqual(['customers.insert', '', expect.anything()])
    expect(supabase.calls).toContainEqual(['orders.update', '', expect.objectContaining({ customer_id: 'existing-customer' })])
  })
})

function fakeDeleteSupabase() {
  const calls: Array<[string, unknown]> = []
  const attachments = {
    select: () => attachments,
    eq: async (column: string, value: string) => {
      calls.push(['attachments.eq', { column, value }])
      return { data: [{ storage_path: 'order-id/photo.jpg' }, { storage_path: 'order-id/receipt.pdf' }], error: null }
    },
  }
  const orders = {
    delete: () => orders,
    eq: async (column: string, value: string) => {
      calls.push(['orders.eq', { column, value }])
      return { error: null }
    },
  }
  const storage = {
    from: (bucket: string) => ({
      remove: async (paths: string[]) => {
        calls.push(['storage.remove', { bucket, paths }])
        return { error: null }
      },
    }),
  }
  return {
    calls,
    from: (table: string) => table === 'repair_order_attachments' ? attachments : orders,
    storage,
  }
}

it('removes attachment files before permanently deleting an order', async () => {
  const service = await import('./order-service') as Record<string, unknown>
  const deleteOrder = service.deleteOrder as ((client: ReturnType<typeof fakeDeleteSupabase>, orderId: string) => Promise<void>) | undefined
  const supabase = fakeDeleteSupabase()

  expect(deleteOrder).toBeTypeOf('function')
  if (!deleteOrder) return

  await deleteOrder(supabase, 'order-id')

  expect(supabase.calls).toEqual([
    ['attachments.eq', { column: 'repair_order_id', value: 'order-id' }],
    ['storage.remove', { bucket: 'order-attachments', paths: ['order-id/photo.jpg', 'order-id/receipt.pdf'] }],
    ['orders.eq', { column: 'id', value: 'order-id' }],
  ])
})
