/** HQ workspace for a session with no connected books. */

import { MetricTile, SignalBoard, TrendStage, WorkLanes } from './Stage'

export default function ExecutiveHome({ onNav }) {
  return (
    <div className="work">
      <header className="work-head">
        <div>
          <p className="eyebrow">Group</p>
          <h1 className="page-title">This month</h1>
        </div>
        <div className="work-actions">
          <button type="button" className="action-primary" onClick={() => onNav?.('relatorio')}>Reports</button>
          <button type="button" className="action-secondary" onClick={() => onNav?.('procurement')}>Procurement</button>
          <button type="button" className="action-secondary" onClick={() => onNav?.('payroll')}>Labor</button>
          <button type="button" className="action-secondary" onClick={() => onNav?.('cashflow')}>Cash</button>
        </div>
      </header>
      <div className="work-stage">
        <TrendStage title="Revenue" caption="Sales books are not connected" />
        <SignalBoard
          title="Attention"
          items={[
            { label: 'Profit', value: 'Not connected' },
            { label: 'Labor', value: 'Not connected' },
            { label: 'Cash', value: 'Not connected' },
            { label: 'Alerts', value: 'None loaded' },
          ]}
        />
      </div>
      <div className="work-metrics">
        <MetricTile label="Revenue" value="—" />
        <MetricTile label="Profit" value="—" />
        <MetricTile label="Labor" value="—" />
        <MetricTile label="Cash" value="—" />
      </div>
      <WorkLanes
        lanes={[
          { title: 'Venues', state: 'Comparison not connected' },
          { title: 'CMV', state: 'Cost not connected' },
          { title: 'Labor mix', state: 'Not connected' },
          { title: 'Recommendations', state: 'No connected evidence' },
        ]}
      />
    </div>
  )
}
