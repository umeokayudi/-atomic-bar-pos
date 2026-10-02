import { useEffect, useState } from 'react'
import { fmtYen } from '../utils'
import { MetricTile, SignalBoard, TrendStage } from '../experience/Stage'
import {
  ANNEX_BAR_ID,
  DEMO_BAR_ID,
  advanceOrder,
  closeRegister,
  confirmOrder,
  createPurchaseRequest,
  openRegister,
  periodReport,
  punch,
  recordMovement,
  rejectOrder,
  snapshot,
  submitRequest,
  subscribeLedger,
} from '../../lib/demoLedger'

function useLedger() {
  const [snap, setSnap] = useState(() => snapshot())
  useEffect(() => subscribeLedger(setSnap), [])
  return snap
}

function Bars({ title, points }) {
  const max = Math.max(...points.map(point => Number(point.value) || 0), 1)
  return (
    <figure className="ai-figure demo-panel">
      <figcaption>{title}</figcaption>
      <ul className="ai-bars">
        {points.map(point => (
          <li key={point.label}>
            <span>{point.label}</span>
            <i><b style={{ width: `${Math.max(4, (Number(point.value) / max) * 100)}%` }} /></i>
            <em>{point.display || (point.value > 999 ? fmtYen(point.value) : point.value)}</em>
          </li>
        ))}
      </ul>
    </figure>
  )
}

function shiftNight(night, days) {
  const [year, month, day] = night.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

function openAtomicBar() {
  try {
    const raw = JSON.parse(localStorage.getItem('atomic-bar-local-demo') || '{}')
    if (raw.perfis?.[0]) {
      raw.perfis[0].role = 'gerente'
      raw.perfis[0].bar_id = DEMO_BAR_ID
    }
    localStorage.setItem('atomic-bar-local-demo', JSON.stringify(raw))
  } catch { /* local role switch only */ }
  window.location.reload()
}

export function DemoToday({ onTab, onNav, venue = 'Atomic Bar', embedded = false }) {
  const snap = useLedger()
  const [preset, setPreset] = useState('today')
  const [custom, setCustom] = useState({ from: snap.night, to: snap.night })
  const range = preset === '7'
    ? { from: shiftNight(snap.night, -6), to: snap.night }
    : preset === '30'
      ? { from: shiftNight(snap.night, -29), to: snap.night }
      : preset === 'custom'
        ? custom
        : { from: snap.night, to: snap.night }
  const report = periodReport({ ...range, barId: DEMO_BAR_ID })
  const annex = periodReport({ ...range, barId: ANNEX_BAR_ID })
  const cmv = report.cmv == null ? '—' : `${(report.cmv * 100).toFixed(1)}%`
  const money = value => (value == null ? '—' : fmtYen(value))
  const go = id => (onTab || onNav)?.(id)
  const cashLabel = snap.cash.status === 'open' ? fmtYen(snap.cash.expected) : (snap.cash.lastClose ? fmtYen(snap.cash.lastClose.variance) : '—')
  return (
    <div className="work">
      <header className="work-head">
        <div>
          <p className="eyebrow">DEMO · {venue}</p>
          {!embedded && <h1 className="page-title">{preset === 'today' ? 'Today' : 'Performance'}</h1>}
        </div>
        <div className="work-actions">
          {onTab && <button type="button" className="action-primary" onClick={() => go('pos')}>Point of Sale</button>}
          {onTab && <button type="button" className="action-secondary" onClick={() => go('fechamento')}>Cash</button>}
          {onTab && <button type="button" className="action-secondary" onClick={() => go('estoque')}>Stock</button>}
          {onNav && <button type="button" className="action-secondary" onClick={() => go('cashflow')}>Cash</button>}
        </div>
      </header>
      <div className="demo-actions" role="tablist" aria-label="Period">
        {[['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['custom', 'Custom']].map(([id, label]) => (
          <button key={id} type="button" className={preset === id ? 'action-primary' : 'action-secondary'} onClick={() => setPreset(id)}>{label}</button>
        ))}
        {preset === 'custom' && (
          <>
            <input aria-label="From" type="date" value={custom.from} onChange={event => setCustom(current => ({ ...current, from: event.target.value }))} />
            <input aria-label="To" type="date" value={custom.to} onChange={event => setCustom(current => ({ ...current, to: event.target.value }))} />
          </>
        )}
      </div>
      <p className="work-quiet">Fictional DEMO books. {report.reason || `${report.from} to ${report.to}.`}</p>
      <div className="work-metrics">
        <MetricTile label="Revenue" value={money(report.sales)} />
        <MetricTile label="Gross profit" value={money(report.gross)} />
        <MetricTile label="CMV" value={cmv} />
        <MetricTile label="Labor this month" value={fmtYen(snap.month.labor)} />
        <MetricTile label={snap.cash.status === 'open' ? 'Cash expected' : 'Cash variance'} value={cashLabel} />
      </div>
      <div className="work-stage">
        <TrendStage title="Sales trend" points={report.trend || snap.trend} caption={report.reason || 'DEMO nights'} />
        <SignalBoard title="Attention" items={snap.attention} />
      </div>
      <div className="demo-panel">
        <h2>Venues</h2>
        <table className="demo-table">
          <thead><tr><th>Bar</th><th>Revenue</th><th></th></tr></thead>
          <tbody>
            <tr>
              <td>Atomic Bar</td>
              <td>{money(report.sales)}</td>
              <td><button type="button" className="action-primary" onClick={openAtomicBar}>Open bar</button></td>
            </tr>
            <tr>
              <td>南青山デモ</td>
              <td>{money(annex.sales)}</td>
              <td>Comparison only. The floor stays on Atomic Bar.</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="demo-charts">
        <Bars
          title="Revenue versus costs this month"
          points={[
            { label: 'Revenue', value: snap.month.sales },
            { label: 'CMV', value: snap.month.cogs },
            { label: 'Labor', value: snap.month.labor },
          ]}
        />
        <Bars title="Product performance" points={snap.ranking.map(row => ({ label: row.nome, value: row.gross }))} />
        <Bars title="Payment distribution" points={Object.entries(snap.payments).map(([label, value]) => ({ label, value }))} />
        <Bars title="Labor cost" points={snap.staff.map(person => ({ label: person.name, value: person.earnings }))} />
        <Bars
          title="Stock alerts"
          points={snap.products.map(row => ({
            label: row.nome,
            value: row.stock,
            display: `${row.stock} / ${row.min}`,
          }))}
        />
      </div>
    </div>
  )
}

export function DemoCash() {
  const snap = useLedger()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [counted, setCounted] = useState('')
  const [float, setFloat] = useState('50000')
  const [message, setMessage] = useState('')
  const open = snap.cash.status === 'open'

  function run(result) {
    setMessage(result.ok ? '' : result.error)
  }

  return (
    <div className="work">
      <header className="work-head">
        <div>
          <p className="eyebrow">DEMO · Atomic Bar</p>
          <h1 className="page-title">Cash register</h1>
        </div>
      </header>
      <p className="work-quiet">Simulated drawer. Closing it does not write a live shift.</p>
      <div className="work-metrics">
        <MetricTile label="Status" value={open ? 'Open' : 'Closed'} />
        <MetricTile label="Expected cash" value={fmtYen(snap.cash.expected)} />
        <MetricTile label="Float" value={fmtYen(snap.cash.float)} />
        <MetricTile label="Variance" value={snap.cash.lastClose ? fmtYen(snap.cash.lastClose.variance) : '—'} />
      </div>
      {message && <p className="pos-sale-err">{message}</p>}
      <div className="demo-panel">
        {!open && (
          <div className="demo-actions">
            <input aria-label="Opening float" value={float} onChange={event => setFloat(event.target.value)} />
            <button type="button" className="action-primary" onClick={() => run(openRegister(float))}>Open register</button>
          </div>
        )}
        {open && (
          <>
            <div className="demo-actions">
              <input aria-label="Cash amount" value={amount} onChange={event => setAmount(event.target.value)} placeholder="Amount" />
              <input aria-label="Cash note" value={note} onChange={event => setNote(event.target.value)} placeholder="Note" />
              <button type="button" className="action-secondary" onClick={() => run(recordMovement({ direction: 'in', amount, note: note || 'DEMO cash in' }))}>Cash in</button>
              <button type="button" className="action-secondary" onClick={() => run(recordMovement({ direction: 'out', amount, note: note || 'DEMO cash out' }))}>Cash out</button>
            </div>
            <div className="demo-actions">
              <input aria-label="Counted cash" value={counted} onChange={event => setCounted(event.target.value)} placeholder="Counted cash" />
              <button type="button" className="action-primary" onClick={() => run(closeRegister(counted))}>Close and reconcile</button>
            </div>
          </>
        )}
        {snap.cash.lastClose && (
          <p className="work-quiet">Last close counted {fmtYen(snap.cash.lastClose.counted)} against {fmtYen(snap.cash.lastClose.expected)}.</p>
        )}
        <table className="demo-table">
          <thead><tr><th>Movement</th><th>Note</th><th>Amount</th></tr></thead>
          <tbody>
            {snap.cash.movements.map(row => (
              <tr key={row.id}>
                <td>{row.direction === 'in' ? 'In' : 'Out'}</td>
                <td>{row.note}</td>
                <td>{fmtYen(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function DemoInventory() {
  const snap = useLedger()
  const [message, setMessage] = useState('')
  const order = snap.orders.find(row => row.status !== 'delivered') || snap.orders[0]
  const low = snap.products.filter(row => row.stock < row.min)

  return (
    <div className="work">
      <header className="work-head">
        <div>
          <p className="eyebrow">DEMO · Atomic Bar</p>
          <h1 className="page-title">Stock</h1>
        </div>
      </header>
      <p className="work-quiet">Quantities change when a DEMO sale or delivery is recorded.</p>
      {low.length > 0 && (
        <SignalBoard title="Low stock" items={low.map(row => ({ label: row.nome, value: `${row.stock} on hand · reorder ${row.min}` }))} />
      )}
      <table className="demo-table">
        <thead><tr><th>Drink</th><th>Price</th><th>Cost</th><th>On hand</th><th>Reorder at</th></tr></thead>
        <tbody>
          {snap.products.map(row => (
            <tr key={row.id}>
              <td>{row.nome}</td>
              <td>{fmtYen(row.price)}</td>
              <td>{fmtYen(row.cost)}</td>
              <td>{row.stock}</td>
              <td>{row.min}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="demo-panel">
        <h2>Purchase request</h2>
        {message && <p className="work-quiet">{message}</p>}
        {order && (
          <>
            <p className="work-quiet">{order.id} · {order.supplier} · {order.status}</p>
            <ul>
              {order.lines.map(line => (
                <li key={line.drinkId}>{line.nome} · ordered {line.ordered}{line.confirmed != null ? ` · confirmed ${line.confirmed}` : ''}</li>
              ))}
            </ul>
          </>
        )}
        <div className="demo-actions">
          <button type="button" className="action-primary" onClick={() => {
            const result = createPurchaseRequest()
            setMessage(result.created ? 'DEMO request created' : result.ok ? 'DEMO request is already open' : result.error)
          }}>Create purchase request</button>
          {order && order.status !== 'delivered' && (
            <button type="button" className="action-secondary" onClick={() => advanceOrder(order.id)}>Advance status</button>
          )}
        </div>
      </div>
    </div>
  )
}

export function DemoStaff({ section = 'clock' }) {
  const snap = useLedger()
  const me = snap.staff[0]
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const title = {
    shifts: 'My next shift',
    clock: 'Clock',
    goals: 'Requests',
    result: 'Hours worked',
    salary: 'Earnings',
    profile: 'Announcements',
    points: 'Assigned tasks',
  }[section] || 'My shift'
  return (
    <div className="work">
      <header className="work-head">
        <div>
          <p className="eyebrow">DEMO · {me?.name}</p>
          <h1 className="page-title">{title}</h1>
        </div>
      </header>
      <p className="work-quiet">These actions stay in this browser. They do not post a live punch or payroll run.</p>
      {section === 'shifts' && (
        <div className="demo-panel">
          <h2>{me ? `${me.shiftDate} · ${me.shiftStart}–${me.shiftEnd}` : 'No shift'}</h2>
          <p>Atomic Bar floor. Next scheduled DEMO shift.</p>
        </div>
      )}
      {section === 'clock' && (
        <div className="demo-panel">
          <p>{me?.onBreak ? 'On break. End the break before clocking out.' : me?.clockedIn ? 'Clocked in. Start a break or clock out.' : 'Clock in to start this shift.'}</p>
          <div className="demo-actions">
            <button type="button" className="action-primary" disabled={me?.clockedIn} onClick={() => punch('in')}>Clock in</button>
            <button type="button" className="action-secondary" disabled={!me?.clockedIn || me?.onBreak} onClick={() => punch('break_start')}>Start break</button>
            <button type="button" className="action-secondary" disabled={!me?.onBreak} onClick={() => punch('break_end')}>End break</button>
            <button type="button" className="action-secondary" disabled={!me?.clockedIn || me?.onBreak} onClick={() => punch('out')}>Clock out</button>
          </div>
        </div>
      )}
      {section === 'result' && <MetricTile label="Hours" value={me ? me.hours.toFixed(1) : '—'} />}
      {section === 'salary' && (
        <div className="demo-panel">
          <h2>{me ? fmtYen(me.earnings) : '—'}</h2>
          <p>{me ? `${me.hours.toFixed(1)} h × ${fmtYen(me.rate)}` : 'No rate'}. Breaks are excluded from the session.</p>
        </div>
      )}
      {(section === 'points' || section === 'profile') && section === 'points' && (
        <ul>{(me?.tasks || []).map(task => <li key={task}>{task}</li>)}</ul>
      )}
      {section === 'profile' && (
        <ul>{(snap.announcements || []).map(item => <li key={item.id}><strong>{item.title}.</strong> {item.body}</li>)}</ul>
      )}
      {section === 'goals' && (
        <div className="demo-panel">
          <h2>Shift and leave requests</h2>
          {message && <p>{message}</p>}
          <div className="demo-actions">
            <input aria-label="Request note" value={note} onChange={event => setNote(event.target.value)} placeholder="Note" />
            <button type="button" className="action-primary" onClick={() => {
              const result = submitRequest({ kind: 'leave', note, date: snap.night })
              setMessage(result.ok ? 'DEMO request is pending' : result.error)
            }}>Request leave</button>
          </div>
          <ul>{(snap.requests || []).map(item => <li key={item.id}>{item.kind} · {item.status} · {item.note}</li>)}</ul>
        </div>
      )}
      {!['shifts', 'clock', 'result', 'salary', 'points', 'profile', 'goals'].includes(section) && (
        <p className="work-quiet">This section has no DEMO book. Live payroll is not connected, so nothing is shown as zero.</p>
      )}
    </div>
  )
}

export function DemoSupplier() {
  const snap = useLedger()
  const [qty, setQty] = useState({})
  return (
    <div className="work">
      <header className="work-head">
        <div>
          <p className="eyebrow">DEMO · 東京酒販デモ</p>
          <h1 className="page-title">Purchase orders</h1>
        </div>
      </header>
      <p className="work-quiet">Status changes stay in the DEMO ledger. Nothing is sent to a supplier.</p>
      <h2>Pending</h2>
      {snap.orders.every(order => order.status === 'delivered' || order.status === 'rejected') && (
        <p className="work-quiet">No orders are waiting.</p>
      )}
      {snap.orders.filter(order => order.status !== 'delivered' && order.status !== 'rejected').map(order => (
        <article key={order.id} className="demo-panel">
          <h2>{order.id} · {order.status}</h2>
          <p className="work-quiet">{order.supplier}. {order.status === 'pending' ? 'Accept or reject this order.' : order.status === 'confirmed' ? 'Start preparation when the goods are being picked.' : order.status === 'preparing' ? 'Dispatch when the goods leave.' : 'Confirm delivery to receive stock.'}</p>
          {order.lines.map(line => (
            <label key={line.drinkId} className="demo-actions">
              <span>{line.nome} · ordered {line.ordered}</span>
              <input
                aria-label={`${line.nome} confirmed`}
                type="number"
                value={qty[`${order.id}:${line.drinkId}`] ?? line.confirmed ?? line.ordered}
                onChange={event => setQty(current => ({ ...current, [`${order.id}:${line.drinkId}`]: event.target.value }))}
              />
            </label>
          ))}
          <div className="demo-actions">
            {order.status === 'pending' && (
              <>
                <button type="button" className="action-primary" onClick={() => {
                  const quantities = {}
                  for (const line of order.lines) quantities[line.drinkId] = qty[`${order.id}:${line.drinkId}`] ?? line.ordered
                  confirmOrder(order.id, quantities)
                }}>Accept</button>
                <button type="button" className="action-secondary" onClick={() => rejectOrder(order.id)}>Reject</button>
              </>
            )}
            {order.status === 'confirmed' && <button type="button" className="action-secondary" onClick={() => advanceOrder(order.id)}>Start preparation</button>}
            {order.status === 'preparing' && <button type="button" className="action-secondary" onClick={() => advanceOrder(order.id)}>Dispatch</button>}
            {order.status === 'in_transit' && <button type="button" className="action-primary" onClick={() => advanceOrder(order.id)}>Confirm delivery</button>}
          </div>
        </article>
      ))}
      <h2>History</h2>
      {snap.orders.filter(order => order.status === 'delivered' || order.status === 'rejected').map(order => (
        <p key={order.id} className="work-quiet">{order.id} · {order.status}. {order.status === 'delivered' ? 'Stock receipt is already recorded.' : 'Rejected. Stock was not changed.'}</p>
      ))}
      <div className="demo-panel">
        <h2>Audit</h2>
        <ul>
          {(snap.audit || []).filter(row => String(row.action).startsWith('supplier')).map(row => (
            <li key={row.id}>{row.action} · {row.detail}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function DemoVenue({ onOpen }) {
  const snap = useLedger()
  return (
    <div className="work">
      <header className="work-head">
        <div>
          <p className="eyebrow">DEMO</p>
          <h1 className="page-title">Venues</h1>
        </div>
      </header>
      <article className="demo-panel">
        <h2>{snap.venue}</h2>
        <p className="work-quiet">Today’s fictional sales {fmtYen(snap.today.sales)}. This is not a live venue total.</p>
        <button type="button" className="action-primary" onClick={onOpen}>Open bar</button>
      </article>
    </div>
  )
}
