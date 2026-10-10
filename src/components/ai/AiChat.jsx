import { useEffect, useRef, useState } from 'react'
import { planAiActions } from '../../lib/aiAgent'
import { aiHistory, contextToScreen } from '../../lib/aiPanel'
import { useI18n } from '../../lib/i18n'
import AiActionCards from '../AiActionCards'
import Icon from '../ui/Icon'

/** Prompts offered per module. Keys under ai.suggest.<module> in the locale files. */
export const AI_SUGGEST_MODULES = ['overview', 'sales', 'stock', 'supply', 'finance', 'team', 'marketing', 'consulting', 'reports', 'crm', 'floor']

function newId() {
  return globalThis.crypto?.randomUUID?.() || `t-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function friendlyError(msg, t) {
  const m = String(msg || '')
  if (/GEMINI_API_KEY/i.test(m)) return t('ai.errNoKey')
  if (/sign in|session expired|401/i.test(m)) return t('ai.errSession')
  if (/cannot use AI/i.test(m)) return t('ai.errRole')
  return t('ai.errGeneric', { error: m.slice(0, 200) })
}

function Sources({ sources }) {
  const { t } = useI18n()
  if (!sources) return null
  return (
    <div className="ai-sources">
      <Icon name="info" size={14} />
      <span>
        {t('ai.sourcesLine', { from: sources.period?.from, to: sources.period?.to, scope: sources.scope })}
        {sources.limitations?.length > 0 && <> · <em>{sources.limitations.join(' · ')}</em></>}
      </span>
    </div>
  )
}

/**
 * The single chat used by the "Ask AI" panel and the AI Center.
 * ctx: { module, title, unit, period, filters, kpis, barId, days }
 */
export default function AiChat({ ctx = {}, thread, onThreadSaved, seed = '', onSeedUsed, autoFocus = false, compact = false }) {
  const { t } = useI18n()
  const [messages, setMessages] = useState(thread?.messages || [])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const idRef = useRef(thread?.id || newId())
  const serverIdRef = useRef(thread?.serverId || null)
  const logRef = useRef(null)
  const inputRef = useRef(null)
  const module = ctx.module || 'overview'

  useEffect(() => {
    setMessages(thread?.messages || [])
    idRef.current = thread?.id || newId()
    serverIdRef.current = thread?.serverId || null
    setErr('')
  }, [thread?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [messages, busy])

  useEffect(() => {
    if (seed) {
      setInput(seed)
      onSeedUsed?.()
      inputRef.current?.focus()
    }
  }, [seed]) // eslint-disable-line react-hooks/exhaustive-deps

  async function send(override) {
    const text = String(override ?? input).trim()
    if (!text || busy) return
    setInput('')
    setErr('')
    const userMsg = { role: 'user', content: text }
    const history = [...messages, userMsg]
    setMessages(history)
    setBusy(true)
    try {
      const out = await planAiActions({
        messages: history.map(m => ({ role: m.role, content: m.content })),
        screen: contextToScreen(ctx),
        analysis: { module, days: ctx.days || 30, barId: ctx.barId || null },
      })
      const answer = {
        role: 'assistant',
        content: String(out.reply || '').replace(/\*\*/g, '').trim() || t('ai.emptyReply'),
        proposals: out.proposals || [],
        sources: out.sources || null,
      }
      const next = [...history, answer]
      setMessages(next)
      try {
        const saved = await aiHistory.save({ id: idRef.current, serverId: serverIdRef.current, module, messages: next, barId: ctx.barId })
        serverIdRef.current = saved
        onThreadSaved?.(saved)
      } catch { /* history is a convenience; the answer is already on screen */ }
    } catch (e) {
      setErr(friendlyError(e.message, t))
      setMessages(history)
    } finally {
      setBusy(false)
    }
  }

  const suggestions = t(`ai.suggest.${AI_SUGGEST_MODULES.includes(module) ? module : 'overview'}`)

  return (
    <div className={`ai-chat${compact ? ' is-compact' : ''}`}>
      <div ref={logRef} className="ai-chat-log" aria-live="polite">
        {messages.length === 0 && (
          <div className="ai-chat-intro">
            <div className="ai-chat-intro-title"><Icon name="ai" size={18} /> {t('ai.introTitle')}</div>
            <p>{t('ai.introBody')}</p>
            <div className="ai-chat-suggest">
              {(Array.isArray(suggestions) ? suggestions : []).map(s => (
                <button key={s} type="button" className="ui-btn is-sm" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ai-msg is-${m.role}`}>
            {m.content && <div className="ai-msg-body">{m.content}</div>}
            {m.role === 'assistant' && <Sources sources={m.sources} />}
            {m.proposals?.length > 0 && <AiActionCards proposals={m.proposals} />}
          </div>
        ))}
        {busy && <div className="ai-msg is-assistant"><div className="ai-msg-body ai-typing">{t('ai.thinking')}</div></div>}
      </div>
      {err && <div className="ui-error ai-chat-err" role="alert"><Icon name="warning" /><div>{err}</div></div>}
      <form className="ai-chat-compose" onSubmit={e => { e.preventDefault(); send() }}>
        <textarea
          ref={inputRef}
          rows={compact ? 2 : 3}
          value={input}
          autoFocus={autoFocus}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder={t('ai.placeholder')}
          aria-label={t('ai.placeholder')}
        />
        <button type="submit" className="ui-btn is-primary" disabled={busy || !input.trim()} aria-label={t('ai.send')}>
          <Icon name="send" size={16} />
          {!compact && <span>{t('ai.send')}</span>}
        </button>
      </form>
      <div className="ai-chat-foot">{t('aiAct.hint')}</div>
    </div>
  )
}
