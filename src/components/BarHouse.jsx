import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, Spinner } from './utils'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'
import { tokyoMonthKey } from '../lib/tokyo'
import { fetchHqSnapshot, saveBarCost } from '../lib/hqSnapshot'
import { readTicketMeta } from '../lib/nightTicket'
import BarTeamTab from './BarTeamTab'

function HouseCosts({ month, overhead, busy, onSave }) {
  const { t } = useI18n()
  const [fixedName, setFixedName] = useState('')
  const [fixedAmount, setFixedAmount] = useState('')
  const [varName, setVarName] = useState('')
  const [varAmount, setVarAmount] = useState('')
  const fixed = overhead?.fixed || []
  const variable = overhead?.variable || []

  async function add(kind, name, amount, clear) {
    const label = String(name || '').trim()
    if (!label) return
    try {
      await onSave({ kind, name: label, amount: +amount || 0, month_key: month })
      clear()
    } catch {
      /* parent shows the error */
    }
  }

  return (
    <div>
      <div className="hq-kpis">
        <div><b>{fmtYen(overhead?.fixedTotal || 0)}</b><span>{t('portal.costs.fixedTotal')}</span></div>
        <div><b>{fmtYen(overhead?.variableTotal || 0)}</b><span>{t('portal.costs.variableTotal')}</span></div>
      </div>
      <div className="hq-panel-title" style={{ marginTop: 12 }}>{t('portal.costs.fixedTitle')}</div>
      <div className="hq-panel-hint">{t('house.fixedBody')}</div>
      {fixed.map(r => (
        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
          <span>{r.note}</span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <strong>{fmtYen(r.amount)}</strong>
            <button type="button" className="hq-chip" disabled={busy} onClick={() => onSave({ action: 'delete', id: r.id, month_key: month })}>{t('portal.costs.removeCost')}</button>
          </span>
        </div>
      ))}
      <div className="hq-rent-row">
        <label>{t('portal.costs.costName')}<input value={fixedName} onChange={e => setFixedName(e.target.value)} /></label>
        <label>{t('portal.costs.costAmount')}<input type="number" min="0" step="100" value={fixedAmount} onChange={e => setFixedAmount(e.target.value)} /></label>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => add('fixo', fixedName, fixedAmount, () => { setFixedName(''); setFixedAmount('') })}>{t('portal.costs.addCost')}</button>
      </div>
      <div className="hq-panel-title" style={{ marginTop: 16 }}>{t('portal.costs.variableTitle')}</div>
      <div className="hq-panel-hint">{t('house.variableBody')}</div>
      {variable.map(r => (
        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
          <span>{r.note}</span>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <strong>{fmtYen(r.amount)}</strong>
            <button type="button" className="hq-chip" disabled={busy} onClick={() => onSave({ action: 'delete', id: r.id, month_key: month })}>{t('portal.costs.removeCost')}</button>
          </span>
        </div>
      ))}
      <div className="hq-rent-row">
        <label>{t('portal.costs.costName')}<input value={varName} onChange={e => setVarName(e.target.value)} /></label>
        <label>{t('portal.costs.costAmount')}<input type="number" min="0" step="100" value={varAmount} onChange={e => setVarAmount(e.target.value)} /></label>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => add('variavel', varName, varAmount, () => { setVarName(''); setVarAmount('') })}>{t('portal.costs.addCost')}</button>
      </div>
    </div>
  )
}

function BottleCommissions({ bar }) {
  const { t } = useI18n()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('pos_vendas').select('id,data,total,obs,drink_back_agent_id,criado_em').eq('bar_id', bar.id).order('criado_em', { ascending: false }).limit(40),
      supabase.from('drink_back_agents').select('id,nome,comissao_pct,ativo').eq('bar_id', bar.id),
    ]).then(([sales, agents]) => {
      if (cancelled) return
      const byId = Object.fromEntries((agents.data || []).map(a => [a.id, a]))
      const list = (sales.data || []).map(s => {
        const meta = readTicketMeta(s.obs)
        const agent = byId[s.drink_back_agent_id]
        return {
          id: s.id,
          data: s.data,
          nome: agent?.nome || meta.details || '',
          amount: meta.commission,
          pct: agent?.comissao_pct,
        }
      }).filter(r => r.amount != null)
      setRows(list)
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bar.id])

  if (loading) return <Spinner />
  if (!rows.length) return <div className="hq-empty">{t('house.noCommission')}</div>
  return (
    <div>
      {rows.map(r => (
        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
          <span>{r.data} · {r.nome || t('house.cast')}{r.pct != null ? ` · ${r.pct}%` : ''}</span>
          <strong>{fmtYen(r.amount)}</strong>
        </div>
      ))}
    </div>
  )
}

export default function BarHouseTab({ bar, onTab }) {
  const { t } = useI18n()
  const [month, setMonth] = useState(tokyoMonthKey())
  const [overhead, setOverhead] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function load(mes = month) {
    try {
      const snap = await fetchHqSnapshot(mes, { fresh: true })
      setOverhead(snap.overhead || { fixed: [], variable: [], fixedTotal: 0, variableTotal: 0 })
    } catch (e) {
      setErr(errText(e))
    }
  }

  useEffect(() => { load(month) }, [bar.id, month])

  return (
    <div className="fade-in portal-page">
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 6 }}>{t('house.title')}</div>
      <p style={{ fontSize: 14, color: 'var(--text2)', maxWidth: 640, lineHeight: 1.5, marginBottom: 18 }}>{t('house.lead')}</p>
      {err && <div className="pos-sale-err" style={{ marginBottom: 12 }}>{asReactText(err)}</div>}

      <section className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>{t('house.staffTitle')}</div>
        <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 12 }}>{t('house.staffBody')}</p>
        <BarTeamTab bar={bar} embedded />
      </section>

      <section className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>{t('house.bottleTitle')}</div>
        <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 12 }}>{t('house.bottleBody')}</p>
        <button type="button" className="btn-primary" style={{ marginBottom: 12 }} onClick={() => onTab?.('pos')}>{t('house.openTill')}</button>
        <BottleCommissions bar={bar} />
      </section>

      <section className="card">
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6 }}>{t('house.costsTitle')}</div>
        <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 12 }}>{t('house.costsBody')}</p>
        <label style={{ fontSize: 12, color: 'var(--text2)' }}>
          {t('house.month')}
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ marginLeft: 8 }} />
        </label>
        <HouseCosts
          month={month}
          overhead={overhead}
          busy={busy}
          onSave={async (cost) => {
            setBusy(true)
            setErr('')
            try {
              const snap = await saveBarCost({ ...cost, month_key: cost.month_key || month })
              setOverhead(snap.overhead || null)
            } catch (e) {
              setErr(errText(e))
              setBusy(false)
              throw e
            }
            setBusy(false)
          }}
        />
      </section>
    </div>
  )
}
