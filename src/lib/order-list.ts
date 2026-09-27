import { orderStatuses, type OrderStatus } from './orders'

export const ORDER_PAGE_SIZE = 25
export const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires'

type SearchParams = URLSearchParams | Record<string, string | string[] | undefined>

export type OrderListFilters = {
  q: string
  status: OrderStatus | ''
  receivedFrom: string
  receivedTo: string
  page: number
  pageSize: number
  implicitRecentWindow: boolean
  recentStart: string | null
}

export type OrderListRow = {
  id: string
  order_number: number
  equipment: string
  status: OrderStatus
  budget_cents: number | null
  received_on: string
  picked_up_on: string | null
  customer_name: string
  customer_address: string
  customer_phone: string
  customer_phone_normalized: string | null
  search_text: string
}

export type OrderListPage = {
  orders: OrderListRow[]
  page: number
  pageSize: number
  total: number
  filters: OrderListFilters
}

export type OrderListQuery = {
  select: (columns: string, options: { count: 'exact' }) => OrderListQuery
  ilike: (column: string, pattern: string) => OrderListQuery
  eq: (column: string, value: string) => OrderListQuery
  gte: (column: string, value: string) => OrderListQuery
  lte: (column: string, value: string) => OrderListQuery
  order: (column: string, options: { ascending: boolean }) => OrderListQuery
  range: (from: number, to: number) => OrderListQuery
}

type ListClient = { from: (table: 'repair_order_list') => any }

function valueOf(params: SearchParams, key: string): string {
  if (params instanceof URLSearchParams) return params.get(key) ?? ''
  const value = params[key]
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

export function argentinaCalendarDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ARGENTINA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function daysBefore(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const result = new Date(Date.UTC(year, month - 1, day - days))
  return result.toISOString().slice(0, 10)
}

export function parseOrderListSearchParams(params: SearchParams, now = new Date()): OrderListFilters {
  const q = valueOf(params, 'q').trim()
  const rawStatus = valueOf(params, 'status')
  const status = orderStatuses.includes(rawStatus as OrderStatus) ? rawStatus as OrderStatus : ''
  const receivedFrom = valueOf(params, 'receivedFrom')
  const receivedTo = valueOf(params, 'receivedTo')
  const parsedPage = Number(valueOf(params, 'page'))
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1
  const implicitRecentWindow = !(q || status || receivedFrom || receivedTo)
  const today = argentinaCalendarDate(now)

  return {
    q,
    status,
    receivedFrom,
    receivedTo,
    page,
    pageSize: ORDER_PAGE_SIZE,
    implicitRecentWindow,
    recentStart: implicitRecentWindow ? daysBefore(today, 29) : null,
  }
}

export function buildOrderListQuery(client: ListClient, filters: OrderListFilters): OrderListQuery {
  let query = client
    .from('repair_order_list')
    .select('*', { count: 'exact' }) as OrderListQuery

  if (filters.q) query = query.ilike('search_text', `%${filters.q.toLocaleLowerCase('es-AR')}%`)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.receivedFrom) query = query.gte('received_on', filters.receivedFrom)
  if (filters.receivedTo) query = query.lte('received_on', filters.receivedTo)
  if (filters.implicitRecentWindow && filters.recentStart) query = query.gte('received_on', filters.recentStart)

  const first = (filters.page - 1) * filters.pageSize
  return query
    .order('received_on', { ascending: false })
    .order('order_number', { ascending: false })
    .range(first, first + filters.pageSize - 1)
}

export async function queryOrderPage(client: ListClient, filters: OrderListFilters): Promise<OrderListPage> {
  const response = await (buildOrderListQuery(client, filters) as unknown as Promise<{
    data: OrderListRow[] | null
    count: number | null
    error: { message: string } | null
  }>)
  if (response.error) throw new Error(response.error.message)

  return {
    orders: response.data ?? [],
    page: filters.page,
    pageSize: filters.pageSize,
    total: response.count ?? 0,
    filters,
  }
}

export function orderListHref(filters: OrderListFilters, page: number): string {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.status) params.set('status', filters.status)
  if (filters.receivedFrom) params.set('receivedFrom', filters.receivedFrom)
  if (filters.receivedTo) params.set('receivedTo', filters.receivedTo)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query ? `/orders?${query}` : '/orders'
}
