import { useEffect, useRef, useState } from 'react'
import {
  CHAT_STORAGE_KEY,
  SUGGESTED_QUESTIONS,
  composerAction,
  conversationTitle,
  createConversation,
  loadChatStore,
  saveChatStore,
} from '../lib/aiAssistant'
import { composeSampleAnswer, formatSampleYen } from '../lib/aiSampleStudio'
import { composeDemoAnswer } from '../lib/demoLedger'
import { demoTurn } from '../lib/aiAssistant'

function browserStorage() {
  try { return window.sessionStorage } catch { return null }
}

function messageId() {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export default function AiAssistantWorkspace({ demo = false }) {
  const [store, setStore] = useState(() => loadChatStore(browserStorage()))
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [provider, setProvider] = useState(null)
  const [statusError, setStatusError] = useState('')
  const logRef = useRef(null)
  const active = store.conversations.find(item => item.id === store.activeId) || store.conversations[0]

  useEffect(() => {
    saveChatStore(browserStorage(), store)
  }, [store])

  useEffect(() => {
    let cancelled = false
    fetch('/api/ai-assistant')
      .then(async res => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || 'Assistant status could not be read.')
        if (!cancelled) setProvider(body)
      })
      .catch(error => {
        if (!cancelled) setStatusError(error.message || 'Assistant status could not be read.')
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const log = logRef.current
    if (!log) return
    const last = log.querySelector('article:last-of-type')
    if (!last) return
    log.scrollTop = Math.max(0, last.offsetTop - 8)
  }, [active?.messages, sending])

  function newConversation() {
    const conversation = createConversation()
    setStore(current => ({
      activeId: conversation.id,
      conversations: [conversation, ...current.conversations].slice(0, 12),
    }))
    setDraft('')
  }

  function selectConversation(id) {
    setStore(current => ({ ...current, activeId: id }))
  }

  function updateConversation(id, updater) {
    setStore(current => ({
      ...current,
      conversations: current.conversations.map(item => (
        item.id === id ? updater(item) : item
      )),
    }))
  }

  async function send(text) {
    const content = String(text ?? draft).trim()
    if (!content || sending || !active) return
    const conversationId = active.id
    const userMessage = { id: messageId(), role: 'user', content }
    const history = [...active.messages, userMessage]
    updateConversation(conversationId, item => ({
      ...item,
      title: conversationTitle(history),
      updatedAt: new Date().toISOString(),
      messages: history,
    }))
    setDraft('')
    setSending(true)
    try {
      if (demo) {
        const body = demoTurn(content)
        const reply = {
          id: messageId(),
          role: 'notice',
          fromModel: false,
          content: body.text,
          detail: body.detail || '',
          followups: body.followups || [],
          sources: body.sources || [],
          draft: body.draft || null,
          kpis: body.kpis || [],
          table: body.table || null,
          chart: body.chart || null,
          bars: body.bars || null,
          comparison: body.comparison || null,
          evidence: body.evidence || [],
          illustrative: true,
          live: false,
          state: 'demo',
        }
        updateConversation(conversationId, item => ({
          ...item,
          updatedAt: new Date().toISOString(),
          messages: [...item.messages, reply].slice(-40),
        }))
        setSending(false)
        return
      }
      const res = await fetch('/api/ai-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          demo,
          messages: history
            .filter(message => message.role === 'user' || (message.role === 'assistant' && message.fromModel))
            .map(message => ({ role: message.role, content: message.content })),
        }),
      })
      let body = {}
      try { body = await res.json() } catch { body = { state: 'error', text: 'The assistant returned an unreadable response.' } }
      if (!res.ok && !body.text) body = { state: 'error', text: body.error || 'The assistant could not answer.' }
      const reply = {
        id: messageId(),
        role: body.fromModel ? 'assistant' : 'notice',
        fromModel: Boolean(body.fromModel),
        content: body.text || 'The assistant did not return a response.',
        detail: body.detail || '',
        followups: body.followups || [],
        sources: body.sources || [],
        draft: body.draft || null,
        kpis: body.kpis || [],
        table: body.table || null,
        chart: body.chart || null,
        bars: body.bars || null,
        comparison: body.comparison || null,
        evidence: body.evidence || [],
        illustrative: Boolean(body.illustrative),
        live: body.live === true,
        state: body.state || 'error',
      }
      updateConversation(conversationId, item => ({
        ...item,
        updatedAt: new Date().toISOString(),
        messages: [...item.messages, reply].slice(-40),
      }))
    } catch (error) {
      updateConversation(conversationId, item => ({
        ...item,
        messages: [...item.messages, {
          id: messageId(),
          role: 'notice',
          fromModel: false,
          state: 'error',
          content: 'The assistant request failed before a reply was received.',
          detail: error.message || '',
          sources: ['Browser request failed'],
        }],
      }))
    } finally {
      setSending(false)
    }
  }

  function onComposerKeyDown(event) {
    if (composerAction(event) !== 'send') return
    event.preventDefault()
    send()
  }

  const providerLine = statusError
    ? statusError
    : provider?.configured && !demo
      ? 'The model can reply in words. Live books are not attached, so charts stay in the sample studio.'
      : demo
        ? 'DEMO ledger. Answers are fictional and use only the simulated Atomic Bar books.'
        : 'Sample studio. Figures in this thread are fictional until a live book is connected.'

  return (
    <div className="ai-chat">
      <aside className="ai-chat-history" aria-label="Conversation history">
        <button type="button" className="action-secondary" onClick={newConversation}>New conversation</button>
        {store.conversations.map(item => (
          <button
            key={item.id}
            type="button"
            className={item.id === active?.id ? 'is-active' : ''}
            onClick={() => selectConversation(item.id)}
          >
            {item.title}
          </button>
        ))}
      </aside>
      <section className="ai-chat-thread" aria-label="AI assistant">
        <div className="ai-chat-status" role="status">{providerLine}</div>
        <div className="ai-chat-log" ref={logRef}>
          {!active?.messages?.length && (
            <SampleBriefing demo={demo} answer={demo ? composeDemoAnswer('How much did we sell today?') : composeSampleAnswer('How much did we make this month?')} />
          )}
          {(active?.messages || []).map(message => (
            <Message key={message.id} message={message} onFollowup={send} />
          ))}
          {sending && <div className="ai-chat-pending" role="status">Waiting for the assistant…</div>}
        </div>
        <div className="ai-chat-suggestions" aria-label="Suggested questions">
          {SUGGESTED_QUESTIONS.map(question => (
            <button key={question} type="button" disabled={sending} onClick={() => send(question)}>{question}</button>
          ))}
        </div>
        <form className="ai-chat-composer" onSubmit={event => { event.preventDefault(); send() }}>
          <label className="sr-only" htmlFor="ai-assistant-input">Message the assistant</label>
          <textarea
            id="ai-assistant-input"
            value={draft}
            rows={2}
            placeholder="Ask anything about this bar"
            disabled={sending}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={onComposerKeyDown}
          />
          <button type="submit" className="action-primary" disabled={sending || !draft.trim()}>Send</button>
        </form>
        <p className="ai-chat-hint">Enter sends. Shift+Enter adds a line. History stays in this browser session.</p>
      </section>
    </div>
  )
}

function SampleBriefing({ answer, demo }) {
  return (
    <div className="ai-brief">
      <span>{demo ? 'DEMO · fictional Atomic Bar ledger' : 'Sample studio · not live books'}</span>
      <AnswerBody answer={answer} />
    </div>
  )
}

function Message({ message, onFollowup }) {
  const label = message.role === 'user'
    ? 'You'
    : message.state === 'demo'
      ? 'DEMO'
      : message.fromModel
        ? 'Assistant'
        : message.illustrative
          ? 'Sample studio'
          : 'Not a model response'
  return (
    <article className={`ai-chat-message is-${message.role}${message.illustrative ? ' is-sample' : ''}`}>
      <span>{label}</span>
      <p>{message.content}</p>
      {(message.illustrative || message.fromModel) && <AnswerBody answer={message} />}
      {message.draft && (
        <div className="ai-chat-draft">
          <strong>{message.draft.title} · {message.draft.status === 'not_created' ? 'Not created' : message.draft.status}</strong>
          <p>{message.draft.reason}</p>
        </div>
      )}
      {!!message.followups?.length && (
        <div className="ai-chat-followups">
          {message.followups.map(question => (
            <button key={question} type="button" onClick={() => onFollowup(question)}>{question}</button>
          ))}
        </div>
      )}
    </article>
  )
}

function AnswerBody({ answer }) {
  const [open, setOpen] = useState(false)
  const chart = normalizeSeries(answer.chart)
  const bars = normalizeSeries(answer.bars)
  return (
    <div className="ai-answer">
      {!!answer.kpis?.length && (
        <div className="ai-kpis">
          {answer.kpis.map(item => (
            <article key={item.label}>
              <em>{item.label}</em>
              <strong>{item.value}</strong>
              {item.note && <span>{item.note}</span>}
            </article>
          ))}
        </div>
      )}
      {!!chart.points.length && <SeriesChart title={chart.title || 'Trend'} points={chart.points} kind="line" />}
      {!!bars.points.length && <SeriesChart title={bars.title || 'Comparison'} points={bars.points} kind="bar" />}
      {answer.comparison?.rows?.length > 0 && (
        <div className="ai-chat-table-wrap">
          <h3>{answer.comparison.title}</h3>
          <table>
            <thead><tr>{(answer.comparison.columns || []).map(column => <th key={column || 'blank'}>{column}</th>)}</tr></thead>
            <tbody>
              {answer.comparison.rows.map((row, index) => (
                <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {answer.table?.rows?.length > 0 && (
        <div className="ai-chat-table-wrap">
          <table>
            <thead><tr>{answer.table.columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {answer.table.rows.map((row, index) => (
                <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(answer.evidence?.length > 0 || answer.detail || answer.sources?.length > 0) && (
        <div className="ai-evidence">
          <button type="button" onClick={() => setOpen(value => !value)}>{open ? 'Hide evidence' : 'Evidence and calculation'}</button>
          {open && (
            <div>
              {answer.detail && <p>{answer.detail}</p>}
              {(answer.evidence || []).map(item => (
                <p key={item.label}><b>{item.label}.</b> {item.formula}</p>
              ))}
              {!!answer.sources?.length && <p>{answer.sources.join(' · ')}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function normalizeSeries(series) {
  if (Array.isArray(series)) return { title: '', points: series }
  if (!series?.points) return { title: '', points: [] }
  return series
}

function SeriesChart({ title, points, kind }) {
  const values = points.map(point => Number(point.value)).filter(Number.isFinite)
  const max = Math.max(...values, 1)
  if (kind === 'line') {
    const width = 640
    const height = 168
    const pad = 28
    const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0
    const x = index => pad + index * step
    const y = value => height - 28 - (Number(value) / max) * (height - 48)
    const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point.value)}`).join(' ')
    return (
      <figure className="ai-figure">
        <figcaption>{title}</figcaption>
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <line x1={pad} y1={height - 28} x2={width - pad} y2={height - 28} />
          <path d={path} />
          {points.map((point, index) => (
            <g key={point.label}>
              <circle cx={x(index)} cy={y(point.value)} r="3.5" />
              <text x={x(index)} y={height - 8} textAnchor="middle">{point.label}</text>
            </g>
          ))}
        </svg>
      </figure>
    )
  }
  return (
    <figure className="ai-figure">
      <figcaption>{title}</figcaption>
      <ul className="ai-bars">
        {points.map(point => (
          <li key={point.label}>
            <span>{point.label}</span>
            <i><b style={{ width: `${Math.max(6, (Number(point.value) / max) * 100)}%` }} /></i>
            <em>{point.marker != null ? `${point.value} / ${point.marker}` : (Number(point.value) > 999 ? formatSampleYen(point.value) : point.value)}</em>
          </li>
        ))}
      </ul>
    </figure>
  )
}

export { CHAT_STORAGE_KEY }
