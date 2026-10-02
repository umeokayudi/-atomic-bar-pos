/** Owner workspace. Figures come from analyze(); missing books stay blank. */

import { useMemo, useState } from 'react'
import { fmtYen } from './utils'
import { isLocalDemo } from '../lib/supabase'
import { analyze } from '../lib/managerAnalytics'
import { tokyoNightKey } from '../lib/tokyo'
import { MetricTile, SignalBoard, TrendStage } from './experience/Stage'
import { DemoToday } from './demo/DemoOperations'

function yen(value) {
  if (value == null) return '—'
  return fmtYen(value)
}

export default function OwnerView({ bar, tickets = [], people = [], goals, registry = [], payroll = null, onManage, onTab }) {
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

  const salesKnown = report.current.sales != null
  const signals = [
    { label: 'Profit', value: report.grossProfit.amount == null ? 'Cost not connected' : yen(report.grossProfit.amount) },
    { label: 'Labor', value: report.labor.amount == null ? 'Not connected' : yen(report.labor.amount) },
    { label: 'Cash', value: 'Close not connected' },
    { label: 'Stock', value: 'Not connected' },
  ]

  if (isLocalDemo) return <DemoToday onTab={onTab} venue={bar?.nome || 'Atomic Bar'} embedded />

  return (
    <div className="work">
      <div className="work-toolbar">
        <div className="work-actions">
          <button type="button" className="action-primary" onClick={() => onTab?.('pos')}>Point of Sale</button>
          <button type="button" className="action-secondary" onClick={() => onTab?.('espacos')}>Floor</button>
          <button type="button" className="action-secondary" onClick={() => onTab?.('pedidos')}>Orders</button>
          <button type="button" className="action-secondary" onClick={() => onTab?.('fechamento')}>Cash</button>
        </div>
        <div className="goal-modes">
          {['today', 'thisWeek', 'thisMonth'].map(id => (
            <button key={id} type="button" className={preset === id ? 'is-on' : ''} onClick={() => setPreset(id)}>
              {id === 'today' ? 'Today' : id === 'thisWeek' ? 'This week' : 'This month'}
            </button>
          ))}
        </div>
      </div>
      <div className="work-stage">
        <TrendStage
          title={bar?.nome || 'Sales'}
          points={report.timeline.map(point => ({ label: point.label, value: point.sales }))}
          caption={salesKnown ? 'No trend in this range' : 'Sales are not connected'}
        />
        <SignalBoard title="Attention" items={signals} />
      </div>
      <div className="work-metrics">
        <MetricTile label="Net sales" value={yen(report.current.sales)} />
        <MetricTile label="Orders" value={report.current.orders == null ? '—' : String(report.current.orders)} />
        <MetricTile label="Average ticket" value={yen(report.current.ticket)} />
        <MetricTile label="Gross profit" value="—" />
      </div>
      <button type="button" className="action-secondary work-secondary" onClick={onManage}>Open analytics</button>
    </div>
  )
}
