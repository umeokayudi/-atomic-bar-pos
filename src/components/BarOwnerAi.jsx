import { useEffect, useRef, useState } from 'react'
import { callGeminiChat, imageDataUrlToParts } from '../lib/ai'
import { buildHqChatSystem, localHqAnswer } from '../lib/hqChat'
import { strategyText, birthdayIdeas, whatWorked } from '../lib/barStrategy'
import { staffFetch } from '../lib/apiAuth'
import { supabase } from '../lib/supabase'
import { buildClientChatSystem } from '../lib/clientPortalSnapshot'
import { useI18n } from '../lib/i18n'
import { asReactText } from '../lib/errText'

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export default function BarOwnerAi({ bar, hq }) {
  const { t, lang } = useI18n()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [photo, setPhoto] = useState(null)
  const [strategy, setStrategy] = useState('')
  const listRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => {
    setMessages([{ role: 'assistant', content: t(hq?.books ? 'portal.aiHqIntro' : 'portal.aiIntro', { bar: bar?.nome || '' }) }])
  }, [bar?.nome, hq?.mes, t, hq?.books])

  useEffect(() => {
    if (!bar?.id) return
    let cancelled = false
    Promise.all([
      staffFetch('/api/bar-staff').then(r => r.json()).catch(() => ({})),
      supabase.from('bar_guests').select('id,nome,aniversario,ativo').eq('bar_id', bar.id).eq('ativo', true),
    ]).then(([team, guestsRes]) => {
      if (cancelled) return
      const staff = team.staff || []
      const extra = (team.people || []).filter(p => p?.id && !staff.some(s => s.id === p.id))
      const cast = [...staff, ...extra].filter(p => p.drink_back || p.aniversario).map(p => ({ id: p.id, nome: p.nome, aniversario: p.aniversario }))
      const partners = (team.registry || []).filter(r => r.kind === 'parceiro').map(r => ({ id: r.id, nome: r.nome, aniversario: r.aniversario }))
      const guests = (guestsRes.data || []).map(g => ({ id: g.id, nome: g.nome, aniversario: g.aniversario }))
      const worked = whatWorked(hq?.pos?.tickets || [])
      const ideas = birthdayIdeas({ cast, partners, guests, worked })
      setStrategy(strategyText(worked, ideas))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [bar?.id, hq?.mes])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages])

  async function send(override) {
    const text = (override || input).trim()
    if ((!text && !photo) || busy) return
    setInput('')
    const userLabel = text || t('portal.aiReadPrompt')
    const userMsg = { role: 'user', content: photo ? `${userLabel}\n📷` : userLabel }
    const local = hq
      ? localHqAnswer(text || 'summary', hq, lang, strategy)
      : t('portal.aiAskHint')
    setMessages(m => [...m, userMsg, { role: 'assistant', content: local }])
    const image = photo ? imageDataUrlToParts(photo) : null
    setPhoto(null)
    setBusy(true)
    try {
      const system = hq?.books
        ? `${buildHqChatSystem(hq, lang, strategy)}\nIf the user sends a photo, read the invoice/receipt/delivery and explain amount, date and what to do. Yen.`
        : `${buildClientChatSystem({ bar, mes: new Date().toISOString().slice(0, 7) })}\nIf the user sends a photo, read it and explain in short.`
      const api = await Promise.race([
        callGeminiChat({
          messages: [{ role: 'user', content: userLabel }],
          system,
          image,
          temperature: 0.3,
          maxOutputTokens: 700,
        }),
        new Promise(resolve => setTimeout(() => resolve(null), 8000)),
      ])
      if (api && !/^Error:/i.test(api) && api !== 'No response') {
        setMessages(m => {
          const next = [...m]
          next[next.length - 1] = { role: 'assistant', content: String(api).replace(/\*\*/g, '') }
          return next
        })
      }
    } catch { /* keep local */ }
    setBusy(false)
  }

  const chips = [
    t('portal.aiQ3'),
    t('portal.aiQ1'),
    t('portal.aiQ5'),
    t('portal.hq.aiChipPos'),
    t('portal.events.askAi'),
  ]

  return (
    <div className="cash-ai">
      <div className="cash-ai-head">
        <div>
          <div className="cash-ai-title">{t('portal.aiTitle')}</div>
          <div className="cash-ai-hint">{t('portal.aiOwnerHint')}</div>
        </div>
      </div>
      <div className="cash-ai-chips">
        {chips.map(c => (
          <button key={c} type="button" className="cash-ai-chip" onClick={() => send(c)}>{c}</button>
        ))}
      </div>
      <div ref={listRef} className="cash-ai-log">
        {messages.map((msg, i) => (
          <div key={i} className={`cash-ai-bubble cash-ai-${msg.role}`}>{asReactText(msg.content)}</div>
        ))}
      </div>
      {photo && (
        <div className="bar-ai-preview">
          <img src={photo} alt="" />
          <button type="button" onClick={() => setPhoto(null)}>×</button>
        </div>
      )}
      <form className="cash-ai-compose" onSubmit={e => { e.preventDefault(); send() }}>
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
            setPhoto(await fileToDataUrl(file))
          }}
        />
        <button
          type="button"
          className="bar-ai-cam"
          onClick={() => fileRef.current?.click()}
          aria-label={t('portal.aiRead')}
        >
          📷
        </button>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={t('portal.aiOwnerPlaceholder')}
        />
        <button type="submit" className="btn-primary" disabled={busy || (!input.trim() && !photo)}>
          {busy ? t('common.wait') : t('portal.send')}
        </button>
      </form>
    </div>
  )
}
