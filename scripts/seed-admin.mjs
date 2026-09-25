import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secret = process.env.SUPABASE_SECRET_KEY
const email = process.env.INITIAL_ADMIN_EMAIL
const password = process.env.INITIAL_ADMIN_PASSWORD

if (!url || !secret || !email || !password) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD are required')
}

const supabase = createClient(url, secret, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { display_name: 'Administrador ADAN' },
})

if (error) throw error
console.log(JSON.stringify({ id: data.user.id, email: data.user.email }))
