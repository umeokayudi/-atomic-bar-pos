import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, Spinner } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { fetchHqSnapshot } from '../lib/hqSnapshot'
import { birthdayIdeas, whatWorked } from '../lib/barStrategy'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'

export default function BarEventsTab({ bar }) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [worked, setWorked] = useState(null)
  const [ideas, setIdeas] = useState([])
  const [events, setEvents] = useState([])

  async function load() {
    const [teamRes, hq, guestsRes] = await Promise.all([
      staffFetch('/api/bar-staff').then(r => r.json()),
      fetchHqSnapshot().catch(() => null),
      supabase.from('bar_guests').select('id,nome,aniversario,ativo').eq('bar_id', bar.id).eq('ativo', true),
    ])
    if (teamRes.error) throw new Error(errText(teamRes.error))
    const staff = (teamRes.staff || []).map(p => ({ id: p.id, nome: p.nome, aniversario: p.aniversario, drink_back: !!p.drink_back }))
    const extra = (teamRes.people || []).filter(p => p?.id && !staff.some(s => s.id === p.id)).map(p => ({
      id: p.id, nome: p.nome, aniversario: p.aniversario, drink_back: !!p.drink_back,
    }))
    const cast = [...staff, ...extra].filter(p => p.drink_back || p.aniversario)
    const partners = (teamRes.registry || []).filter(r => r.kind === 'parceiro').map(r => ({
      id: r.id, nome: r.nome, aniversario: r.aniversario,
    }))
    const guests = (guestsRes.data || []).map(g => ({ id: g.id, nome: g.nome, aniversario: g.aniversario }))
    const history = whatWorked(hq?.pos?.tickets || [])
    setWorked(history)
    setIdeas(birthdayIdeas({ cast, partners, guests, worked: history }))
    setEvents(teamRes.events || [])
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    load().catch(e => { if (!cancelled) setErr(errText(e)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bar?.id])

  async function decide(idea, status, data) {
    setBusy(true)
    setErr('')
    const res = await staffFetch('/api/bar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveEvent',
        id: idea.id,
        titulo: idea.titulo,
        data: data || idea.data,
        origem: idea.origem,
        pessoa_id: idea.pessoa_id,
        pessoa_nome: idea.pessoa_nome,
        nota: idea.nota,
        status,
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) setErr(errText(json.error))
    else await load()
    setBusy(false)
  }

  if (loading) return <Spinner />
  const decided = new Set(events.filter(e => e.status === 'confirmado' || e.status === 'descartado').map(e => e.id))
  const openIdeas = ideas.filter(i => !decided.has(i.id))
  const confirmed = events.filter(e => e.status === 'confirmado').sort((a, b) => String(a.data).localeCompare(String(b.data)))

  return (
    <div className="fade-in house-page">
      <h1>{t('portal.events.title')}</h1>
      <p className="house-lead">{t('portal.events.lead')}</p>
      {err && <div className="pos-sale-err">{asReactText(err)}</div>}

      <section className="house-block">
        <h2>{t('portal.events.worked')}</h2>
        {!worked?.nights && <div className="house-empty">{t('portal.events.noHistory')}</div>}
        {!!worked?.nights && (
          <div className="event-facts">
            {worked.bestDays.map(d => (
              <div key={d.label}><span>{t('portal.events.bestDay')}</span><strong>{d.label}</strong><em>{fmtYen(d.avg)}</em></div>
            ))}
            {worked.peakHours.map(h => (
              <div key={h.label}><span>{t('portal.events.peak')}</span><strong>{h.label}</strong><em>{fmtYen(h.total)}</em></div>
            ))}
            {worked.topCast.map(c => (
              <div key={c.nome}><span>{t('portal.events.cast')}</span><strong>{c.nome}</strong><em>{fmtYen(c.sales)}</em></div>
            ))}
          </div>
        )}
      </section>

      <section className="house-block">
        <h2>{t('portal.events.decide')}</h2>
        <p>{t('portal.events.decideLead')}</p>
        {!openIdeas.length && <div className="house-empty">{t('portal.events.noIdeas')}</div>}
        {openIdeas.map(idea => (
          <IdeaCard key={idea.id} idea={idea} busy={busy} onDecide={decide} />
        ))}
      </section>

      <section className="house-block">
        <h2>{t('portal.events.confirmed')}</h2>
        {!confirmed.length && <div className="house-empty">{t('portal.events.noneYet')}</div>}
        {confirmed.map(ev => (
          <div key={ev.id} className="house-card">
            <div>
              <strong>{ev.titulo}</strong>
              <div className="house-meta">{ev.data} · {t(`portal.events.origin.${ev.origem || 'cast'}`)}</div>
              {ev.nota && <div className="house-meta">{ev.nota}</div>}
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}

function IdeaCard({ idea, busy, onDecide }) {
  const { t } = useI18n()
  const [data, setData] = useState(idea.data)
  return (
    <div className="event-idea">
      <div>
        <strong>{idea.titulo}</strong>
        <div className="house-meta">{t(`portal.events.origin.${idea.origem}`)} · {t('portal.events.birthdayOn')} {idea.aniversario}</div>
        <p>{idea.nota}</p>
      </div>
      <label>{t('portal.events.when')}
        <input type="date" value={data} onChange={e => setData(e.target.value)} />
      </label>
      <div className="house-actions">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => onDecide(idea, 'confirmado', data)}>{t('portal.events.confirm')}</button>
        <button type="button" className="house-text" disabled={busy} onClick={() => onDecide(idea, 'descartado', data)}>{t('portal.events.drop')}</button>
      </div>
    </div>
  )
}
