import { NextResponse, type NextRequest } from 'next/server'

import { hasValidCronSecret } from '@/lib/cron'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'

export async function GET(request: NextRequest) {
  if (!hasValidCronSecret(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - 90)
  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase
    .from('repair_orders')
    .select('id, order_number, received_on, status')
    .in('status', ['received', 'in_progress', 'ready'])
    .lt('received_on', cutoff.toISOString().slice(0, 10))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ checkedAt: new Date().toISOString(), overdueCount: data.length, orders: data })
}
