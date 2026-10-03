/** Manager analytics. Figures come from analyze(); missing costs stay blank. */

import { useEffect, useMemo, useState } from 'react'
import { fmtYen } from './utils'
import { TrendStage } from './experience/Stage'
import { isLocalDemo, supabase } from '../lib/supabase'
import { COMPARE_MODES, PRESETS, analyze } from '../lib/managerAnalytics'
import { addDays } from '../lib/barClose'
import { hourOfSale, nightKeyOfSale } from '../lib/nightClose'
import { tokyoNightKey } from '../lib/tokyo'

const PRESET_LABEL = {
  today: 'Today',
  yesterday: 'Yesterday',
  thisWeek: 'This week',
  lastWeek: 'Last week',
  thisMonth: 'This month',
  lastMonth: 'Last month',
  last30: 'Last 30 days',
  last90: 'Last 90 days',
  custom: 'Custom',
}

const COMPARE_LABEL = {
  previous: 'Previous period',
  weekday: 'Same weekdays, prior week',
  lastMonth: 'Same period last month',
  lastYear: 'Same period last year',
}

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function yen(value) {
  if (value == null) return '—'
  return fmtYen(value)
}

function signedYen(value) {
  if (value == null) return '—'
  if (!value) return fmtYen(0)
  return `${value > 0 ? '+' : '−'}${fmtYen(Math.abs(value))}`
}

function changeLine(change) {
  if (!change || change.abs == null) return 'Comparison unavailable'
  const pct = change.pct == null ? '' : ` · ${change.pct > 0 ? '+' : ''}${change.pct}%`
  return `${signedYen(change.abs)}${pct}`
}

function Kpi({ label, value, change, status }) {
  const ready = status === 'available' || status === 'empty'
  return (
    <article className={`mp-kpi is-${status || 'unavailable'}`}>
      <header>
        <span>{label}</span>
        <em>{ready ? change : 'Not connected'}</em>
      </header>
      <strong>{value}</strong>
    </article>
  )
}

function SalesChart({ points, onPick, active }) {
  const known = points.filter(point => point.sales != null)
  if (!known.length) return null
  const width = 720
  const height = 220
  const pad = 36
  const max = Math.max(...known.map(point => point.sales), 1)
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0
  const y = value => height - 28 - (value / max) * (height - 56)
  const x = index => pad + index * step
  let path = ''
  points.forEach((point, index) => {
    if (point.sales == null) {
      path += ' M '
      return
    }
    const cmd = path.endsWith('M ') || path === '' ? 'M' : 'L'
    path += `${cmd}${x(index)},${y(point.sales)} `
  })
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mp-chart" role="img">
      <line x1={pad} x2={width - pad} y1={height - 28} y2={height - 28} className="mp-axis" />
      <text x={pad} y={16} className="mp-axis-label">{fmtYen(max)}</text>
      <path d={path.trim()} className="mp-line" />
      {points.map((point, index) => point.sales == null ? null : (
        <g key={point.key}>
          <circle
            cx={x(index)}
            cy={y(point.sales)}
            r={active === point.key ? 5 : 3.5}
            className="mp-dot"
            onClick={() => onPick(point)}
          >
            <title>{`${point.label}: ${fmtYen(point.sales)} · ${point.orders ?? 0} orders`}</title>
          </circle>
          {points.length <= 16 && (
            <text x={x(index)} y={height - 10} textAnchor="middle" className="mp-axis-label">{point.label}</text>
          )}
        </g>
      ))}
    </svg>
  )
}

function Bars({ rows, field, onPick }) {
  const max = Math.max(...rows.map(row => row[field] || 0), 1)
  if (!rows.length) return <p className="mp-note">No attributed rows in this range.</p>
  return (
    <div className="mp-bars">
      {rows.slice(0, 8).map(row => (
        <button key={row.id || row.key || row.nome} type="button" className="mp-bar" onClick={() => onPick(row)}>
          <span>{row.nome}</span>
          <i><b style={{ width: `${Math.round(((row[field] || 0) / max) * 100)}%` }} /></i>
          <em>{field === 'orders' ? row.orders : field === 'ticket' ? yen(row.ticket) : yen(row[field])}</em>
        </button>
      ))}
    </div>
  )
}

function Heat({ cells, metric, onPick }) {
  const values = cells.map(cell => (metric === 'orders' ? cell.orders : cell.sales) || 0)
  const max = Math.max(...values, 1)
  return (
    <div className="mp-heat-wrap">
      <div className="mp-heat">
        {cells.map(cell => {
          const value = metric === 'orders' ? cell.orders : cell.sales
          const alpha = value ? 0.12 + (value / max) * 0.88 : 0
          return (
            <button
              key={`${cell.weekday}-${cell.hour}`}
              type="button"
              className="mp-heat-cell"
              style={{ background: alpha ? `rgba(37, 99, 235, ${alpha})` : 'transparent' }}
              title={`${WEEK[cell.weekday]} ${String(cell.hour).padStart(2, '0')}:00 · ${metric === 'orders' ? `${value} orders` : yen(value)}${cell.orders < 3 ? ' · small sample' : ''}`}
              onClick={() => onPick(cell)}
            />
          )
        })}
      </div>
      <p className="mp-note">Rows are Sunday to Saturday. Columns are Tokyo hours. A pale cell is a small sample, not a verdict.</p>
    </div>
  )
}

export default function ManagerPro({ bar, tickets = [], people = [], goals, registry = [], payroll = null }) {
  const night = tokyoNightKey()
  const [preset, setPreset] = useState('today')
  const [compare, setCompare] = useState('previous')
  const [grain, setGrain] = useState('auto')
  const [custom, setCustom] = useState({ start: night, end: night })
  const [heatMetric, setHeatMetric] = useState('sales')
  const [lines, setLines] = useState(null)
  const [lineNote, setLineNote] = useState('')
  const [drill, setDrill] = useState(null)
  const [rank, setRank] = useState('sales')

  useEffect(() => {
    let cancelled = false
    if (isLocalDemo) {
      setLines(null)
      setLineNote('Product lines are not loaded in local demo. Sales rankings are not invented from ticket totals.')
      return undefined
    }
    const ids = (tickets || []).map(row => row.id).filter(Boolean)
    if (!ids.length) {
      setLines([])
      setLineNote('No tickets in the loaded set, so there are no product lines.')
      return undefined
    }
    supabase.from('pos_vendas_itens').select('pos_venda_id,produto_id,nome,qtd,preco_unitario').in('pos_venda_id', ids.slice(0, 200))
      .then(res => {
        if (cancelled) return
        if (res.error) {
          setLines(null)
          setLineNote(res.error.message || 'Product lines could not be read.')
          return
        }
        setLines(res.data || [])
        setLineNote('Unit cost is not on these lines. Profit ranking stays blank.')
      })
      .catch(error => {
        if (!cancelled) {
          setLines(null)
          setLineNote(error.message || 'Product lines could not be read.')
        }
      })
    return () => { cancelled = true }
  }, [bar?.id, tickets])

  const report = useMemo(() => analyze({
    tickets,
    lines,
    people,
    registry,
    payroll: preset === 'thisMonth' || preset === 'lastMonth' ? payroll : null,
    preset,
    nightKey: night,
    custom,
    compare,
    grain,
    demo: isLocalDemo,
    targetPerNight: goals?.noite || 0,
  }), [tickets, lines, people, registry, payroll, preset, night, custom, compare, grain, goals?.noite])

  function pickPoint(point) {
    const rows = (tickets || []).filter(sale => {
      const nightKey = nightKeyOfSale(sale)
      if (!nightKey) return false
      if (report.grain === 'hour') return nightKey === report.range.start && hourOfSale(sale) === +point.key
      if (report.grain === 'day') return nightKey === point.key
      if (report.grain === 'month') return nightKey.startsWith(point.key)
      const weekEnd = addDays(point.key, 6)
      return nightKey >= point.key && nightKey <= weekEnd
    })
    setDrill({
      title: point.label,
      note: point.sales == null ? 'No recorded sales for this point.' : `${yen(point.sales)} · ${point.orders ?? 0} orders`,
      rows,
    })
  }

  function pickEmployee(row) {
    setDrill({
      title: row.nome,
      note: 'Attributed tickets only. Hours and profit are separate books.',
      rows: (tickets || []).filter(sale => sale.drink_back_agent_id === row.id),
    })
  }

  const productRows = rank === 'profit' ? report.products.byProfit : report.products.bySales

  return (
    <div className="manager-pro">
      <div className="mp-filters">
        <div className="goal-modes">
          {PRESETS.map(id => (
            <button key={id} type="button" className={preset === id ? 'is-on' : ''} onClick={() => setPreset(id)}>
              {PRESET_LABEL[id]}
            </button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="mp-custom">
            <label>From <input type="date" value={custom.start} onChange={e => setCustom(prev => ({ ...prev, start: e.target.value }))} /></label>
            <label>To <input type="date" value={custom.end} onChange={e => setCustom(prev => ({ ...prev, end: e.target.value }))} /></label>
          </div>
        )}
        <label className="mp-compare">
          Comparison
          <select value={compare} onChange={e => setCompare(e.target.value)}>
            {COMPARE_MODES.map(id => <option key={id} value={id}>{COMPARE_LABEL[id]}</option>)}
          </select>
        </label>
      </div>
      <p className="work-quiet">{report.range.start} → {report.range.end} · compared with {report.compareTo.start} → {report.compareTo.end}</p>
      <TrendStage
        title="Sales"
        points={(report.timeline || []).map(point => ({ label: point.label, value: point.sales }))}
        caption="Sales are not connected"
      />

      <div className="mp-kpis">
        <Kpi
          label="Net Sales"
          status={report.current.status === 'empty' ? 'empty' : report.current.status}
          value={yen(report.current.sales)}
          previous={yen(report.previous.sales)}
          change={changeLine(report.salesChange)}
          detail="Valid till sales: original total minus one capped refund. A voided ticket stays on record and adds zero."
        />
        <Kpi
          label="Gross Profit"
          status={report.grossProfit.status}
          value={yen(report.grossProfit.amount)}
          previous="—"
          change="—"
          detail={report.grossProfit.note}
        />
        <Kpi
          label="Gross Margin"
          status={report.grossMargin.status}
          value="—"
          previous="—"
          change="—"
          detail="Margin stays blank until profit and the same sales are both recorded."
        />
        <Kpi
          label="Orders"
          status={report.current.status}
          value={report.current.orders == null ? '—' : String(report.current.orders)}
          previous={report.previous.orders == null ? '—' : String(report.previous.orders)}
          change={changeLine(report.ordersChange)}
          detail="One till ticket is one order. An empty loaded range is zero. A missing book is not zero."
        />
        <Kpi
          label="Average Ticket"
          status={report.current.ticket == null ? 'unavailable' : 'available'}
          value={yen(report.current.ticket)}
          previous={yen(report.previous.ticket)}
          change={changeLine(report.ticketChange)}
          detail="Net sales divided by orders in the same range."
        />
        <Kpi
          label="Guests"
          status={report.current.guests == null ? 'unavailable' : 'available'}
          value={report.current.guests == null ? '—' : String(report.current.guests)}
          previous="—"
          change="—"
          detail="Distinct guest ids on the tickets. Missing guest ids are not counted as zero guests."
        />
        <Kpi
          label="Labor Cost"
          status={report.labor.status}
          value={yen(report.labor.amount)}
          previous="—"
          change="—"
          detail={report.labor.note}
        />
        <Kpi
          label="Cash Variance"
          status={report.cashVariance.status}
          value="—"
          previous="—"
          change="—"
          detail={report.cashVariance.note}
        />
      </div>

      {report.timeline.some(point => point.sales != null) && (
      <section className="panel">
        <header className="panel-head">
          <h2 className="section-title">Detail</h2>
          <div className="goal-modes">
            {['auto', 'hour', 'day', 'week', 'month'].map(id => (
              <button key={id} type="button" className={grain === id ? 'is-on' : ''} onClick={() => setGrain(id)}>{id}</button>
            ))}
          </div>
        </header>
        <SalesChart points={report.timeline} onPick={pickPoint} active={drill?.title} />
      </section>
      )}

      {!!report.insights.length && <section className="panel">
        <h2 className="section-title">Observations</h2>
        {report.insights.map(note => (
          <article key={note.id} className="mp-insight">
            <p>{note.text}</p>
            <p className="mp-note">{note.period} · {note.source} · {note.completeness}</p>
          </article>
        ))}
      </section>}

      <section className="panel">
        <header className="panel-head">
          <h2 className="section-title">Products</h2>
          <div className="goal-modes">
            <button type="button" className={rank === 'sales' ? 'is-on' : ''} onClick={() => setRank('sales')}>Sales</button>
            <button type="button" className={rank === 'profit' ? 'is-on' : ''} onClick={() => setRank('profit')} disabled={!report.products.profitReady}>Profit</button>
          </div>
        </header>
        <p className="mp-note">{lineNote}</p>
        {!productRows.length && <p className="work-quiet">Product ranking is not connected.</p>}
        {!!productRows.length && (
          <div className="mp-table">
            {productRows.slice(0, 8).map(row => (
              <div key={row.key} className="mp-row">
                <strong>{row.nome}</strong>
                <span>{row.units} units</span>
                <span>{yen(row.sales)}</span>
                <span>{row.profit == null ? 'Profit —' : yen(row.profit)}</span>
                <span>{row.margin == null ? 'Margin —' : `${row.margin}%`}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2 className="section-title">Attributed sales</h2>
        <p className="mp-note">Only tickets linked to a person. {report.employees.unassigned} ticket{report.employees.unassigned === 1 ? '' : 's'} stay unassigned and are left out of the ranking.</p>
        <Bars rows={report.employees.ranked} field="sales" onPick={pickEmployee} />
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2 className="section-title">Weekday and hour</h2>
          <div className="goal-modes">
            <button type="button" className={heatMetric === 'sales' ? 'is-on' : ''} onClick={() => setHeatMetric('sales')}>Sales</button>
            <button type="button" className={heatMetric === 'orders' ? 'is-on' : ''} onClick={() => setHeatMetric('orders')}>Orders</button>
          </div>
        </header>
        {report.current.status === 'unavailable' && <p className="mp-note">Hour and weekday charts stay blank until tickets are loaded. A quiet hour is not filled in as zero.</p>}
        {report.current.status !== 'unavailable' && (
        <div className="mp-week">
          {report.weekdays.map(day => (
            <div key={day.weekday}>
              <span>{WEEK[day.weekday]}</span>
              <strong>{yen(day.sales)}</strong>
              <em>{day.orders} orders</em>
            </div>
          ))}
        </div>
        )}
        {report.current.status !== 'unavailable' && (
          <Heat
            cells={report.heatmap.cells}
            metric={heatMetric}
            onPick={cell => setDrill({
              title: `${WEEK[cell.weekday]} ${String(cell.hour).padStart(2, '0')}:00`,
              note: `${yen(cell.sales)} · ${cell.orders} orders. Profit is not on this grid.`,
              rows: [],
            })}
          />
        )}
        {report.heatmap.undated > 0 && (
          <p className="mp-note">{report.heatmap.undated} tickets have no clock time and are excluded from the heatmap.</p>
        )}
      </section>

      <section className="panel">
        <h2 className="section-title">Payments and costs</h2>
        {!report.payments && <p className="mp-note">Payment mix is unavailable until sales are loaded.</p>}
        {report.payments && (
          <ul className="mp-pay">
            <li>Cash {yen(report.payments.tender.cash)}</li>
            <li>Card {yen(report.payments.tender.card)}</li>
            <li>PayPay {yen(report.payments.tender.paypay)}</li>
            <li>Other {yen(report.payments.tender.other)}</li>
          </ul>
        )}
        <p className="mp-note">Refunds, discounts, and card fees are not calculated here. A fee is omitted unless the card plan is applied on the cash screen.</p>
        {!report.expenses.length && <p className="mp-note">No registered operating amounts for {report.range.end.slice(0, 7)}.</p>}
        {report.expenses.map(row => (
          <p key={`${row.kind}-${row.month}`} className="mp-note">{row.kind}: {yen(row.amount)}. {row.note}</p>
        ))}
      </section>

      {drill && (
        <aside className="panel mp-drill">
          <header className="panel-head">
            <h2 className="section-title">{drill.title}</h2>
            <button type="button" className="house-text" onClick={() => setDrill(null)}>Close</button>
          </header>
          <p className="mp-note">{drill.note}</p>
          {!drill.rows.length && <p className="mp-note">No ticket rows were attached to this point.</p>}
          {drill.rows.slice(0, 12).map(sale => (
            <div key={sale.id || sale.criado_em} className="mp-row">
              <strong>{yen(sale.total)}</strong>
              <span>{sale.metodo_pagamento || 'Payment not stored'}</span>
              <span>{String(sale.criado_em || sale.data || '').slice(0, 16)}</span>
            </div>
          ))}
        </aside>
      )}
    </div>
  )
}
