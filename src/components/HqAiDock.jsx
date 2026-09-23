import { useEffect, useRef, useState } from 'react'
import { callGeminiChat } from '../lib/ai'
import { buildHqChatSystem, localHqAnswer } from '../lib/hqSnapshot'
import { useI18n } from '../lib/i18n'

export default function HqAiDock({ snapshot, compact = false, strip = false }) {
  const { t } = useI18n()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [via, setVia] = useState('local')
  const listRef = useRef(null)

  useEffect(() => {
    setMessages([{ role: 'assistant', content: t('portal.hq.aiHello') }])
    setVia('local')
  }, [snapshot?.mes, t])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages])

  async function send(override) {
    const text = (override || input).trim()
    if (!text || busy) return
    setInput('')
    const userMsg = { role: 'user', content: text }
    const local = localHqAnswer(text, snapshot)
    setMessages(m => [...m, userMsg, { role: 'assistant', content: local }])
    setVia('local')
    setBusy(true)
    try {
      const api = await Promise.race([
        callGeminiChat({
          messages: [userMsg],
          system: buildHqChatSystem(snapshot),
          temperature: 0.3,
          maxOutputTokens: 700,
        }),
        new Promise(resolve => setTimeout(() => resolve(null), 4000)),
      ])
      if (api && !/^Error:/i.test(api) && api !== 'No response') {
        setVia('api')
        setMessages(m => {
          const next = [...m]
          next[next.length - 1] = { role: 'assistant', content: String(api).replace(/\*\*/g, '') }
          return next
        })
      }
    } catch {
      // Slot stays on local books until /api/chat is plugged in.
    }
    setBusy(false)
  }

  const chips = [
    t('portal.hq.aiChipPos'),
    t('portal.hq.aiChipJbm'),
    t('portal.hq.aiChipHours'),
    t('portal.hq.aiChipRent'),
  ]

  return (
    <aside className={`hq-ai-dock${compact ? ' is-compact' : ''}${strip ? ' is-strip' : ''}`} aria-label={t('portal.hq.aiSlot')}>
      <div className="hq-ai-head">
        <div>
          <div className="hq-ai-title">{t('portal.hq.aiSlot')}</div>
          <div className="hq-ai-hint">{t('portal.hq.aiSlotHint')}</div>
        </div>
        <span className={`hq-ai-via hq-ai-via-${via}`}>
          {via === 'api' ? t('portal.hq.aiViaApi') : t('portal.hq.apiReady')}
        </span>
      </div>
      <div className="hq-ai-chips">
        {chips.map(c => (
          <button key={c} type="button" className="hq-chip" onClick={() => send(c)}>{c}</button>
        ))}
      </div>
      {!strip && (
        <div ref={listRef} className="hq-ai-log">
          {messages.map((m, i) => (
            <div key={i} className={`hq-ai-bubble hq-ai-${m.role}`}>{m.content}</div>
          ))}
          {busy && <div className="hq-ai-bubble hq-ai-assistant">{t('portal.aiThinking')}</div>}
        </div>
      )}
      {strip && (
        <div className="hq-ai-strip-line">{messages[messages.length - 1]?.content || t('portal.hq.aiHello')}</div>
      )}
      <div className="hq-ai-compose">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder={t('portal.hq.aiPlaceholder')}
        />
        <button type="button" className="btn-primary" disabled={busy || !input.trim()} onClick={() => send()}>
          {t('portal.send')}
        </button>
      </div>
    </aside>
  )
}
