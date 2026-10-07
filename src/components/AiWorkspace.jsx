import { useEffect, useRef, useState } from 'react'
import { isLocalDemo, supabase } from '../lib/supabase'
import { peekHqSnapshot, fetchHqSnapshot } from '../lib/hqSnapshot'
import { planTurn, confirmAiProposal } from '../lib/aiWorkspace'
import { postClockMark } from './TimeClock'
import { useAuth } from './Auth'
import { useI18n } from '../lib/i18n'

const STORE = 'atomic-ai-chats'

function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || 'null')
    if (raw?.threads?.length) return raw
  } catch { /* ignore */ }
  return { activeId: null, threads: [] }
}

function saveStore(state) {
  try { localStorage.setItem(STORE, JSON.stringify(state)) } catch { /* ignore */ }
}

function newThread() {
  const id = `c-${Date.now().toString(36)}`
  return {
    id,
    title: 'Nova conversa',
    messages: [],
    updatedAt: Date.now(),
  }
}

const PROMPTS = [
  'Como estão as vendas?',
  'O que falta no estoque?',
  'Anota para contar o caixa',
  'Fecha o caixa de hoje',
]

export default function AiWorkspace({ bar, onTab }) {
  const { lang } = useI18n()
  const { user } = useAuth()
  const [store, setStore] = useState(loadStore)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [context, setContext] = useState({ connected: false, snapshot: null, modelConfigured: false, lang })
  const listRef = useRef(null)
  const inputRef = useRef(null)

  const thread = store.threads.find(item => item.id === store.activeId) || null

  useEffect(() => {
    let cancelled = false
    const cached = peekHqSnapshot()
    if (cached) setContext(current => ({ ...current, connected: true, snapshot: cached, lang }))
    if (isLocalDemo) return undefined
    fetchHqSnapshot().then(snapshot => {
      if (!cancelled && snapshot) setContext(current => ({ ...current, connected: true, snapshot, lang }))
    }).catch(() => {
      if (!cancelled) setContext(current => ({ ...current, connected: false, lang }))
    })
    return () => { cancelled = true }
  }, [lang])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [thread?.messages?.length, busy])

  function commit(next) {
    setStore(next)
    saveStore(next)
  }

  function startChat() {
    const thread = newThread()
    commit({ activeId: thread.id, threads: [thread, ...store.threads].slice(0, 30) })
    setNavOpen(false)
    inputRef.current?.focus()
  }

  async function send(text) {
    const value = String(text || draft).trim()
    if (!value || busy) return
    setDraft('')
    setBusy(true)
    const current = thread || newThread()
    const userMessage = { id: `m-${Date.now()}`, role: 'user', content: value }
    const planned = planTurn(value, { ...context, demo: isLocalDemo })
    const assistant = {
      id: `m-${Date.now() + 1}`,
      role: 'assistant',
      content: planned.reply,
      sources: planned.sources,
      missing: planned.missing,
      proposal: planned.proposal,
      proposalState: planned.proposal ? 'pending' : null,
    }
    const messages = [...current.messages, userMessage, assistant]
    const title = current.messages.length ? current.title : value.slice(0, 42)
    const nextThread = { ...current, title, messages, updatedAt: Date.now() }
    const others = store.threads.filter(item => item.id !== current.id)
    commit({ activeId: current.id, threads: [nextThread, ...others].slice(0, 30) })
    setBusy(false)
  }

  async function resolveProposal(message, confirmed) {
    if (!thread || message.proposalState !== 'pending') return
    const result = confirmAiProposal(message.proposal, { confirmed })
    if (result.clock) {
      const staffId = user?.id || null
      if (!bar?.id || !staffId) {
        result.executed = false
        result.message = 'Confirmação recebida. Não há funcionário desta sessão para gravar o ponto.'
      } else {
        try {
          await postClockMark({ barId: bar.id, staffId, tipo: result.clock.tipo })
        } catch (error) {
          result.executed = false
          result.message = error.message || 'O ponto não foi gravado.'
        }
      }
    }
    if (result.write) {
      const { error } = await supabase.from('ai_notes').insert(result.write.row)
      if (error) {
        result.executed = false
        result.message = error.message || result.message
      }
    }
    if (result.navigate && confirmed) onTab?.(result.navigate)
    const messages = thread.messages.map(item => (
      item.id === message.id
        ? { ...item, proposalState: confirmed ? 'confirmed' : 'cancelled', result: result.message }
        : item
    ))
    const others = store.threads.filter(item => item.id !== thread.id)
    commit({ activeId: thread.id, threads: [{ ...thread, messages, updatedAt: Date.now() }, ...others] })
  }

  return (
    <div className="gpt-app">
      <aside className={`gpt-side${navOpen ? ' is-open' : ''}`}>
        <button type="button" className="gpt-new" onClick={startChat}>Nova conversa</button>
        <div className="gpt-threads">
          {store.threads.map(item => (
            <button
              key={item.id}
              type="button"
              className={item.id === store.activeId ? 'is-on' : ''}
              onClick={() => { commit({ ...store, activeId: item.id }); setNavOpen(false) }}
            >
              {item.title}
            </button>
          ))}
          {!store.threads.length && <p className="gpt-empty">Nenhuma conversa ainda.</p>}
        </div>
      </aside>
      <section className="gpt-main">
        <header className="gpt-top">
          <button type="button" className="gpt-menu" onClick={() => setNavOpen(open => !open)} aria-label="Conversas">Conversas</button>
          <div>
            <strong>{bar?.nome || 'Atomic Bar'}</strong>
            <p>{isLocalDemo ? 'DEMO — livros fictícios deste navegador. Modelo externo não ligado.' : (context.connected ? 'Livros carregados. Modelo externo não é usado nesta tela.' : 'Livros não carregados. Modelo externo não ligado.')}</p>
          </div>
        </header>
        <div className="gpt-log" ref={listRef}>
          {!thread?.messages?.length && (
            <div className="gpt-welcome">
              <h1>Como posso ajudar?</h1>
              <p>Consulto os livros quando eles estão carregados. Alteração só acontece depois que você confirma.</p>
              <div className="gpt-prompts">
                {PROMPTS.map(prompt => (
                  <button key={prompt} type="button" onClick={() => send(prompt)}>{prompt}</button>
                ))}
              </div>
            </div>
          )}
          {(thread?.messages || []).map(message => (
            <article key={message.id} className={`gpt-msg is-${message.role}`}>
              <div className="gpt-bubble">{message.content}</div>
              {!!message.sources?.length && <p className="gpt-meta">Fonte: {message.sources.join(' · ')}</p>}
              {!!message.missing?.length && <p className="gpt-meta">{message.missing.join(' · ')}</p>}
              {message.proposal && message.proposalState === 'pending' && (
                <div className="gpt-confirm">
                  <strong>{message.proposal.title}</strong>
                  <p>{message.proposal.question}</p>
                  <p>{message.proposal.detail}</p>
                  <div>
                    <button type="button" className="btn-primary" onClick={() => resolveProposal(message, true)}>Confirmar</button>
                    <button type="button" onClick={() => resolveProposal(message, false)}>Cancelar</button>
                  </div>
                </div>
              )}
              {message.result && <p className="gpt-meta">{message.result}</p>}
            </article>
          ))}
          {busy && <p className="gpt-meta">…</p>}
        </div>
        <form className="gpt-compose" onSubmit={event => { event.preventDefault(); send() }}>
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            placeholder="Pergunte aqui"
            aria-label="Mensagem"
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
          />
          <button type="submit" className="btn-primary" disabled={busy || !draft.trim()}>Enviar</button>
        </form>
      </section>
    </div>
  )
}
