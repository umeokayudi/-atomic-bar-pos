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
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
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
        comparison: body.comparison || null,
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
    : provider
      ? 'Ask in your own words. This bar’s books and the model are not connected, so figures are not invented.'
      : 'Checking the assistant configuration…'

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
            <div className="ai-chat-empty">
              <strong>Ask Atomic</strong>
              <p>Sales, profit, stock, suppliers, cash, labor, or reports.</p>
            </div>
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

function Message({ message, onFollowup }) {
  const [open, setOpen] = useState(false)
  const longDetail = String(message.detail || '').length > 180
  return (
    <article className={`ai-chat-message is-${message.role}`}>
      <span>{message.role === 'user' ? 'You' : message.fromModel ? 'Assistant' : 'Not a model response'}</span>
      <p>{message.content}</p>
      {message.detail && (
        <div className="ai-chat-detail">
          {longDetail && !open ? `${message.detail.slice(0, 180)}…` : message.detail}
          {longDetail && (
            <button type="button" onClick={() => setOpen(value => !value)}>{open ? 'Hide explanation' : 'Show explanation'}</button>
          )}
        </div>
      )}
      {!!message.kpis?.length && (
        <div className="ai-chat-kpis">
          {message.kpis.map(item => (
            <div key={item.label}><em>{item.label}</em><strong>{item.value}</strong></div>
          ))}
        </div>
      )}
      {message.table?.rows?.length > 0 && (
        <div className="ai-chat-table-wrap">
          <table>
            <thead><tr>{message.table.columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {message.table.rows.map((row, index) => (
                <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!message.chart?.length && (
        <div className="ai-chat-chart" aria-label="Chart">
          {message.chart.map(point => (
            <div key={point.label}><span>{point.label}</span><i style={{ width: `${Math.max(4, Math.min(100, Number(point.value) || 0))}%` }} /><b>{point.value}</b></div>
          ))}
        </div>
      )}
      {message.comparison && (
        <p className="ai-chat-detail">{message.comparison.label}: {message.comparison.current} compared with {message.comparison.previous}. {message.comparison.note || ''}</p>
      )}
      {message.draft && (
        <div className="ai-chat-draft">
          <strong>{message.draft.title} · {message.draft.status === 'not_created' ? 'not created' : message.draft.status}</strong>
          <p>{message.draft.reason}</p>
        </div>
      )}
      {!!message.sources?.length && <p className="ai-chat-sources">Sources: {message.sources.join(' · ')}</p>}
      {!!message.followups?.length && (
        <div className="ai-chat-suggestions">
          {message.followups.map(question => (
            <button key={question} type="button" onClick={() => onFollowup(question)}>{question}</button>
          ))}
        </div>
      )}
    </article>
  )
}

export { CHAT_STORAGE_KEY }
