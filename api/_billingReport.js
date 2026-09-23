import { buildLiveSnapshot } from './_cashflowSnapshot.js'
import { sendEmail } from './_email.js'

const BUCKET = 'system-private'
const LOG_FILE = 'billing_email_log.json'
const REMINDER_COOLDOWN_DAYS = 7

export function fmtYen(n) {
  return '¥' + Math.round(+n || 0).toLocaleString('ja-JP')
}

function faturaRemaining(f) {
  return Math.max(0, (+f.valor || +f.total || 0) - (+f.pago || 0))
}

/** Overdue client invoices grouped by bar with portal emails. */
export async function buildOverdueBillingReport(sb) {
  const today = new Date().toISOString().slice(0, 10)

  const [faturasR, barsR, perfisR] = await Promise.all([
    sb.from('faturas')
      .select('id,bar_id,valor,total,pago,status,data_vencimento,periodo_inicio,periodo_fim,data_emissao')
      .neq('status', 'pago')
      .lt('data_vencimento', today)
      .order('data_vencimento', { ascending: true }),
    sb.from('bars').select('id,nome'),
    sb.from('perfis').select('id,nome,email,bar_id,role').eq('role', 'cliente'),
  ])

  const bars = Object.fromEntries((barsR.data || []).map(b => [b.id, b]))
  const emailsByBar = {}
  for (const p of perfisR.data || []) {
    if (!p.bar_id || !p.email) continue
    if (!emailsByBar[p.bar_id]) emailsByBar[p.bar_id] = []
    emailsByBar[p.bar_id].push({ email: p.email, nome: p.nome || p.email })
  }

  const overdue = (faturasR.data || []).filter(f => faturaRemaining(f) > 0)
  const byBar = {}

  for (const f of overdue) {
    const remaining = faturaRemaining(f)
    const bar = bars[f.bar_id]
    if (!byBar[f.bar_id]) {
      byBar[f.bar_id] = {
        barId: f.bar_id,
        barName: bar?.nome || 'Bar',
        contacts: emailsByBar[f.bar_id] || [],
        faturas: [],
        totalDue: 0,
      }
    }
    byBar[f.bar_id].faturas.push({
      id: f.id,
      due: f.data_vencimento,
      remaining,
      period: f.periodo_inicio && f.periodo_fim ? `${f.periodo_inicio} → ${f.periodo_fim}` : null,
    })
    byBar[f.bar_id].totalDue += remaining
  }

  return {
    today,
    bars: Object.values(byBar),
    totalOverdue: overdue.length,
    totalAmount: overdue.reduce((a, f) => a + faturaRemaining(f), 0),
  }
}

async function loadEmailLog(sb) {
  try {
    const { data } = await sb.storage.from(BUCKET).download(LOG_FILE)
    if (data) return JSON.parse(await data.text())
  } catch { /* */ }
  return { reminders: {} }
}

async function saveEmailLog(sb, log) {
  const { data: buckets } = await sb.storage.listBuckets()
  if (!buckets?.some(b => b.name === BUCKET)) {
    await sb.storage.createBucket(BUCKET, { public: false })
  }
  await sb.storage.from(BUCKET).upload(LOG_FILE, JSON.stringify(log, null, 2), {
    upsert: true,
    contentType: 'application/json',
  })
}

function recentlySent(log, faturaId) {
  const last = log.reminders?.[faturaId]
  if (!last) return false
  const days = (Date.now() - new Date(last).getTime()) / 86400000
  return days < REMINDER_COOLDOWN_DAYS
}

export function buildBillingReminderHtml({ contactName, barName, faturas, portalUrl }) {
  const rows = faturas.map(f => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">${f.period || '—'}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${f.due}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${fmtYen(f.remaining)}</td>
    </tr>
  `).join('')

  const total = faturas.reduce((a, f) => a + f.remaining, 0)

  return `
    <div style="font-family:sans-serif;max-width:560px;color:#1a1a1a">
      <h2 style="color:#1A4E8A">JBM Drinks — Payment reminder / お支払いのお願い</h2>
      <p>Hello ${contactName},</p>
      <p>You have overdue invoice(s) for <strong>${barName}</strong>.</p>
      <p>${barName} のJBM Drinks請求が期限を過ぎています。</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
        <thead>
          <tr style="background:#EAF0FA">
            <th style="padding:8px;text-align:left">Period</th>
            <th style="padding:8px;text-align:left">Due</th>
            <th style="padding:8px;text-align:right">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="font-size:18px;font-weight:800;color:#C0392B">Total due: ${fmtYen(total)}</p>
      <p>Submit payment proof in the client portal:<br/>
        <a href="${portalUrl}">${portalUrl}</a>
      </p>
      <p style="font-size:12px;color:#666">JBM Drinks · bebidas-control</p>
    </div>
  `
}

/** Send overdue reminders; skips faturas emailed within cooldown window. */
export async function sendBillingReminders(sb, { portalUrl = 'https://bebidas-control.vercel.app' } = {}) {
  const report = await buildOverdueBillingReport(sb)
  const log = await loadEmailLog(sb)
  const sent = []
  const skipped = []

  for (const bar of report.bars) {
    if (!bar.contacts.length) {
      skipped.push({ barId: bar.barId, reason: 'no_email' })
      continue
    }

    const faturasToSend = bar.faturas.filter(f => !recentlySent(log, f.id))
    if (!faturasToSend.length) {
      skipped.push({ barId: bar.barId, reason: 'cooldown' })
      continue
    }

    const uniqueEmails = [...new Set(bar.contacts.map(c => c.email))]
    for (const email of uniqueEmails) {
      const contact = bar.contacts.find(c => c.email === email)
      await sendEmail({
        to: email,
        subject: `JBM Drinks — Overdue invoice reminder (${bar.barName})`,
        html: buildBillingReminderHtml({
          contactName: contact?.nome || email,
          barName: bar.barName,
          faturas: faturasToSend,
          portalUrl,
        }),
      })
    }

    const now = new Date().toISOString()
    for (const f of faturasToSend) {
      log.reminders[f.id] = now
    }
    sent.push({ barId: bar.barId, barName: bar.barName, emails: uniqueEmails, faturas: faturasToSend.length })
  }

  await saveEmailLog(sb, log)
  return { report, sent, skipped }
}

export function buildDailyReportHtml(snapshot, { date }) {
  const f = snapshot.financeiro || {}
  return `
    <div style="font-family:sans-serif;max-width:560px">
      <h2 style="color:#1A4E8A">JBM Drinks — Daily report</h2>
      <p>Date: ${date}</p>
      <table style="width:100%;font-size:14px;border-collapse:collapse">
        <tr><td style="padding:6px 0">Monthly revenue</td><td style="text-align:right;font-weight:700">${fmtYen(f.receitaMes)}</td></tr>
        <tr><td style="padding:6px 0">Monthly cost</td><td style="text-align:right">${fmtYen(f.custoMes)}</td></tr>
        <tr><td style="padding:6px 0">Monthly profit</td><td style="text-align:right;color:${f.lucroMes >= 0 ? '#1A7A5E' : '#C0392B'}">${fmtYen(f.lucroMes)}</td></tr>
        <tr><td style="padding:6px 0">Receivable (open invoices)</td><td style="text-align:right">${fmtYen(f.aReceber)}</td></tr>
        <tr><td style="padding:6px 0">Payable</td><td style="text-align:right">${fmtYen(f.aPagar)}</td></tr>
        <tr><td style="padding:6px 0">Overdue payables</td><td style="text-align:right;color:#C0392B">${fmtYen(f.aPagarAtrasado)}</td></tr>
        <tr><td style="padding:6px 0">Overdue invoices (count)</td><td style="text-align:right">${f.faturasVencidas || 0}</td></tr>
        <tr><td style="padding:6px 0">30-day projection</td><td style="text-align:right">${fmtYen(f.projetado30d)}</td></tr>
      </table>
      <p style="font-size:12px;color:#666;margin-top:20px">Generated ${snapshot.geradoEm || new Date().toISOString()}</p>
    </div>
  `
}

export async function sendDailyReport(sb, recipients) {
  const snapshot = await buildLiveSnapshot(sb)
  const date = new Date().toISOString().slice(0, 10)
  const html = buildDailyReportHtml(snapshot, { date })

  await sendEmail({
    to: recipients,
    subject: `JBM Drinks daily report — ${date}`,
    html,
  })

  return { date, financeiro: snapshot.financeiro, recipients }
}
