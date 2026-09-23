import { useEffect, useRef, useState } from 'react'
import { callGeminiChat } from '../lib/ai'
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
    : 'Responda em português, curto, com yen. Sem enrolação.'
  return `Você é o assistente JBM Drinks no dashboard. ${speak}
Mês: ${snap.monthLabel}
Lucro projetado: ${snap.lucro}
Faturado: ${snap.faturamento}
Compras: ${snap.compras}
Margem: ${snap.margem}%
A receber: ${snap.aReceber}
Entregas: ${snap.entregas}
Pedidos pendentes: ${snap.pedidosPendentes || 0}
Atrasado a receber: ${snap.overdueText || 'nenhum'}
Atrasado a pagar: ${snap.payText || 'nenhum'}
Calendário do mês: ${snap.calText || 'sem eventos'}
Ajude a decidir o que cobrar, o que pagar e o que o calendário mostra.
Não misture caixa do bar, fatura JBM e salário.`
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
    const local = localDashAnswer(text, snap, t)
    setMessages(m => [...m, userMsg, { role: 'assistant', content: local }])
    setBusy(true)
    try {
      const api = await Promise.race([
        callGeminiChat({
          messages: [userMsg],
          system: dashSystem(snap, lang),
          temperature: 0.25,
          maxOutputTokens: 500,
        }),
        new Promise(resolve => setTimeout(() => resolve(null), 5000)),
      ])
      if (api && !/^Error:/i.test(api) && api !== 'No response') {
        setMessages(m => {
          const next = [...m]
          next[next.length - 1] = { role: 'assistant', content: String(api).replace(/\*\*/g, '') }
          return next
        })
      }
    } catch { /* keep local books */ }
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
        </div>
      </div>
      <div className="cash-ai-chips">
        {chips.map(c => (
          <button key={c} type="button" className="cash-ai-chip" onClick={() => send(c)}>{c}</button>
        ))}
      </div>
      <div ref={listRef} className="cash-ai-log">
        {messages.map((msg, i) => (
          <div key={i} className={`cash-ai-bubble cash-ai-${msg.role}`}>{msg.content}</div>
        ))}
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
