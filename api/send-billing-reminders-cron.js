/**
 * Cron: email overdue invoice reminders to bar portal clients.
 * Schedule: Mon/Wed/Fri 09:00 UTC (vercel.json)
 */
import { drinksAdminClient } from './_supabaseAdmin.js'
import { authorizeCron } from './_cronAuth.js'
import { emailConfigured } from './_email.js'
import { sendBillingReminders } from './_billingReport.js'

export default async function handler(req, res) {
  if (!authorizeCron(req, res)) return

  if (!emailConfigured()) {
    return res.status(200).json({
      ok: false,
      skipped: true,
      reason: 'RESEND_API_KEY or EMAIL_FROM not configured',
    })
  }

  try {
    const sb = drinksAdminClient()
    const portalUrl = process.env.PORTAL_URL || 'https://bebidas-control.vercel.app'
    const result = await sendBillingReminders(sb, { portalUrl })
    return res.status(200).json({
      ok: true,
      overdue: result.report.totalOverdue,
      amount: result.report.totalAmount,
      sent: result.sent,
      skipped: result.skipped,
    })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
