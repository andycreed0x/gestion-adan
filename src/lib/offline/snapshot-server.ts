import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { argentinaCalendarDate } from '@/lib/order-list'
import type { CachedOrder, OfflineSnapshot } from './types'

export type { OfflineSnapshot } from './types'

type SnapshotCustomer = { full_name: string; address: string; phone: string }
type SnapshotRow = {
  id: string
  order_number: number
  equipment: string
  accessories: string
  reported_fault: string
  resolution: string
  budget_cents: number | null
  status: CachedOrder['status']
  received_on: string
  picked_up_on: string | null
  customers: SnapshotCustomer | SnapshotCustomer[] | null
}

function cachedOrder(row: SnapshotRow): CachedOrder {
  const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers
  return {
    id: row.id,
    orderNumber: row.order_number,
    customerName: customer?.full_name ?? '',
    customerAddress: customer?.address ?? '',
    customerPhone: customer?.phone ?? '',
    equipment: row.equipment,
    accessories: row.accessories,
    reportedFault: row.reported_fault,
    resolution: row.resolution,
    budgetCents: row.budget_cents,
    status: row.status,
    receivedOn: row.received_on,
    pickedUpOn: row.picked_up_on,
  }
}

export async function queryOfflineSnapshot(
  client: Pick<SupabaseClient, 'from'>,
  ownerId: string,
  { now = new Date(), signal }: { now?: Date; signal?: AbortSignal } = {},
): Promise<OfflineSnapshot> {
  signal?.throwIfAborted()
  const today = argentinaCalendarDate(now)
  const start = new Date(`${today}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 29)
  const windowStart = start.toISOString().slice(0, 10)
  const orders: CachedOrder[] = []
  let cursor: number | undefined

  for (;;) {
    signal?.throwIfAborted()
    let query = client
      .from('repair_orders')
      .select('id, order_number, equipment, accessories, reported_fault, resolution, budget_cents, status, received_on, picked_up_on, customers(full_name, address, phone)')
      .gte('received_on', windowStart)
      .lte('received_on', today)
      .order('order_number', { ascending: true })
      .limit(500)
    if (cursor !== undefined) query = query.gt('order_number', cursor)
    if (signal) query = query.abortSignal(signal)

    const { data, error } = await query
    signal?.throwIfAborted()
    if (error) throw new Error(error.message)
    if (!Array.isArray(data)) throw new Error('La consulta del snapshot no devolvió órdenes')
    // A configured server row cap can be smaller than 500. Only an empty
    // batch proves exhaustion; a short batch must still advance the cursor.
    if (data.length === 0) break

    for (const row of data as unknown as SnapshotRow[]) {
      if (!Number.isSafeInteger(row.order_number) || (cursor !== undefined && row.order_number <= cursor)) {
        throw new Error('El cursor de órdenes del snapshot no avanzó de forma válida')
      }
      orders.push(cachedOrder(row))
      cursor = row.order_number
    }
  }

  return { schemaVersion: 1, ownerId, windowStart, generatedAt: now.toISOString(), orders }
}
