/**
 * Cron: daily financial summary email to admin recipients.
 * Schedule: daily 06:00 UTC (vercel.json)
 */
import { drinksAdminClient } from './_supabaseAdmin.js'
import { authorizeCron } from './_cronAuth.js'
import { emailConfigured, parseRecipients } from './_email.js'
import { sendDailyReport } from './_billingReport.js'

export default async function handler(req, res) {
  if (!authorizeCron(req, res)) return

  if (!emailConfigured()) {
    return res.status(200).json({
      ok: false,
      skipped: true,
      reason: 'RESEND_API_KEY or EMAIL_FROM not configured',
    })
  }

  const recipients = parseRecipients(process.env.REPORT_EMAIL_RECIPIENTS)
  if (!recipients.length) {
    return res.status(200).json({
      ok: false,
      skipped: true,
      reason: 'REPORT_EMAIL_RECIPIENTS not configured',
    })
  }

  try {
    const sb = drinksAdminClient()
    const result = await sendDailyReport(sb, recipients)
    return res.status(200).json({ ok: true, ...result })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
