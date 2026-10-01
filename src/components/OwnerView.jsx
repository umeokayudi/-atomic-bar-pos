/** Plain-language owner summary. Uses the same analyze() result as Manager Pro. */

import { useMemo, useState } from 'react'
import { fmtYen } from './utils'
import { isLocalDemo } from '../lib/supabase'
import { analyze } from '../lib/managerAnalytics'
import { tokyoNightKey } from '../lib/tokyo'

function yen(value) {
  if (value == null) return '—'
  return fmtYen(value)
}

function sentence(report) {
  if (report.current.sales == null) {
    return 'Sales for this operational night are not available. Nothing is shown as zero.'
  }
  if (report.salesChange.pct == null) {
    return `Recorded sales are ${yen(report.current.sales)}. A percentage is omitted because the comparison baseline is missing or zero.`
  }
  const direction = report.salesChange.pct >= 0 ? 'higher' : 'lower'
  return `Recorded sales are ${yen(report.current.sales)}, ${Math.abs(report.salesChange.pct)}% ${direction} than the previous equivalent night.`
}

export default function OwnerView({ bar, tickets = [], people = [], goals, registry = [], payroll = null, onManage }) {
  const night = tokyoNightKey()
  const [preset, setPreset] = useState('today')
  const report = useMemo(() => analyze({
    tickets,
    people,
    registry,
    payroll: preset === 'thisMonth' ? payroll : null,
    preset,
    nightKey: night,
    compare: 'previous',
    demo: isLocalDemo,
    targetPerNight: goals?.noite || 0,
  }), [tickets, people, registry, payroll, preset, night, goals?.noite])

  return (
    <div className="owner-view">
      <div className="goal-modes">
        {['today', 'thisWeek', 'thisMonth'].map(id => (
          <button key={id} type="button" className={preset === id ? 'is-on' : ''} onClick={() => setPreset(id)}>
            {id === 'today' ? 'Today' : id === 'thisWeek' ? 'This week' : 'This month'}
          </button>
        ))}
      </div>
      <p className="mp-note">{report.range.start} → {report.range.end} · {report.timezone} · {report.operationalDay}</p>
      <section className="panel owner-lead">
        <h2 className="section-title">How the night looks</h2>
        <p>{sentence(report)}</p>
        <p className="mp-note">{bar?.nome || 'This bar'}. Compared with {report.compareTo.start} → {report.compareTo.end}.</p>
      </section>
      <div className="mp-kpis">
        <article className="mp-kpi">
          <header><span>Net sales</span></header>
          <strong>{yen(report.current.sales)}</strong>
          <p className="mp-note">Till tickets on the operational night. Not cash in the drawer.</p>
        </article>
        <article className="mp-kpi">
          <header><span>Orders</span></header>
          <strong>{report.current.orders == null ? '—' : report.current.orders}</strong>
          <p className="mp-note">One ticket is one order.</p>
        </article>
        <article className="mp-kpi">
          <header><span>Average ticket</span></header>
          <strong>{yen(report.current.ticket)}</strong>
          <p className="mp-note">Sales divided by orders in the same window.</p>
        </article>
        <article className="mp-kpi">
          <header><span>Gross profit</span></header>
          <strong>—</strong>
          <p className="mp-note">{report.grossProfit.note}</p>
        </article>
      </div>
      <section className="panel">
        <h2 className="section-title">What needs attention</h2>
        {!report.insights.length && <p className="mp-note">No comparison insight. Product cost, labor, and cash variance are not on this screen until those books are loaded.</p>}
        {report.insights.map(note => (
          <article key={note.id} className="mp-insight">
            <p>{note.text}</p>
            <p className="mp-note">{note.source}</p>
          </article>
        ))}
        <p className="mp-note">Operating profit is not shown. Expenses are not complete enough to subtract from sales.</p>
        {!!report.employees.ranked[0] && (
          <p className="mp-note">{report.employees.ranked[0].nome} has the highest attributed sales. Unassigned tickets are excluded. This is not a profit ranking.</p>
        )}
      </section>
      <button type="button" className="action-secondary" onClick={onManage}>Open Manager Pro</button>
    </div>
  )
}
