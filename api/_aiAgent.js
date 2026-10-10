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

function toContents(messages, image) {
  const list = (messages || [])
    .filter(m => m?.content)
    .slice(-12)
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content).slice(0, 4000) }] }))
  if (image?.data && list.length && list[list.length - 1].role === 'user') {
    list[list.length - 1].parts.unshift({ inlineData: { mimeType: image.mimeType || 'image/jpeg', data: image.data } })
  }
  return list
}

async function plan(res, actor, body) {
  const ctx = await loadActionContext(actor.db, { scope: actor.scope, barId: actor.perfil.bar_id, userId: actor.user.id })
  const contents = toContents(body.messages, body.image)
  if (!contents.length) return res.status(400).json({ error: 'messages is required' })

  const data = await geminiGenerate({
    systemInstruction: { parts: [{ text: agentSystemPrompt(ctx, String(body.screen || '').slice(0, 4000)) }] },
    contents,
    generationConfig: { temperature: 0.2, maxOutputTokens: 1500, responseMimeType: 'application/json' },
  })
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || ''
  const out = parseAgentJson(text)
  const proposals = out.actions.map(a => publicProposal(normalizeAction(ctx, a), randomUUID()))
  return res.status(200).json({ reply: out.reply, proposals })
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
