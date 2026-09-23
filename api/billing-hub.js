/**
 * Admin billing hub — overdue summary + email automation status/triggers.
 */
import { drinksAdminClient } from './_supabaseAdmin.js'
import { requireStaff } from './_requireStaff.js'
import { buildOverdueBillingReport, sendBillingReminders, sendDailyReport } from './_billingReport.js'
import { buildLiveSnapshot } from './_cashflowSnapshot.js'
import { emailConfigured, parseRecipients } from './_email.js'

export default async function handler(req, res) {
  const auth = await requireStaff(req, null, { roles: ['admin', 'staff'] })
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const sb = drinksAdminClient()

  if (req.method === 'GET') {
    try {
      const [overdue, snapshot, recipients] = await Promise.all([
        buildOverdueBillingReport(sb),
        buildLiveSnapshot(sb),
        Promise.resolve(parseRecipients(process.env.REPORT_EMAIL_RECIPIENTS)),
      ])
      return res.status(200).json({
        email: {
          configured: emailConfigured(),
          reportRecipients: recipients.length,
          schedules: {
            report: 'Daily 06:00 UTC',
            billing: 'Mon/Wed/Fri 09:00 UTC',
          },
        },
        financeiro: snapshot.financeiro,
        overdue,
        geradoEm: new Date().toISOString(),
      })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  if (req.method === 'POST') {
    if (auth.perfil?.role !== 'admin' && auth.perfil?.role !== 'service') {
      return res.status(403).json({ error: 'Admin only' })
    }
    if (!emailConfigured()) {
      return res.status(400).json({ error: 'RESEND_API_KEY and EMAIL_FROM not configured' })
    }

    const action = req.body?.action
    try {
      if (action === 'report') {
        const recipients = parseRecipients(process.env.REPORT_EMAIL_RECIPIENTS)
        if (!recipients.length) {
          return res.status(400).json({ error: 'REPORT_EMAIL_RECIPIENTS not configured' })
        }
        const result = await sendDailyReport(sb, recipients)
        return res.status(200).json({ ok: true, action, ...result })
      }
      if (action === 'billing') {
        const portalUrl = process.env.PORTAL_URL || 'https://bebidas-control.vercel.app'
        const result = await sendBillingReminders(sb, { portalUrl })
        return res.status(200).json({ ok: true, action, sent: result.sent, skipped: result.skipped })
      }
      return res.status(400).json({ error: 'Invalid action — use report or billing' })
    } catch (e) {
      return res.status(500).json({ error: e.message })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
