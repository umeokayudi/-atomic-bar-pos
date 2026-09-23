import { createClient } from '@supabase/supabase-js'
import { DRINKS_SUPABASE_URL } from './_supabaseAdmin.js'

const HOLDING_URL = process.env.HOLDING_SUPABASE_URL || 'https://fxsakrshmldmkdmbevna.supabase.co'
const rawDrinksUrl = process.env.VITE_SUPABASE_URL || ''
const DRINKS_URL = /^https:\/\/[a-z0-9]+\.supabase\.co/i.test(rawDrinksUrl) ? rawDrinksUrl : DRINKS_SUPABASE_URL
const BUCKET = 'system-private'
const KEY_FILE = 'holding_service_role_key.txt'

export async function resolveHoldingKey() {
  if (process.env.HOLDING_SERVICE_ROLE_KEY) return process.env.HOLDING_SERVICE_ROLE_KEY
  const drinksKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!drinksKey) return null
  const sb = createClient(DRINKS_URL, drinksKey, { auth: { autoRefreshToken: false, persistSession: false } })
  try {
    const { data } = await sb.storage.from(BUCKET).download(KEY_FILE)
    if (data) return (await data.text()).trim()
  } catch { /* */ }
  return null
}

export async function holdingAdminClient() {
  const key = await resolveHoldingKey()
  if (!key) throw new Error('HOLDING_SERVICE_ROLE_KEY não configurada')
  return createClient(HOLDING_URL, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function parseMeta(row) {
  if (!row?.description) return {}
  try {
    const j = JSON.parse(row.description)
    return typeof j === 'object' && j ? j : {}
  } catch {
    return { text: row.description }
  }
}

export async function fetchAllHoldingModules(sb) {
  const [finR, placeR] = await Promise.all([
    sb.from('jbm_financeiro').select('*').order('date', { ascending: false }),
    sb.from('hr_placements').select('*').order('placement_date', { ascending: false }),
  ])
  if (finR.error) throw new Error(finR.error.message)
  if (placeR.error) throw new Error(placeR.error.message)

  const rows = finR.data || []
  const presentations = []
  const commissions = []
  const jobs = []
  const inv = []
  const ret = []

  for (const r of rows) {
    const m = parseMeta(r)
    if (r.unit === 'HR' && r.category === 'apresentacao') {
      presentations.push({
        id: r.id,
        candidate_name: m.candidate_name || '',
        client_company: m.client_company || '',
        position: m.position || '',
        presentation_date: r.date,
        status: m.status || (r.paid ? 'aprovada' : 'agendada'),
        expected_fee: Number(m.expected_fee ?? r.amount ?? 0),
        commission_rate: Number(m.commission_rate || 0),
        notes: m.notes || m.text || '',
        created_at: r.created_at,
      })
    } else if (r.unit === 'HR' && r.category === 'comissao') {
      commissions.push({
        id: r.id,
        type: m.comm_type || 'colocacao',
        candidate_name: m.candidate_name || '',
        client_company: m.client_company || '',
        amount: Number(r.amount || 0),
        due_date: r.due_date,
        paid_date: r.paid ? r.date : null,
        status: r.paid ? 'pago' : (m.status || 'pendente'),
        notes: m.notes || '',
        created_at: r.created_at,
      })
    } else if (r.unit === 'Logistica' && r.category === 'frete') {
      jobs.push({
        id: r.id,
        reference: m.reference || '',
        client_name: m.client_name || '',
        route_description: m.route_description || '',
        job_date: r.date,
        revenue: Number(m.revenue ?? r.amount ?? 0),
        cost: Number(m.cost || 0),
        commission: Number(m.commission || 0),
        commission_status: m.commission_status || (r.paid ? 'pago' : 'pendente'),
        status: m.status || 'ativo',
        notes: m.notes || '',
        created_at: r.created_at,
      })
    } else if (r.unit === 'Investimentos' && r.category === 'investimento') {
      inv.push({
        id: r.id,
        person_name: m.person_name || '',
        person_ref: m.person_ref || '',
        unit: m.person_unit || 'HR',
        investment_type: m.investment_type || 'formacao',
        amount_invested: Number(r.amount || 0),
        invested_at: r.date,
        expected_return_date: m.expected_return_date || null,
        expected_return_amount: Number(m.expected_return_amount || 0),
        status: m.status || 'ativo',
        notes: m.notes || '',
        created_at: r.created_at,
      })
    } else if (r.unit === 'Investimentos' && r.category === 'retorno') {
      ret.push({
        id: r.id,
        investment_id: m.investment_id,
        amount: Number(r.amount || 0),
        return_date: r.date,
        source: m.source || 'trabalho',
        notes: m.notes || '',
        jbm_investments: { person_name: m.person_name, unit: m.person_unit },
        created_at: r.created_at,
      })
    }
  }

  return {
    presentations,
    placements: placeR.data || [],
    commissions,
    jobs,
    inv,
    ret,
    geradoEm: new Date().toISOString(),
  }
}
