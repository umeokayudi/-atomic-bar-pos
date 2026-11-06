/**
 * Month close notification: on the 1st (Tokyo) each bar's owner gets last month's sales, tickets and best night.
 * Runs from the Vercel cron (vercel.json → /api/bar/push?action=cron). A marker file stops a second send.
 */
import { LIVE_BUCKET } from './_barLiveStore.js'
import { sendPushEvent } from './_push.js'
import { monthSummary } from '../src/lib/pushMonth.js'
import { tokyoDateKey } from '../src/lib/tokyo.js'

function prevMonth(todayKey) {
  const [y, m] = todayKey.split('-').map(Number)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate()
  const mm = String(pm).padStart(2, '0')
  return { key: `${py}-${mm}`, from: `${py}-${mm}-01`, to: `${py}-${mm}-${last}` }
}

export async function monthCloseAll(admin, { force = false } = {}) {
  const today = tokyoDateKey(new Date())
  if (!force && !today.endsWith('-01')) return { skipped: 'not the 1st', today }
  const month = prevMonth(today)
  const marker = `push/month-${month.key}.json`
  if (!force) {
    const { data } = await admin.storage.from(LIVE_BUCKET).download(marker).catch(() => ({ data: null }))
    if (data) return { skipped: 'already sent', month: month.key }
  }
  const { data: bars } = await admin.from('bars').select('id,nome').limit(200)
  const out = []
  for (const bar of bars || []) {
    // A sale rung after midnight on the 1st still belongs to the last night of the month: read one day more.
    const read = cols => admin.from('pos_vendas').select(cols)
      .eq('bar_id', bar.id).gte('data', month.from).lte('data', today).limit(20000)
    let { data: sales, error } = await read('total,refunded,data,criado_em,obs')
    if (error) ({ data: sales } = await read('total,data,criado_em,obs'))
    const sum = monthSummary(sales || [], month.key)
    if (!sum.tickets) { out.push({ bar: bar.id, skipped: 'no sales' }); continue }
    const r = await sendPushEvent(admin, {
      barId: bar.id,
      type: 'month_close',
      key: month.key,
      vars: { month: month.key, total: sum.total, tickets: sum.tickets, best: sum.bestNight ? `· ${sum.bestNight.slice(5).replace('-', '/')} ${'¥' + Math.round(sum.bestTotal).toLocaleString('en-US')}` : '' },
    })
    out.push({ bar: bar.id, ...r })
  }
  await admin.storage.from(LIVE_BUCKET).upload(marker, Buffer.from(JSON.stringify({ at: new Date().toISOString(), out })), {
    upsert: true, contentType: 'application/json', cacheControl: '0',
  }).catch(() => null)
  return { month: month.key, out }
}
