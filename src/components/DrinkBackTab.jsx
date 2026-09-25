import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, Spinner, SectionTitle } from './utils'
import { useI18n } from '../lib/i18n'
import { tokyoMonthKey } from '../lib/tokyo'

export default function DrinkBackTab({ bar }) {
  const { t } = useI18n()
  const [agents, setAgents] = useState([])
  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [form, setForm] = useState({ nome: '', regiao: '', comissao_pct: '10', notas: '' })
  const month = tokyoMonthKey()

  useEffect(() => { load() }, [bar?.id])

  async function load() {
    setLoading(true)
    setErr('')
    const [aR, sR] = await Promise.all([
      supabase.from('drink_back_agents').select('*').eq('bar_id', bar.id).order('nome'),
      supabase.from('pos_vendas').select('id,total,drink_back_agent_id,data').eq('bar_id', bar.id).gte('data', `${month}-01`).not('drink_back_agent_id', 'is', null),
    ])
    if (aR.error) setErr(aR.error.message)
    setAgents(aR.data || [])
    setSales(sR.error ? [] : (sR.data || []))
    setLoading(false)
  }

  async function saveAgent() {
    if (!form.nome.trim()) return
    setSaving(true)
    setErr('')
    const row = {
      bar_id: bar.id,
      nome: form.nome.trim(),
      regiao: form.regiao.trim() || null,
      comissao_pct: +form.comissao_pct || 0,
      notas: form.notas.trim() || null,
      ativo: true,
    }
    let { error } = await supabase.from('drink_back_agents').insert(row)
    if (error && /regiao|notas/.test(error.message || '')) {
      const slim = { bar_id: bar.id, nome: row.nome, comissao_pct: row.comissao_pct, ativo: true }
      ;({ error } = await supabase.from('drink_back_agents').insert(slim))
    }
    if (error) setErr(error.message)
    else setForm({ nome: '', regiao: '', comissao_pct: '10', notas: '' })
    setSaving(false)
    load()
  }

  async function toggleAgent(agent) {
    await supabase.from('drink_back_agents').update({ ativo: !agent.ativo }).eq('id', agent.id)
    load()
  }

  if (loading) return <Spinner text={t('house.drinkBackTitle')} />

  const rows = agents.map(agent => {
    const mine = sales.filter(s => s.drink_back_agent_id === agent.id)
    const revenue = mine.reduce((sum, s) => sum + (+s.total || 0), 0)
    const commission = Math.round(revenue * (+agent.comissao_pct || 0) / 100)
    return { ...agent, tickets: mine.length, revenue, commission }
  })
  const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0)
  const totalCommission = rows.reduce((sum, r) => sum + r.commission, 0)

  return (
    <div className="fade-in house-page">
      <SectionTitle sub={t('house.drinkBackBody')}>{t('house.drinkBackTitle')}</SectionTitle>
      {err && <div className="pos-sale-err">{err}</div>}
      <div className="vip-room-card is-total" style={{ marginBottom: 14 }}>
        <h3>{month}</h3>
        <div><span>{t('house.drinkSales')}</span><b>{fmtYen(totalRevenue)}</b></div>
        <div><span>{t('house.drinkCommission')}</span><b>{fmtYen(totalCommission)}</b></div>
      </div>
      <div className="house-editor">
        <label>{t('house.name')}
          <input value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} />
        </label>
        <label>{t('house.positioning')}
          <input value={form.regiao} onChange={e => setForm({ ...form, regiao: e.target.value })} />
        </label>
        <label>{t('house.drinkPct')}
          <input type="number" min="0" value={form.comissao_pct} onChange={e => setForm({ ...form, comissao_pct: e.target.value })} />
        </label>
        <label className="house-span">{t('house.notes')}
          <input value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} />
        </label>
        <div className="house-actions">
          <button type="button" className="btn-primary" disabled={saving || !form.nome.trim()} onClick={saveAgent}>{t('house.add')}</button>
        </div>
      </div>
      {!rows.length && <div className="house-empty">{t('house.drinkEmpty')}</div>}
      {rows.map(agent => (
        <div key={agent.id} className="house-card" style={{ opacity: agent.ativo ? 1 : 0.55 }}>
          <div>
            <strong>{agent.nome}</strong>
            <div className="house-meta">
              {[agent.regiao, `${agent.comissao_pct || 0}%`].filter(Boolean).join(' · ')}
            </div>
            <div className="house-meta">
              {t('house.drinkMonthLine', { count: agent.tickets, sales: fmtYen(agent.revenue), commission: fmtYen(agent.commission) })}
            </div>
            {agent.notas && <div className="house-meta">{agent.notas}</div>}
          </div>
          <div className="house-actions">
            <button type="button" className="house-text" onClick={() => toggleAgent(agent)}>
              {agent.ativo ? t('house.drinkOff') : t('house.drinkOn')}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
