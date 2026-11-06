/**
 * /api/bar/push — push notifications on the owner's phone.
 *  GET  ?action=key              public key the phone subscribes with
 *  GET  ?action=icon&bar=<id>    the bar's logo (or a disc in its colour) shown in the notification
 *  GET  ?action=cron             month close summary (Vercel cron, 1st of the month; CRON_SECRET)
 *  POST { action: 'subscribe' | 'unsubscribe' | 'mine' | 'test' | 'event' | 'style' | 'saveStyle' | 'ai' }
 */
import { tryDrinksAdminClient } from './_supabaseAdmin.js'
import { resolveBarActor } from './_barLaneAuth.js'
import { authorizeCron } from './_cronAuth.js'
import {
  barIcon, findSubscription, loadBarLook, loadStyle, removeSubscription, saveStyle, saveSubscription, sendPushEvent, vapidKeys,
} from './_push.js'
import { DEFAULT_TEXTS, PUSH_TYPE_IDS, SAMPLE_VARS, TEXT_MAX, cleanStyle, typeOf } from '../src/lib/pushTemplates.js'

const OWNER_ROLES = new Set(['cliente', 'gerente', 'admin', 'staff'])
// Events the app itself reports (the clock is sent by /api/time-clock on the server).
const APP_EVENTS = new Set(['order', 'shift_close', 'day_close', 'sale', 'invoice_new', 'payment'])

function bodyOf(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
}

const isHq = actor => actor?.perfil?.role === 'admin' || actor?.perfil?.role === 'staff'

/** The bar an owner/manager edits or reports for: their own; JBM admins name it. */
function barFor(actor, body) {
  if (isHq(actor)) return body.bar_id ? String(body.bar_id) : null
  return actor.perfil?.bar_id || null
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()
  const admin = tryDrinksAdminClient()
  if (!admin) return res.status(503).json({ error: 'Push needs the server key (SUPABASE_SERVICE_ROLE_KEY) on this deploy' })
  const q = req.query || {}

  try {
    if (req.method === 'GET') {
      if (q.action === 'key') {
        const keys = await vapidKeys(admin)
        return res.status(200).json({ publicKey: keys.publicKey })
      }
      if (q.action === 'icon') {
        const icon = await barIcon(admin, String(q.bar || '') || null)
        res.setHeader('Cache-Control', 'public, max-age=86400')
        if (icon.redirect) return res.redirect(302, icon.redirect)
        res.setHeader('Content-Type', icon.type)
        return res.status(200).send(icon.body)
      }
      const fromCron = /vercel-cron/i.test(String(req.headers['user-agent'] || '')) || req.headers['x-vercel-cron'] === '1'
      if (q.action === 'cron' || (!q.action && fromCron)) {
        if (!authorizeCron(req, res)) return
        const { monthCloseAll } = await import('./_pushMonth.js')
        return res.status(200).json(await monthCloseAll(admin, { force: q.force === '1' }))
      }
      return res.status(400).json({ error: 'Unknown action' })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use GET or POST' })

    const body = bodyOf(req)
    const actor = await resolveBarActor(req, admin)
    if (actor.error) return res.status(actor.status).json({ error: actor.error })
    if (actor.disabled && actor.perfil?.role !== 'cliente') return res.status(403).json({ error: 'This login is turned off' })
    const role = actor.perfil?.role
    const action = String(body.action || '')

    if (action === 'subscribe') {
      if (!OWNER_ROLES.has(role)) return res.status(403).json({ error: 'Only the owner or a manager gets notifications' })
      const row = await saveSubscription(admin, actor, body)
      return res.status(200).json({ ok: true, sub: row })
    }
    if (action === 'unsubscribe') {
      const n = await removeSubscription(admin, String(body.endpoint || ''))
      return res.status(200).json({ ok: true, removed: n })
    }
    if (action === 'mine') {
      return res.status(200).json({ sub: await findSubscription(admin, String(body.endpoint || '')) })
    }
    if (action === 'test') {
      const type = typeOf(body.type) ? body.type : 'sale'
      const barId = barFor(actor, body) || actor.perfil?.bar_id || null
      const r = await sendPushEvent(admin, {
        barId, type, vars: SAMPLE_VARS[type], onlyEndpoint: String(body.endpoint || ''),
        styleOverride: body.style ? cleanStyle(body.style) : null,
      })
      return res.status(200).json(r)
    }
    if (action === 'event') {
      const type = String(body.type || '')
      if (!APP_EVENTS.has(type)) return res.status(400).json({ error: 'Unknown event' })
      // Invoices to a bar come from JBM (HQ names the bar); everything else is the actor's own bar.
      const barId = isHq(actor) ? (body.bar_id ? String(body.bar_id) : null) : actor.perfil?.bar_id
      if (!barId && !isHq(actor)) return res.status(403).json({ error: 'No bar' })
      if (type === 'invoice_new' && !isHq(actor)) return res.status(403).json({ error: 'Only JBM issues invoices' })
      const vars = { ...(body.vars || {}) }
      if (!vars.who && actor.perfil?.nome) vars.who = actor.perfil.nome
      const r = await sendPushEvent(admin, { barId, type, vars, key: body.key ? String(body.key).slice(0, 80) : '' })
      return res.status(200).json(r)
    }
    if (action === 'style') {
      const barId = barFor(actor, body)
      const look = await loadBarLook(admin, barId)
      return res.status(200).json({ style: await loadStyle(admin, barId), look: { name: look.name, color: look.color }, defaults: DEFAULT_TEXTS, types: PUSH_TYPE_IDS })
    }
    if (action === 'saveStyle') {
      if (role !== 'cliente' && !isHq(actor)) return res.status(403).json({ error: 'Only the owner changes the message style' })
      const style = await saveStyle(admin, barFor(actor, body), body.style)
      return res.status(200).json({ ok: true, style })
    }
    if (action === 'ai') {
      if (!OWNER_ROLES.has(role)) return res.status(403).json({ error: 'No permission' })
      return res.status(200).json({ text: await aiText(body) })
    }
    return res.status(400).json({ error: 'Unknown action' })
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message })
  }
}

/** The AI writes one notification text for a kind, in the owner's words and tone, keeping the {placeholders}. */
async function aiText(body) {
  const t = typeOf(body.type)
  if (!t) throw Object.assign(new Error('Unknown kind'), { status: 400 })
  const { geminiGenerate } = await import('./_gemini.js')
  const lang = body.lang === 'ja' ? 'Japanese' : 'English'
  const tone = { party: 'cheerful, warm, with one or two emoji', neutral: 'clear and professional, no emoji', short: 'very short, a few words' }[body.tone] || 'cheerful'
  const wish = String(body.hint || '').slice(0, 300)
  const current = String(body.current || '').slice(0, TEXT_MAX)
  const prompt = [
    `Write ONE push notification text (max 120 characters) for a bar owner's phone.`,
    `Event: ${t.id.replace('_', ' ')}. Language: ${lang}. Tone: ${tone}.`,
    `Use these placeholders exactly as written where they fit: ${t.vars.map(v => `{${v}}`).join(' ')}.`,
    t.money ? 'It is about money; a "congratulations" line is added in front automatically, so do not add one.' : '',
    current ? `Current text: ${current}` : '',
    wish ? `The owner asks: ${wish}` : '',
    'Answer with the text only, no quotes, no explanation.',
  ].filter(Boolean).join('\n')
  const data = await geminiGenerate({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 200 },
  })
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || ''
  return text.replace(/^["'「]+|["'」]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX)
}
