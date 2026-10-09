import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { callGeminiChat, imageDataUrlToParts } from '../lib/ai'
import { Spinner, SectionTitle } from './utils'
import { useI18n } from '../lib/i18n'
import { fetchClientPortalSnapshot, buildClientChatSystem } from '../lib/clientPortalSnapshot'
import { fetchHqSnapshot, buildHqChatSystem } from '../lib/hqSnapshot'

const QUICK_PROMPT_KEYS = ['portal.aiQ1', 'portal.aiQ2', 'portal.aiQ3', 'portal.aiQ4', 'portal.aiQ5', 'portal.aiQ6']

async function loadPortalSnapshot(bar) {
  try {
    return await fetchHqSnapshot()
  } catch {
    return fetchClientPortalSnapshot(supabase, bar)
  }
}

export default function PortalClienteAI({ bar, initialSnapshot = null }) {
  const { t } = useI18n()
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [loadingSnap, setLoadingSnap] = useState(!initialSnapshot)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [photo, setPhoto] = useState(null)
  const listRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => {
    setMessages([{ role: 'assistant', content: t(snapshot?.books ? 'portal.aiHqIntro' : 'portal.aiIntro', { bar: bar.nome }) }])
  }, [bar.nome, t, snapshot?.books])

  useEffect(() => {
    if (initialSnapshot) {
      setSnapshot(initialSnapshot)
      setLoadingSnap(false)
      return
    }
    refreshSnapshot()
  }, [bar, initialSnapshot])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages])

  async function refreshSnapshot() {
    setLoadingSnap(true)
    try {
      const snap = await loadPortalSnapshot(bar)
      setSnapshot(snap)
    } catch (e) {
      setSnapshot({ erro: e.message, bar: { nome: bar.nome } })
    }
    setLoadingSnap(false)
  }

  async function sendChat(override) {
    const text = (override || input).trim()
    if ((!text && !photo) || chatLoading) return
    setInput('')
    const userLabel = text || t('portal.aiReadPrompt')
    const userMsg = { role: 'user', content: photo ? `${userLabel}\n📷` : userLabel }
    setMessages(m => [...m, userMsg])
    setChatLoading(true)
    const image = photo ? imageDataUrlToParts(photo) : null
    setPhoto(null)

    const snap = snapshot?.erro ? await loadPortalSnapshot(bar) : (snapshot || await loadPortalSnapshot(bar))
    if (!snapshot || snapshot.erro) setSnapshot(snap)

    const history = messages.filter((_, i) => i > 0).map(m => ({ role: m.role, content: m.content }))
    const system = (snap?.books ? buildHqChatSystem(snap) : buildClientChatSystem(snap))
      + '\nIf the user sends a photo, read the invoice, receipt or delivery note and explain amount, date and next step.'
    const reply = await callGeminiChat({
      messages: [...history, { role: 'user', content: userLabel }],
      system,
      image,
      temperature: 0.45,
      maxOutputTokens: 1200,
    })
    setMessages(m => [...m, { role: 'assistant', content: reply }])
    setChatLoading(false)
  }

  const isHq = !!snapshot?.books

  return (
    <div className="fade-in portal-page" style={{ maxWidth: 860 }}>
      <SectionTitle sub={isHq ? t('portal.aiHqSub') : t('portal.aiSub')}>
        {t('portal.aiTitle')}
      </SectionTitle>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--text2)' }}>
          {t(isHq ? 'portal.aiHqConnected' : 'portal.aiConnected', { bar: bar.nome })}
        </div>
        <button
          type="button"
          onClick={refreshSnapshot}
          disabled={loadingSnap}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'white', fontSize: 12, cursor: 'pointer' }}
        >
          {loadingSnap ? '...' : `🔄 ${t('portal.refreshData')}`}
        </button>
      </div>

      {snapshot && !snapshot.erro && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 8, marginBottom: 16 }}>
          {(isHq ? [
            { label: t('portal.costs.posTill'), value: `¥${Math.round(snapshot.books.pos?.amount || 0).toLocaleString('ja-JP')}`, color: 'var(--navy)' },
            { label: t('portal.costs.jbmBill'), value: `¥${Math.round(snapshot.books.jbm?.amount || 0).toLocaleString('ja-JP')}`, color: 'var(--navy)' },
            { label: t('portal.costs.staffWages'), value: `¥${Math.round(snapshot.books.staff?.amount || 0).toLocaleString('ja-JP')}`, color: 'var(--green)' },
            { label: t('portal.costs.rent'), value: `¥${Math.round(snapshot.books.rent?.amount || 0).toLocaleString('ja-JP')}`, color: 'var(--amber)' },
          ] : [
            { label: t('portal.purchasesMonth'), value: `¥${Math.round(snapshot.comprasMes || 0).toLocaleString('ja-JP')}`, color: 'var(--navy)' },
            { label: t('portal.posMargin'), value: `${snapshot.margemPct || 0}%`, color: 'var(--green)' },
            { label: t('portal.pending'), value: `¥${Math.round(snapshot.totalPendente || 0).toLocaleString('ja-JP')}`, color: snapshot.totalPendente > 0 ? 'var(--amber)' : 'var(--green)' },
            { label: t('portal.overdue'), value: snapshot.faturasAtraso || 0, color: snapshot.faturasAtraso > 0 ? 'var(--red)' : 'var(--green)' },
          ]).map(k => (
            <div key={k.label} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase' }}>{k.label}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: k.color }}>{k.value}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {QUICK_PROMPT_KEYS.map(key => (
          <button
            key={key}
            type="button"
            onClick={() => sendChat(t(key))}
            style={{ fontSize: 11, padding: '6px 12px', borderRadius: 20, border: '1px solid var(--border)', background: 'var(--bg3)', cursor: 'pointer' }}
          >
            {t(key)}
          </button>
        ))}
      </div>

      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, display: 'flex', flexDirection: 'column', height: 420 }}>
        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div
                style={{
                  maxWidth: '85%',
                  padding: '10px 14px',
                  borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: m.role === 'user' ? 'var(--navy)' : 'white',
                  color: m.role === 'user' ? 'white' : 'var(--text)',
                  fontSize: 13,
                  lineHeight: 1.6,
                  border: m.role === 'assistant' ? '1px solid var(--border)' : 'none',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {m.content}
              </div>
            </div>
          ))}
          {chatLoading && <Spinner text={t('portal.aiThinking')} />}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={async e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              const r = new FileReader()
              r.onload = () => setPhoto(r.result)
              r.readAsDataURL(file)
            }}
          />
          <button type="button" onClick={() => fileRef.current?.click()} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'white', cursor: 'pointer' }}>📷</button>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendChat()}
            placeholder={t('portal.aiOwnerPlaceholder')}
            style={{ flex: 1, padding: '10px 14px', borderRadius: 10, fontSize: 13 }}
          />
          <button
            type="button"
            onClick={() => sendChat()}
            disabled={chatLoading || (!input.trim() && !photo)}
            className="btn-primary"
            style={{ padding: '10px 16px', borderRadius: 10, fontSize: 12 }}
          >
            {t('portal.send')}
          </button>
        </div>
        {photo && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <img src={photo} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8 }} />
            <button type="button" onClick={() => setPhoto(null)}>{t('common.clear')}</button>
          </div>
        )}
      </div>
    </div>
  )
}
