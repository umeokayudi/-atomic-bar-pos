import { useEffect, useRef, useState } from 'react'
import { callGeminiChat } from '../lib/ai'
import { fmtYen } from './utils'
import { useI18n } from '../lib/i18n'

function localCashAnswer(question, snap, t) {
  const q = String(question || '').toLowerCase()
  const lines = [
    t('cashflow.aiSummary', {
      net: fmtYen(snap.netCash || 0),
      in: fmtYen(snap.paidIn || 0),
      out: fmtYen(snap.paidOut || 0),
      receive: fmtYen(snap.pendingIn || 0),
      pay: fmtYen(snap.pendingOut || 0),
    }),
  ]
  if (q.includes('semana') || q.includes('vence') || q.includes('agenda') || q.includes('week') || q.includes('calendar')) {
    return snap.weekText || t('cashflow.aiNoWeek')
  }
  if (q.includes('negativ') || q.includes('por que') || q.includes('why')) {
    return snap.whyText || lines[0]
  }
  if (q.includes('cobrar') || q.includes('receber') || q.includes('bar') || q.includes('collect')) {
    return snap.collectText || t('cashflow.aiNoCollect')
  }
  if (q.includes('pagar') || q.includes('fornecedor') || q.includes('supplier') || q.includes('pay')) {
    return snap.payText || t('cashflow.aiNoPay')
  }
  return `${lines[0]}\n\n${t('cashflow.aiAskHint')}`
}

function cashSystem(snap) {
  return `Você é o assistente de caixa da JBM Drinks no Japão. Responda em português, curto, com yen.
Números atuais:
- Recebido dos bares: ${snap.paidIn}
- Pago a fornecedores: ${snap.paidOut}
- Caixa líquido: ${snap.netCash}
- Ainda a receber: ${snap.pendingIn}
- Ainda a pagar: ${snap.pendingOut}
- Atrasado a receber: ${snap.overdueIn || 0}
- Atrasado a pagar: ${snap.overdueOut || 0}
Agenda da semana: ${snap.weekText || 'sem eventos'}
Não misture caixa do bar, fatura JBM e salário.`
}

export default function CashflowAi({ snapshot }) {
  const { t } = useI18n()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef(null)
  const snap = snapshot || {}

  useEffect(() => {
    setMessages([{ role: 'assistant', content: localCashAnswer('', snap, t) }])
  }, [snap.netCash, snap.pendingIn, snap.pendingOut, t])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages])

  async function send(override) {
    const text = (override || input).trim()
    if (!text || busy) return
    setInput('')
    const userMsg = { role: 'user', content: text }
    const local = localCashAnswer(text, snap, t)
    setMessages(m => [...m, userMsg, { role: 'assistant', content: local }])
    setBusy(true)
    try {
      const api = await Promise.race([
        callGeminiChat({
          messages: [userMsg],
          system: cashSystem(snap),
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
    t('cashflow.aiChipWeek'),
    t('cashflow.aiChipCollect'),
    t('cashflow.aiChipPay'),
    t('cashflow.aiChipWhy'),
  ]

  return (
    <div className="cash-ai">
      <div className="cash-ai-head">
        <div>
          <div className="cash-ai-title">{t('cashflow.aiTitle')}</div>
          <div className="cash-ai-hint">{t('cashflow.aiHint')}</div>
        </div>
      </div>
      <div className="cash-ai-chips">
        {chips.map(c => (
          <button key={c} type="button" className="cash-ai-chip" onClick={() => send(c)}>{c}</button>
        ))}
      </div>
      <div ref={listRef} className="cash-ai-log">
        {messages.map((m, i) => (
          <div key={i} className={`cash-ai-bubble cash-ai-${m.role}`}>{m.content}</div>
        ))}
      </div>
      <form className="cash-ai-compose" onSubmit={e => { e.preventDefault(); send() }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={t('cashflow.aiPlaceholder')}
        />
        <button type="submit" className="btn-primary" disabled={busy || !input.trim()}>
          {busy ? t('common.wait') : t('cashflow.aiAsk')}
        </button>
      </form>
    </div>
  )
}
