/**
 * /api/chat module "agent": plan (model proposes, nothing is written) and
 * execute (user pressed Confirm). Needs the user's Supabase session token;
 * trusted-origin and lane tokens are not accepted here.
 */
import { randomUUID } from 'crypto'
import { geminiGenerate } from './_gemini.js'
import { bearerToken } from './_requireStaff.js'
import { createStaffUserClient, drinksAuthClient } from './_supabaseAdmin.js'
import {
  agentSystemPrompt,
  executeAction,
  loadActionContext,
  normalizeAction,
  parseAgentJson,
  publicProposal,
  scopeForRole,
} from './_aiActions.js'
import { AI_MODULES, analysisPrompt, loadAnalysisPack } from './_aiData.js'

const MISSING_TABLE = new Set(['42P01', 'PGRST205'])

async function resolveActor(req) {
  const token = bearerToken(req)
  if (!token) return { error: 'Sign in to use AI actions', status: 401 }
  const { data: { user }, error } = await drinksAuthClient().auth.getUser(token)
  if (error || !user) return { error: 'Session expired. Sign in again.', status: 401 }
  const db = createStaffUserClient(token)
  const { data: perfil } = await db.from('perfis').select('role, bar_id').eq('id', user.id).single()
  const scope = scopeForRole(perfil)
  if (!scope) return { error: 'Your account cannot use AI actions', status: 403 }
  return { user, perfil, scope, db }
}

/** What the chat may attach. Gemini reads images, PDFs, audio and short videos inline; text files go in as text. */
export const ATTACH_MAX_FILES = 4
export const ATTACH_MAX_BASE64 = 3_400_000 // Vercel's request limit is 4.5 MB; base64 adds a third.
const INLINE_MIME = /^(image\/(png|jpe?g|webp|heic|heif|gif)|application\/pdf|video\/(mp4|quicktime|webm|mpeg|3gpp|x-msvideo)|audio\/(mpeg|mp3|wav|x-wav|aac|ogg|webm|mp4|x-m4a))$/i
const TEXT_MIME = /^(text\/(plain|csv|markdown|tab-separated-values)|application\/json)$/i

/** Validate attachments; returns { parts, error }. Text files become text parts, the rest inlineData. */
export function attachmentParts(list) {
  const items = (Array.isArray(list) ? list : []).filter(a => a && typeof a.data === 'string' && a.data)
  if (items.length > ATTACH_MAX_FILES) return { error: `Attach at most ${ATTACH_MAX_FILES} files at a time` }
  const total = items.reduce((n, a) => n + a.data.length, 0)
  if (total > ATTACH_MAX_BASE64) return { error: 'Attachments are too large (about 2.5 MB in total). Send a shorter video or a smaller file.' }
  const parts = []
  for (const a of items) {
    const mimeType = String(a.mimeType || '').toLowerCase()
    const name = String(a.name || 'file').slice(0, 80)
    if (TEXT_MIME.test(mimeType)) {
      const text = Buffer.from(a.data, 'base64').toString('utf8').slice(0, 20000)
      parts.push({ text: `Attached file "${name}":\n${text}` })
    } else if (INLINE_MIME.test(mimeType)) {
      parts.push({ inlineData: { mimeType, data: a.data } })
    } else {
      return { error: `"${name}" is not supported. Use a photo, PDF, CSV, text file or a short video.` }
    }
  }
  return { parts }
}

function toContents(messages, image, attachments = []) {
  const list = (messages || [])
    .filter(m => m?.content)
    .slice(-12)
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content).slice(0, 4000) }] }))
  const last = list.length && list[list.length - 1].role === 'user' ? list[list.length - 1] : null
  if (last && image?.data) last.parts.unshift({ inlineData: { mimeType: image.mimeType || 'image/jpeg', data: image.data } })
  if (last && attachments.length) last.parts.unshift(...attachments)
  return list
}

async function plan(res, actor, body) {
  const ctx = await loadActionContext(actor.db, { scope: actor.scope, barId: actor.perfil.bar_id, userId: actor.user.id })
  const attached = attachmentParts(body.attachments)
  if (attached.error) return res.status(400).json({ error: attached.error })
  const contents = toContents(body.messages, body.image, attached.parts)
  if (!contents.length) return res.status(400).json({ error: 'messages is required' })

  // Page context ("Ask AI" panel / AI Center): load the facts for that module with the user's own rights.
  // Bar managers are always pinned to their own bar; HQ may narrow to one bar.
  let analysis = ''
  let sources = null
  if (body.analysis && typeof body.analysis === 'object') {
    const module = AI_MODULES.includes(body.analysis.module) ? body.analysis.module : 'overview'
    const barId = actor.scope === 'hq'
      ? (/^[0-9a-f-]{36}$/i.test(body.analysis.barId || '') ? body.analysis.barId : null)
      : actor.perfil.bar_id
    const pack = await loadAnalysisPack(actor.db, { module, days: body.analysis.days, barId })
    analysis = analysisPrompt(pack)
    sources = { period: pack.period, scope: pack.scope, modules: Object.keys(pack.facts), limitations: pack.limitations }
  }
  const screen = [String(body.screen || '').slice(0, 4000), analysis].filter(Boolean).join('\n\n')

  const data = await geminiGenerate({
    systemInstruction: { parts: [{ text: agentSystemPrompt(ctx, screen) }] },
    contents,
    generationConfig: { temperature: 0.2, maxOutputTokens: body.analysis ? 3000 : 1500, responseMimeType: 'application/json' },
  })
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || ''
  const out = parseAgentJson(text)
  const proposals = out.actions.map(a => publicProposal(normalizeAction(ctx, a), randomUUID()))
  return res.status(200).json({ reply: out.reply, proposals, sources })
}

async function logStart(db, row) {
  const { error } = await db.from('ai_action_log').insert(row)
  if (!error) return { logged: true }
  if (MISSING_TABLE.has(error.code)) return { logged: false }
  if (error.code === '23505') return { duplicate: true }
  return { logged: false }
}

async function execute(res, actor, body) {
  const proposal = body.proposal || {}
  const ctx = await loadActionContext(actor.db, { scope: actor.scope, barId: actor.perfil.bar_id, userId: actor.user.id })
  // Re-check against fresh data: the invoice may be paid or the order confirmed since the preview.
  const n = normalizeAction(ctx, { type: proposal.type, params: proposal.params })
  if (!n.ok) return res.status(409).json({ error: n.error })
  n.key = /^[0-9a-f-]{36}$/i.test(proposal.key || '') ? proposal.key : randomUUID()

  const log = await logStart(actor.db, {
    idempotency_key: n.key,
    user_id: actor.user.id,
    role: actor.perfil.role,
    bar_id: actor.perfil.bar_id || null,
    action: n.type,
    params: n.params,
    status: 'running',
  })
  if (log.duplicate) return res.status(409).json({ error: 'This action was already confirmed' })

  try {
    const result = await executeAction(actor.db, ctx, n)
    if (log.logged) {
      await actor.db.from('ai_action_log').update({ status: 'done', result }).eq('idempotency_key', n.key)
    }
    return res.status(200).json({ ok: true, ...result })
  } catch (e) {
    if (log.logged) {
      await actor.db.from('ai_action_log').update({ status: 'failed', result: { error: e.message } }).eq('idempotency_key', n.key)
    }
    return res.status(500).json({ error: e.message || 'Write failed' })
  }
}

export async function handleAgentRequest(req, res, body) {
  const actor = await resolveActor(req)
  if (actor.error) return res.status(actor.status).json({ error: actor.error })
  if (body.step === 'execute') return execute(res, actor, body)
  return plan(res, actor, body)
}
