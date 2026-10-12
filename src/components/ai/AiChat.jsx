import { useEffect, useRef, useState } from 'react'
import { planAiActions } from '../../lib/aiAgent'
import { ATTACH_ACCEPT, ATTACH_MAX_FILES, readAttachment } from '../../lib/aiAttach'
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
function useNarrow() {
  const q = '(max-width: 640px)'
  const [on, setOn] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches)
  useEffect(() => {
    const m = window.matchMedia?.(q)
    if (!m) return undefined
    const f = () => setOn(m.matches)
    m.addEventListener?.('change', f)
    return () => m.removeEventListener?.('change', f)
  }, [])
  return on
}

export default function AiChat({ ctx = {}, thread, onThreadSaved, seed = '', seedSend = false, onSeedUsed, autoFocus = false, compact = false }) {
  const { t } = useI18n()
  const [messages, setMessages] = useState(thread?.messages || [])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [files, setFiles] = useState([])
  const [menu, setMenu] = useState(false)
  const [drag, setDrag] = useState(false)
  const pickers = { photo: useRef(null), file: useRef(null), video: useRef(null) }
  const idRef = useRef(thread?.id || newId())
  const serverIdRef = useRef(thread?.serverId || null)
  const logRef = useRef(null)
  const narrow = useNarrow()
  const inputRef = useRef(null)
  const module = ctx.module || 'overview'

  useEffect(() => {
    setMessages(thread?.messages || [])
    idRef.current = thread?.id || newId()
    serverIdRef.current = thread?.serverId || null
    setErr('')
  }, [thread?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const log = logRef.current
    if (!log) return
    // On phones the AI Center log flows with the page (no inner scroll box), so bring the newest message into view instead.
    if (log.scrollHeight > log.clientHeight + 1 && getComputedStyle(log).overflowY !== 'visible') log.scrollTop = log.scrollHeight
    else if (messages.length) log.lastElementChild?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [messages, busy])

  // The box grows with the text, up to a few lines, then scrolls inside.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  useEffect(() => {
    if (seed) {
      onSeedUsed?.()
      if (seedSend) { send(seed); return }
      setInput(seed)
      inputRef.current?.focus()
    }
  }, [seed]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addFiles(list) {
    setMenu(false)
    setErr('')
    const incoming = [...(list || [])].slice(0, Math.max(0, ATTACH_MAX_FILES - files.length))
    if (list?.length > incoming.length) setErr(t('ai.attachMaxFiles', { n: ATTACH_MAX_FILES }))
    for (const f of incoming) {
      try {
        const a = await readAttachment(f)
        setFiles(prev => [...prev, { ...a, id: newId() }])
      } catch (e) {
        setErr(t(String(e.message).startsWith('ai.') ? e.message : 'ai.attachFailed', { name: f.name }))
      }
    }
  }

  async function send(override) {
    const typed = String(override ?? input).trim()
    if ((!typed && !files.length) || busy) return
    const text = typed || t('ai.attachDefaultAsk')
    const sending = files
    setInput('')
    setFiles([])
    setErr('')
    const userMsg = { role: 'user', content: text, files: sending.map(f => ({ name: f.name, kind: f.kind, preview: f.preview })) }
    const history = [...messages, userMsg]
    setMessages(history)
    setBusy(true)
    try {
      const out = await planAiActions({
        messages: history.map(m => ({ role: m.role, content: m.content })),
        attachments: sending,
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
        const saved = await aiHistory.save({ id: idRef.current, serverId: serverIdRef.current, module, messages: next.map(({ files: f, ...m }) => (f ? { ...m, files: f.map(x => ({ name: x.name, kind: x.kind })) } : m)), barId: ctx.barId })
        serverIdRef.current = saved
        onThreadSaved?.(saved)
      } catch { /* history is a convenience; the answer is already on screen */ }
    } catch (e) {
      setErr(friendlyError(e.message, t))
      setMessages(history)
      setFiles(sending)
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
            {m.files?.length > 0 && (
              <div className="ai-msg-files">
                {m.files.map((f, j) => f.preview
                  ? <img key={j} src={f.preview} alt={f.name} className="ai-file-thumb" />
                  : <span key={j} className="ai-file-chip"><Icon name={f.kind === 'video' ? 'video' : 'fileDoc'} size={14} />{f.name}</span>)}
              </div>
            )}
            {m.content && <div className="ai-msg-body">{m.content}</div>}
            {m.role === 'assistant' && <Sources sources={m.sources} />}
            {m.proposals?.length > 0 && <AiActionCards proposals={m.proposals} />}
          </div>
        ))}
        {busy && <div className="ai-msg is-assistant"><div className="ai-msg-body ai-typing">{t('ai.thinking')}</div></div>}
      </div>
      {err && <div className="ui-error ai-chat-err" role="alert"><Icon name="warning" /><div>{err}</div></div>}
      {files.length > 0 && (
        <div className="ai-attach-list" aria-label={t('ai.attached')}>
          {files.map(f => (
            <span key={f.id} className="ai-file-chip is-pending">
              {f.preview ? <img src={f.preview} alt="" className="ai-file-mini" /> : <Icon name={f.kind === 'video' ? 'video' : 'fileDoc'} size={14} />}
              <span className="ai-file-name">{f.name}</span>
              <button type="button" className="ai-file-x" onClick={() => setFiles(prev => prev.filter(x => x.id !== f.id))} aria-label={t('ai.attachRemove', { name: f.name })}><Icon name="close" size={12} /></button>
            </span>
          ))}
        </div>
      )}
      <form
        className={`ai-chat-compose${drag ? ' is-drag' : ''}`}
        onSubmit={e => { e.preventDefault(); send() }}
        onDragOver={e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDrag(true) } }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer?.files) }}
      >
        <div className="ai-attach">
          <button type="button" className="ui-btn is-ghost is-icon" onClick={() => setMenu(v => !v)} aria-expanded={menu} aria-haspopup="menu" aria-label={t('ai.attach')} title={t('ai.attach')} disabled={busy}>
            <Icon name="attach" size={18} />
          </button>
          {menu && (
            <div className="ai-attach-menu" role="menu">
              {[['photo', 'image', 'ai.attachPhoto'], ['file', 'fileDoc', 'ai.attachFile'], ['video', 'video', 'ai.attachVideo']].map(([k, icon, label]) => (
                <button key={k} type="button" role="menuitem" onClick={() => pickers[k].current?.click()}>
                  <Icon name={icon} size={16} /> {t(label)}
                </button>
              ))}
            </div>
          )}
          {Object.entries(pickers).map(([k, ref]) => (
            <input key={k} ref={ref} type="file" hidden multiple={k !== 'video'} accept={ATTACH_ACCEPT[k]} onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
          ))}
        </div>
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          autoFocus={autoFocus}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          onPaste={e => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); addFiles(f) } }}
          placeholder={t(narrow ? 'ai.placeholderShort' : 'ai.placeholder')}
          aria-label={t('ai.placeholder')}
        />
        <button type="submit" className="ui-btn is-primary ai-send" disabled={busy || (!input.trim() && !files.length)} aria-label={t('ai.send')}>
          <Icon name="send" size={16} />
          {!compact && !narrow && <span>{t('ai.send')}</span>}
        </button>
      </form>
      <div className="ai-chat-foot">{t('aiAct.hint')}</div>
    </div>
  )
}
