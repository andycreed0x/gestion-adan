import { normalizeArgentinePhone } from './customer-phone'
import { type OrderDraft, type OrderValidation, validateOrderDraft } from './orders'

export type OrderServiceClient = { from: (table: 'customers' | 'repair_orders') => any }

export type CustomerLookup = {
  id: string
  full_name: string
  address: string
  phone: string
}

export class OrderValidationError extends Error {
  constructor(public readonly validation: OrderValidation) {
    super('La orden contiene datos inválidos')
  }
}

function validatedDraft(draft: OrderDraft) {
  const validation = validateOrderDraft(draft)
  if (!validation.data) throw new OrderValidationError(validation)
  return validation.data
}

export async function lookupCustomerByPhone(client: OrderServiceClient, rawPhone: string): Promise<CustomerLookup | null> {
  const phone = normalizeArgentinePhone(rawPhone)
  if (!phone) return null

  const { data, error } = await client
    .from('customers')
    .select('id, full_name, address, phone')
    .eq('phone_normalized', phone)
    .maybeSingle()
  if (error) throw error
  return data
}

async function resolveCustomer(
  client: OrderServiceClient,
  input: { customerName: string; customerAddress: string; customerPhone: string },
  currentCustomerId?: string | null,
): Promise<string> {
  const normalizedPhone = normalizeArgentinePhone(input.customerPhone)
  if (normalizedPhone) {
    const existing = await lookupCustomerByPhone(client, input.customerPhone)
    if (existing) {
      const { error } = await client
        .from('customers')
        .update({ full_name: input.customerName, address: input.customerAddress, phone: input.customerPhone })
        .eq('id', existing.id)
      if (error) throw error
      return existing.id
    }
  }

  if (currentCustomerId) {
    const { error } = await client
      .from('customers')
      .update({ full_name: input.customerName, address: input.customerAddress, phone: input.customerPhone })
      .eq('id', currentCustomerId)
    if (error) throw error
    return currentCustomerId
  }

  const { data, error } = await client
    .from('customers')
    .insert({ full_name: input.customerName, address: input.customerAddress, phone: input.customerPhone })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export async function createOrder(client: OrderServiceClient, userId: string, draft: OrderDraft) {
  const input = validatedDraft(draft)
  const customerId = await resolveCustomer(client, input)
  const { data, error } = await client
    .from('repair_orders')
    .insert({
      customer_id: customerId,
      equipment: input.equipment,
      accessories: input.accessories,
      reported_fault: input.reportedFault,
      resolution: input.resolution,
      budget_cents: input.budgetCents,
      status: input.status,
      received_on: input.receivedOn,
      picked_up_on: input.pickedUpOn,
      created_by: userId,
    })
    .select('id, order_number')
    .single()
  if (error) throw error
  return data as { id: string; order_number: number }
}

export async function updateOrder(client: OrderServiceClient, orderId: string, draft: OrderDraft) {
  const input = validatedDraft(draft)
  const { data: currentOrder, error: currentOrderError } = await client
    .from('repair_orders')
    .select('customer_id')
    .eq('id', orderId)
    .maybeSingle()
  if (currentOrderError) throw currentOrderError

  const customerId = await resolveCustomer(client, input, currentOrder?.customer_id)
  const { error } = await client
    .from('repair_orders')
    .update({
      customer_id: customerId,
      equipment: input.equipment,
      accessories: input.accessories,
      reported_fault: input.reportedFault,
      resolution: input.resolution,
      budget_cents: input.budgetCents,
      status: input.status,
      received_on: input.receivedOn,
      picked_up_on: input.pickedUpOn,
    })
    .eq('id', orderId)
  if (error) throw error
}
