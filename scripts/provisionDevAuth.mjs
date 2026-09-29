/**
 * Create disposable Supabase Auth users for a non-production project.
 * Passwords come only from the environment. Nothing is printed back.
 *
 * Refuses any *.supabase.co host so this cannot write the live Drinks project.
 */
import { createClient } from '@supabase/supabase-js'

const url = String(process.env.SUPABASE_URL || '').trim()
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()

function refuse(message) {
  console.error(message)
  process.exit(1)
}

if (!url || !key) {
  refuse('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Do not use a frontend environment variable.')
}

let host = ''
try { host = new URL(url).hostname } catch { refuse('SUPABASE_URL is not a URL') }
if (host === 'supabase.co' || host.endsWith('.supabase.co')) {
  refuse('refusing a Supabase host. Point SUPABASE_URL at a local or disposable Auth server.')
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

const ACCOUNTS = [
  ['TEST_POS_EMAIL', 'TEST_POS_PASSWORD', 'TEST_POS_BAR_ID', 'caixa', 'POS test'],
  ['TEST_EMPLOYEE_EMAIL', 'TEST_EMPLOYEE_PASSWORD', 'TEST_EMPLOYEE_BAR_ID', 'bar_staff', 'Employee test'],
  ['TEST_MANAGER_EMAIL', 'TEST_MANAGER_PASSWORD', 'TEST_MANAGER_BAR_ID', 'gerente', 'Manager test'],
]

let made = 0
for (const [emailKey, passwordKey, barKey, role, nome] of ACCOUNTS) {
  const email = String(process.env[emailKey] || '').trim().toLowerCase()
  const password = String(process.env[passwordKey] || '')
  const barId = String(process.env[barKey] || process.env.TEST_BAR_ID || '').trim()
  if (!email && !password) continue
  if (!email || !password || !barId) refuse(`${emailKey}, ${passwordKey}, and ${barKey} (or TEST_BAR_ID) are required together`)
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nome },
  })
  if (error) refuse(`${emailKey}: ${error.message}`)
  const id = data.user?.id
  const saved = await admin.from('perfis').upsert({ id, email, nome, role, bar_id: barId }, { onConflict: 'id' })
  if (saved.error) refuse(`${emailKey} profile: ${saved.error.message}`)
  const directory = await admin.from('bar_employees').upsert({
    id,
    bar_id: barId,
    job_role: role === 'caixa' ? 'cashier' : role === 'gerente' ? 'manager' : 'staff',
    permission_role: role,
    status: 'active',
  }, { onConflict: 'id' })
  if (directory.error && !/bar_employees/i.test(directory.error.message || '')) {
    refuse(`${emailKey} employee: ${directory.error.message}`)
  }
  made += 1
  console.log(`${role} provisioned ${email}`)
}

if (!made) refuse('No TEST_*_EMAIL values were set')
console.log(`provisioned ${made} auth user(s)`)
