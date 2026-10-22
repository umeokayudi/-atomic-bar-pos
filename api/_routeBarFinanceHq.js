/**
 * GET /api/bar/bar-finance — JBM admin only. Read-only money view of any client bar.
 *   ?month=YYYY-MM            → { month, bars: [...] } one summary row per bar
 *   ?bar_id=<id>&month=YYYY-MM → { bar, hq, registry, goals, wagesByMonth } for the bar page
 */

import { tryDrinksAdminClient } from './_supabaseAdmin.js'
import { handleCorsPreflight, setCorsHeaders } from './_cors.js'
import { requireGlobalFinance } from './_requireStaff.js'
import { buildHqSnapshot, pgOrLive } from './_hqSnapshot.js'
import { runLiveOp, listStaffWithExtras } from './_barLiveStore.js'
import { errText } from '../src/lib/errText.js'
import { monthRange, recentMonthKeys, shiftMonthKey, tokyoMonthKey } from '../src/lib/tokyo.js'
import { payrollFromPunches } from '../src/lib/timeClock.js'
import { barListRow } from '../src/lib/barFinanceHq.js'

async function barExtras(admin, barId) {
  const [registry, goals] = await Promise.all([
    runLiveOp(admin, { table: 'bar_registry', mode: 'select', columns: '*', filters: [{ op: 'eq', k: 'bar_id', v: barId }] })
      .then(r => r.data || []).catch(() => []),
    runLiveOp(admin, { table: 'bar_goals', mode: 'select', columns: '*', filters: [{ op: 'eq', k: 'bar_id', v: barId }], wantSingle: 'maybe' })
      .then(r => r.data || {}).catch(() => ({})),
  ])
  return { registry, goals }
}

/** Staff pay per month for the six months the cash flow shows (the snapshot only counts two). */
async function wagesByMonth(admin, barId, monthKey, goals) {
  const keys = recentMonthKeys(6, monthKey)
  const from = monthRange(`${keys[keys.length - 1]}-01`).from
  const to = monthRange(`${monthKey}-01`).to
  const [clock, staff] = await Promise.all([
    pgOrLive(admin, 'time_clock', [
      { op: 'eq', k: 'bar_id', v: barId },
      { op: 'gte', k: 'punched_at', v: from },
      { op: 'lte', k: 'punched_at', v: to },
    ]),
    listStaffWithExtras(admin, barId).catch(() => []),
  ])
  const nightPremium = goals?.adicional_noturno !== false
  const out = {}
  for (const key of keys) {
    const pay = payrollFromPunches(clock.rows || [], staff || [], monthRange(`${key}-01`), { nightPremium })
    out[key] = Math.round(pay.reduce((a, r) => a + (+r.pay || 0), 0))
  }
  return out
}

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return
  setCorsHeaders(req, res, 'GET, OPTIONS')
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const admin = tryDrinksAdminClient()
  const auth = await requireGlobalFinance(req, admin)
  if (auth.error) return res.status(auth.status).json({ error: errText(auth.error, 'Unauthorized') })
  if (!admin) return res.status(500).json({ error: 'Server key missing (SUPABASE_SERVICE_ROLE_KEY)' })

  const asked = String(req.query?.month || '')
  const current = tokyoMonthKey()
  const month = /^\d{4}-\d{2}$/.test(asked) && asked <= current && asked >= shiftMonthKey(current, -11) ? asked : current
  const barId = String(req.query?.bar_id || '').trim()

  try {
    if (barId) {
      const { data: bar, error } = await admin.from('bars').select('id,nome,cor').eq('id', barId).maybeSingle()
      if (error) return res.status(500).json({ error: error.message })
      if (!bar) return res.status(404).json({ error: 'Bar not found' })
      const [hq, extras] = await Promise.all([
        buildHqSnapshot(admin, bar.id, bar.nome, month, { lite: false }),
        barExtras(admin, bar.id),
      ])
      const wages = await wagesByMonth(admin, bar.id, current, extras.goals).catch(() => ({}))
      return res.status(200).json({ bar, month, hq, ...extras, wagesByMonth: wages })
    }

    const { data: bars, error } = await admin.from('bars').select('id,nome,cor').order('nome').limit(60)
    if (error) return res.status(500).json({ error: error.message })
    const rows = await Promise.all((bars || []).map(async bar => {
      try {
        const [hq, extras] = await Promise.all([
          buildHqSnapshot(admin, bar.id, bar.nome, month, { lite: true }),
          barExtras(admin, bar.id),
        ])
        return barListRow(bar, { hq, ...extras }, month)
      } catch (e) {
        return { id: bar.id, nome: bar.nome, cor: bar.cor || null, error: errText(e, 'Load failed') }
      }
    }))
    return res.status(200).json({ month, bars: rows })
  } catch (e) {
    return res.status(500).json({ error: errText(e, 'Bar finance failed') })
  }
}
