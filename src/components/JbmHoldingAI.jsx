import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { callGeminiChat } from '../lib/ai'
import { Spinner } from './utils'
import { staffFetch } from '../lib/apiAuth'
import {
  fetchHoldingSystemSnapshot,
  buildHoldingFullAuditPrompt,
  buildHoldingChatSystem,
} from '../lib/holdingDataSync'

const QUICK_PROMPTS = [
  'Checagem completa: está tudo sustentável?',
  'Posso comprar bebidas à vista agora ou é melhor a prazo?',
  'O caixa aguenta mais uma compra grande esta semana?',
  'O que está em risco urgente?',
  'Como alocar capital entre JBM Drinks e outros negócios?',
]

export default function JbmHoldingAI({ holdingProfile }) {
  const [snapshot, setSnapshot] = useState(null)
  const [loadingSnap, setLoadingSnap] = useState(true)
  const [auditText, setAuditText] = useState('')
  const [auditLoading, setAuditLoading] = useState(false)
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Olá. Sou a IA da JBM Holding, ligada aos dados reais do sistema. Clique em "Checar tudo" ou faça uma pergunta.' },
  ])
  const [input, setInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    refreshSnapshot()
  }, [holdingProfile])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, auditText])

  async function refreshSnapshot() {
    setLoadingSnap(true)
    try {
      const local = await fetchHoldingSystemSnapshot(supabase, holdingProfile)
      setSnapshot(local)
      // Enriquecer com API server-side se disponível
      try {
        const res = await staffFetch('/api/holding-audit')
        if (res.ok) {
          const server = await res.json()
          setSnapshot(s => ({ ...s, ...server, holding: s?.holding || server.holding }))
        }
      } catch { /* client snapshot ok */ }
    } catch (e) {
      setSnapshot({ erro: e.message })
    }
    setLoadingSnap(false)
  }

  async function runFullAudit() {
    if (!snapshot) await refreshSnapshot()
    setAuditLoading(true)
    setAuditText('')
    const prompt = buildHoldingFullAuditPrompt(snapshot || {})
    const text = await callGeminiChat({ ...prompt, temperature: 0.35, maxOutputTokens: 2048 })
    setAuditText(text)
    setAuditLoading(false)
  }

  async function sendChat(override) {
    const text = (override || input).trim()
    if (!text || chatLoading) return
    setInput('')
    const userMsg = { role: 'user', content: text }
    setMessages(m => [...m, userMsg])
    setChatLoading(true)

    const snap = snapshot || await fetchHoldingSystemSnapshot(supabase, holdingProfile)
    const history = messages.filter((_, i) => i > 0).map(m => ({ role: m.role, content: m.content }))
    const reply = await callGeminiChat({
      messages: [...history, userMsg],
      system: buildHoldingChatSystem(snap),
      temperature: 0.5,
      maxOutputTokens: 1200,
    })
    setMessages(m => [...m, { role: 'assistant', content: reply }])
    setChatLoading(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>🤖 IA Gemini — JBM Holding</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
            Conectada aos dados do sistema: caixa, faturas, compras, vendas, fornecedores, preços POS
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={refreshSnapshot} disabled={loadingSnap} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'white', fontSize: 12, cursor: 'pointer' }}>
            {loadingSnap ? '...' : '🔄 Atualizar dados'}
          </button>
          <button type="button" onClick={runFullAudit} disabled={auditLoading} className="btn-primary" style={{ padding: '8px 14px', fontSize: 12, borderRadius: 8 }}>
            {auditLoading ? 'Analisando...' : '🔍 Checar tudo'}
          </button>
        </div>
      </div>

      {/* Snapshot KPIs */}
      {snapshot && !snapshot.erro && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 8, marginBottom: 16 }}>
          {[
            { label: 'Checks', value: `${snapshot.checksOk}/${snapshot.checksTotal}`, color: snapshot.checksOk === snapshot.checksTotal ? 'var(--green)' : 'var(--amber)' },
            { label: 'Caixa', value: `¥${Math.round(snapshot.financeiro?.caixaLiquido || 0).toLocaleString('ja-JP')}`, color: 'var(--navy)' },
            { label: 'A receber', value: `¥${Math.round(snapshot.financeiro?.aReceber || 0).toLocaleString('ja-JP')}`, color: 'var(--green)' },
            { label: 'Proj. 30d', value: `¥${Math.round(snapshot.financeiro?.projetado30d || 0).toLocaleString('ja-JP')}`, color: 'var(--blue)' },
            { label: 'Oportunidade', value: `${snapshot.opportunityCostPct}%/ano`, color: 'var(--gold)' },
          ].map(k => (
            <div key={k.label} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase' }}>{k.label}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: k.color }}>{k.value}</div>
            </div>
          ))}
        </div>
      )}

      {snapshot?.checks && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {snapshot.checks.map((c, i) => (
            <span key={i} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, background: c.ok ? '#f0fdf4' : '#fef2f2', color: c.ok ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
              {c.ok ? '✅' : '❌'} {c.label}
            </span>
          ))}
        </div>
      )}

      {auditLoading && <Spinner text="Gemini analisando todo o sistema JBM Holding..." />}
      {auditText && !auditLoading && (
        <div style={{ background: 'linear-gradient(135deg,#eff6ff,#f0fdf4)', border: '1px solid #93c5fd', borderRadius: 14, padding: '16px 18px', marginBottom: 16, fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy)', marginBottom: 8, textTransform: 'uppercase' }}>📋 Auditoria completa Gemini</div>
          {auditText}
        </div>
      )}

      {/* Quick prompts */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {QUICK_PROMPTS.map(p => (
          <button key={p} type="button" onClick={() => sendChat(p)} style={{ fontSize: 11, padding: '6px 12px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg3)', cursor: 'pointer' }}>
            {p}
          </button>
        ))}
      </div>

      {/* Chat */}
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', height: 380 }}>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '85%', padding: '10px 14px', borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: m.role === 'user' ? 'var(--navy)' : 'white',
                color: m.role === 'user' ? 'white' : 'var(--text)',
                fontSize: 13, lineHeight: 1.6,
                border: m.role === 'assistant' ? '1px solid var(--border)' : 'none',
              }}>
                {m.content}
              </div>
            </div>
          ))}
          {chatLoading && <Spinner text="Pensando com dados do sistema..." />}
          <div ref={bottomRef} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendChat()}
            placeholder="Pergunte sobre caixa, compras, cobranças, holding..."
            style={{ flex: 1, padding: '10px 14px', borderRadius: 10, fontSize: 13 }}
          />
          <button type="button" onClick={() => sendChat()} disabled={chatLoading || !input.trim()} className="btn-primary" style={{ padding: '10px 16px', borderRadius: 10, fontSize: 12 }}>
            Enviar
          </button>
        </div>
      </div>
    </div>
  )
}
