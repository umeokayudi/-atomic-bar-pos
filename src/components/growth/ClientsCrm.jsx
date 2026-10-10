import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useI18n } from '../../lib/i18n'
import { useAiPageContext } from '../../lib/aiPanel'
import { buildClientRows, clientSignals, isoDay, addDays, sortClientRows } from '../../lib/growth'
import { filterSupplierVendas, fmtYen } from '../utils'
import Icon from '../ui/Icon'

const WINDOWS = [30, 90]

/** HQ view of client bars: what they buy, what they owe, who went quiet. All numbers come from vendas/faturas/pedidos. */
export default function ClientsCrm({ onNav }) {
  const { t } = useI18n()
  const [days, setDays] = useState(90)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('revenue')
  const [onlySignals, setOnlySignals] = useState(false)

  useEffect(() => {
    let alive = true
    setError('')
    const today = isoDay(new Date())
    const from = addDays(today, -(2 * days - 1))
    Promise.all([
      supabase.from('bars').select('id,nome,cor').order('nome'),
      supabase.from('vendas').select('id,bar_id,total,data,data_venda,obs,cast_id,criado_em').gte('data', from).limit(10000),
      supabase.from('faturas').select('id,bar_id,total,valor,pago,status,vencimento,data_vencimento'),
      supabase.from('pedidos').select('id,bar_id,status,data_pedido').order('data_pedido', { ascending: false }).limit(2000),
    ]).then(([b, v, f, p]) => {
      if (!alive) return
      const err = b.error || v.error || f.error || p.error
      if (err) { setError(err.message); return }
      setData({ bars: b.data || [], sales: filterSupplierVendas(v.data), invoices: f.data || [], orders: p.data || [], today })
    })
    return () => { alive = false }
  }, [days])

  const rows = useMemo(() => (data ? buildClientRows({ ...data, days }) : []), [data, days])
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return sortClientRows(rows.filter(r => (!needle || String(r.nome).toLowerCase().includes(needle))
      && (!onlySignals || clientSignals(r).length > 0)), sort)
  }, [rows, q, sort, onlySignals])

  const totals = useMemo(() => rows.reduce((a, r) => ({
    revenue: a.revenue + r.revenue, receivable: a.receivable + r.receivable, overdue: a.overdue + r.overdue,
    attention: a.attention + (clientSignals(r).length ? 1 : 0),
  }), { revenue: 0, receivable: 0, overdue: 0, attention: 0 }), [rows])

  useAiPageContext('crm', {
    module: 'crm',
    title: t('nav.crm'),
    period: t('ai.lastDays', { n: days }),
    days,
    filters: { search: q, sort, attentionOnly: onlySignals ? 'yes' : '' },
    kpis: data ? [
      { label: t('growth.kpiRevenue', { n: days }), value: fmtYen(totals.revenue) },
      { label: t('growth.kpiReceivable'), value: fmtYen(totals.receivable) },
      { label: t('growth.kpiOverdue'), value: fmtYen(totals.overdue) },
      { label: t('growth.kpiAttention'), value: totals.attention },
    ] : [],
  })

  return (
    <div className="fade-in growth-page">
      <div className="ui-pagebar">
        <div>
          <div className="ui-pagebar-title">{t('nav.crm')}</div>
          <div className="ui-card-sub">{t('growth.crmSub')}</div>
        </div>
        <div className="ui-seg" role="radiogroup" aria-label={t('ai.period')}>
          {WINDOWS.map(n => (
            <button key={n} type="button" role="radio" aria-checked={days === n} onClick={() => setDays(n)}>{t('ai.daysShort', { n })}</button>
          ))}
        </div>
      </div>

      {error && <div className="ui-error" role="alert"><Icon name="warning" />{t('growth.loadError', { error })}</div>}

      <div className="ui-grid cols-4">
        <Kpi icon="sales" label={t('growth.kpiRevenue', { n: days })} value={data ? fmtYen(totals.revenue) : null} />
        <Kpi icon="faturas" label={t('growth.kpiReceivable')} value={data ? fmtYen(totals.receivable) : null} />
        <Kpi icon="warning" label={t('growth.kpiOverdue')} value={data ? fmtYen(totals.overdue) : null} tone={totals.overdue > 0 ? 'danger' : ''} />
        <Kpi icon="crm" label={t('growth.kpiAttention')} value={data ? String(totals.attention) : null} />
      </div>

      <section className="ui-card">
        <div className="ui-card-head growth-toolbar">
          <label className="ui-field growth-search">
            <span className="ui-sr">{t('common.search')}</span>
            <Icon name="search" size={16} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('growth.searchBars')} />
          </label>
          <label className="ui-field">
            <span className="ui-sr">{t('growth.sortBy')}</span>
            <select value={sort} onChange={e => setSort(e.target.value)}>
              <option value="revenue">{t('growth.sortRevenue')}</option>
              <option value="growthPct">{t('growth.sortGrowth')}</option>
              <option value="overdue">{t('growth.sortOverdue')}</option>
              <option value="quiet">{t('growth.sortQuiet')}</option>
              <option value="name">{t('growth.sortName')}</option>
            </select>
          </label>
          <label className="growth-check">
            <input type="checkbox" checked={onlySignals} onChange={e => setOnlySignals(e.target.checked)} /> {t('growth.onlyAttention')}
          </label>
        </div>

        {!data && !error && <div className="ui-skel" style={{ height: 160 }} />}
        {data && visible.length === 0 && (
          <div className="ui-empty"><Icon name="crm" size={22} /><div className="ui-empty-title">{t('growth.noClients')}</div></div>
        )}
        {data && visible.length > 0 && (
          <table className="ui-table is-stack">
            <thead>
              <tr>
                <th>{t('common.bar')}</th>
                <th className="num">{t('growth.colRevenue', { n: days })}</th>
                <th className="num">{t('growth.colGrowth')}</th>
                <th>{t('growth.colLastOrder')}</th>
                <th className="num">{t('growth.colReceivable')}</th>
                <th>{t('growth.colSignals')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => {
                const signals = clientSignals(r)
                return (
                  <tr key={r.id}>
                    <td data-label={t('common.bar')}><span className="growth-dot" style={{ background: r.cor || 'var(--c-accent)' }} />{r.nome}</td>
                    <td data-label={t('growth.colRevenue', { n: days })} className="num">{fmtYen(r.revenue)}<div className="ui-muted">{t('growth.salesCount', { n: r.salesCount })}</div></td>
                    <td data-label={t('growth.colGrowth')} className="num">
                      {r.growthPct == null ? <span className="ui-muted">{t('growth.noBase')}</span>
                        : <span className={r.growthPct < 0 ? 'txt-danger' : 'txt-success'}>{r.growthPct > 0 ? '+' : ''}{r.growthPct}%</span>}
                    </td>
                    <td data-label={t('growth.colLastOrder')}>
                      {r.lastOrder ? <>{r.lastOrder}<div className="ui-muted">{t('growth.daysAgo', { n: r.daysSinceOrder })}</div></> : <span className="ui-muted">{t('growth.never')}</span>}
                    </td>
                    <td data-label={t('growth.colReceivable')} className="num">
                      {fmtYen(r.receivable)}
                      {r.overdue > 0 && <div className="txt-danger">{t('growth.overdueAmt', { amount: fmtYen(r.overdue) })}</div>}
                    </td>
                    <td data-label={t('growth.colSignals')}>
                      <div className="ui-row">
                        {signals.length === 0 && <span className="ui-badge is-success">{t('growth.sigOk')}</span>}
                        {signals.map(s => <span key={s} className={`ui-badge ${s === 'overdue' ? 'is-danger' : 'is-warning'}`}>{t(`growth.sig.${s}`)}</span>)}
                        {r.overdue > 0 && onNav && (
                          <button type="button" className="ui-btn is-ghost is-sm" onClick={() => onNav('faturas')}>{t('growth.openInvoices')}</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <p className="growth-formula"><Icon name="info" size={14} /> {t('growth.crmFormula', { n: days })}</p>
      </section>
    </div>
  )
}

export function Kpi({ icon, label, value, tone = '', sub }) {
  return (
    <div className={`ui-kpi${tone ? ` is-${tone}` : ''}`}>
      <span className="ui-kpi-icon"><Icon name={icon} size={18} /></span>
      <div>
        <div className="ui-kpi-label">{label}</div>
        {value == null ? <div className="ui-skel" style={{ height: 22, width: 90 }} /> : <div className="ui-kpi-value">{value}</div>}
        {sub && <div className="ui-muted">{sub}</div>}
      </div>
    </div>
  )
}
