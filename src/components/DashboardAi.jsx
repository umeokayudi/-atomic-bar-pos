import { useEffect, useRef, useState } from 'react'
import { callGeminiChat } from '../lib/ai'
import { planAiActions } from '../lib/aiAgent'
import AiActionCards from './AiActionCards'
import { fmtYen } from './utils'
import { useI18n } from '../lib/i18n'

function localDashAnswer(question, snap, t) {
  const q = String(question || '').toLowerCase()
  const summary = t('dashboard.aiSummary', {
    month: snap.monthLabel || '',
    profit: fmtYen(snap.lucro || 0),
    billed: fmtYen(snap.faturamento || 0),
    receive: fmtYen(snap.aReceber || 0),
    deliveries: snap.entregas || 0,
  })
  if (q.includes('atras') || q.includes('overdue') || q.includes('延滞') || q.includes('cobrar') || q.includes('collect')) {
    return snap.overdueText || t('dashboard.aiNoOverdue')
  }
  if (q.includes('pagar') || q.includes('supplier') || q.includes('fornecedor') || q.includes('pay') || q.includes('支払')) {
    return snap.payText || t('dashboard.aiNoPay')
  }
  if (q.includes('calend') || q.includes('semana') || q.includes('week') || q.includes('pedido') || q.includes('entreg') || q.includes('order')) {
    return snap.calText || t('dashboard.aiNoCal')
  }
  if (q.includes('lucro') || q.includes('profit') || q.includes('利益') || q.includes('keep') || q.includes('margem')) {
    return t('dashboard.aiProfit', {
      profit: fmtYen(snap.lucro || 0),
      margin: snap.margem || 0,
      billed: fmtYen(snap.faturamento || 0),
      cost: fmtYen(snap.compras || 0),
    })
  }
  return `${summary}\n\n${t('dashboard.aiAskHint')}`
}

function dashSystem(snap, lang) {
  const speak = lang === 'ja'
    ? '日本語で短く答える。円表記。'
    : 'Answer in English, short, with yen. No filler.'
  return `You are the JBM Drinks dashboard assistant. ${speak}
Month: ${snap.monthLabel}
Projected profit: ${snap.lucro}
Billed: ${snap.faturamento}
Purchases: ${snap.compras}
Margin: ${snap.margem}%
To collect: ${snap.aReceber}
Deliveries: ${snap.entregas}
Pending orders: ${snap.pedidosPendentes || 0}
Overdue to collect: ${snap.overdueText || 'none'}
Overdue to pay: ${snap.payText || 'none'}
Month calendar: ${snap.calText || 'no events'}
Help decide what to collect, what to pay, and what the calendar shows.
Do not mix the bar till, the JBM invoice and wages.`
}

export default function DashboardAi({ snapshot }) {
  const { t, lang } = useI18n()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef(null)
  const snap = snapshot || {}

  useEffect(() => {
    setMessages([{ role: 'assistant', content: localDashAnswer('', snap, t) }])
  }, [snap.monthLabel, snap.lucro, snap.aReceber, t])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages])

  async function send(override) {
    const text = (override || input).trim()
    if (!text || busy) return
    setInput('')
    const userMsg = { role: 'user', content: text }
    const history = messages.slice(1).map(m => ({ role: m.role, content: m.content }))
    setMessages(m => [...m, userMsg])
    setBusy(true)
    let answer = null
    try {
      // AI with actions: proposals are only written after the user confirms each card.
      const out = await planAiActions({ messages: [...history, userMsg], screen: dashSystem(snap, lang) })
      answer = { role: 'assistant', content: String(out.reply || '').replace(/\*\*/g, ''), proposals: out.proposals || [] }
    } catch {
      try {
        const api = await Promise.race([
          callGeminiChat({ messages: [userMsg], system: dashSystem(snap, lang), temperature: 0.25, maxOutputTokens: 500 }),
          new Promise(resolve => setTimeout(() => resolve(null), 5000)),
        ])
        if (api && !/^Error:/i.test(api) && api !== 'No response') {
          answer = { role: 'assistant', content: String(api).replace(/\*\*/g, '') }
        }
      } catch { /* keep local books */ }
    }
    if (!answer || (!answer.content && !answer.proposals?.length)) {
      answer = { ...answer, role: 'assistant', content: localDashAnswer(text, snap, t) }
    }
    setMessages(m => [...m, answer])
    setBusy(false)
  }

  const chips = [
    t('dashboard.aiChipOverdue'),
    t('dashboard.aiChipProfit'),
    t('dashboard.aiChipCal'),
    t('dashboard.aiChipPay'),
  ]

  return (
    <div className="cash-ai">
      <div className="cash-ai-head">
        <div>
          <div className="cash-ai-title">{t('dashboard.aiTitle')}</div>
          <div className="cash-ai-hint">{t('dashboard.aiHint')}</div>
          <div className="ai-act-hint">{t('aiAct.hint')}</div>
        </div>
      </div>
      <div className="cash-ai-chips">
        {chips.map(c => (
          <button key={c} type="button" className="cash-ai-chip" onClick={() => send(c)}>{c}</button>
        ))}
      </div>
      <div ref={listRef} className="cash-ai-log">
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'contents' }}>
            {msg.content && <div className={`cash-ai-bubble cash-ai-${msg.role}`}>{msg.content}</div>}
            <AiActionCards proposals={msg.proposals} />
          </div>
        ))}
        {busy && <div className="cash-ai-bubble cash-ai-assistant">{t('portal.aiThinking')}</div>}
      </div>
      <form className="cash-ai-compose" onSubmit={e => { e.preventDefault(); send() }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={t('dashboard.aiPlaceholder')}
        />
        <button type="submit" className="btn-primary" disabled={busy || !input.trim()}>
          {busy ? t('common.wait') : t('dashboard.aiAsk')}
        </button>
      </form>
    </div>
  )
}
