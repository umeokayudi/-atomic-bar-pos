import { useEffect, useState } from 'react'
import { fmtYen } from '../utils'
import { MetricTile, SignalBoard, TrendStage } from '../experience/Stage'
import {
  advanceOrder,
  closeRegister,
  confirmOrder,
  createPurchaseRequest,
  openRegister,
  punch,
  recordMovement,
  snapshot,
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

export function DemoToday({ onTab, onNav, venue = 'Atomic Bar' }) {
  const snap = useLedger()
  const cmv = snap.today.cmv == null ? '—' : `${(snap.today.cmv * 100).toFixed(1)}%`
  const go = id => (onTab || onNav)?.(id)
  return (
    <div className="work">
      <header className="work-head">
        <div>
          <p className="eyebrow">DEMO · {venue}</p>
          <h1 className="page-title">Today</h1>
        </div>
        <div className="work-actions">
          {onTab && <button type="button" className="action-primary" onClick={() => go('pos')}>Point of Sale</button>}
          {onTab && <button type="button" className="action-secondary" onClick={() => go('fechamento')}>Cash</button>}
          {onTab && <button type="button" className="action-secondary" onClick={() => go('estoque')}>Stock</button>}
          {onNav && <button type="button" className="action-secondary" onClick={() => go('cashflow')}>Cash</button>}
        </div>
      </header>
      <p className="work-quiet">Fictional DEMO books. Nothing here is a live sale, wage, or supplier order.</p>
      <div className="work-metrics">
        <MetricTile label="Sales today" value={fmtYen(snap.today.sales)} />
        <MetricTile label="Gross profit" value={fmtYen(snap.today.gross)} />
        <MetricTile label="CMV" value={cmv} />
        <MetricTile label="Labor this month" value={fmtYen(snap.month.labor)} />
      </div>
      <div className="work-stage">
        <TrendStage title="Sales trend" points={snap.trend} caption="DEMO nights" />
        <SignalBoard title="Attention" items={snap.attention} />
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

export function DemoStaff() {
  const snap = useLedger()
  const me = snap.staff[0]
  return (
    <div className="work">
      <header className="work-head">
        <div>
          <p className="eyebrow">DEMO · {me?.name}</p>
          <h1 className="page-title">My shift</h1>
        </div>
      </header>
      <p className="work-quiet">Clock actions stay in this browser. They do not post a live punch.</p>
      <div className="work-metrics">
        <MetricTile label="Next shift" value={me ? `${me.shiftDate} ${me.shiftStart}–${me.shiftEnd}` : '—'} />
        <MetricTile label="Clock" value={me?.clockedIn ? 'In' : 'Out'} />
        <MetricTile label="Hours" value={me ? me.hours.toFixed(1) : '—'} />
        <MetricTile label="Earnings" value={me ? fmtYen(me.earnings) : '—'} />
      </div>
      <div className="demo-actions">
        <button type="button" className="action-primary" disabled={me?.clockedIn} onClick={() => punch('in')}>Clock in</button>
        <button type="button" className="action-secondary" disabled={!me?.clockedIn} onClick={() => punch('out')}>Clock out</button>
      </div>
      <div className="demo-panel">
        <h2>Assigned tasks</h2>
        <ul>{(me?.tasks || []).map(task => <li key={task}>{task}</li>)}</ul>
      </div>
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
      {snap.orders.map(order => (
        <article key={order.id} className="demo-panel">
          <h2>{order.id} · {order.status}</h2>
          <p className="work-quiet">{order.supplier}</p>
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
              <button type="button" className="action-primary" onClick={() => {
                const quantities = {}
                for (const line of order.lines) quantities[line.drinkId] = qty[`${order.id}:${line.drinkId}`] ?? line.ordered
                confirmOrder(order.id, quantities)
              }}>Confirm quantities</button>
            )}
            {order.status !== 'delivered' && order.status !== 'pending' && (
              <button type="button" className="action-secondary" onClick={() => advanceOrder(order.id)}>Update delivery</button>
            )}
          </div>
        </article>
      ))}
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
