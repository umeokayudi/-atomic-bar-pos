/** Conversational proposals. Calculations stay local. Mutations are never marked complete here. */

import { useMemo, useState } from 'react'
import { isLocalDemo, supabase } from '../lib/supabase'
import { tokyoNightKey } from '../lib/tokyo'
import { saleValid } from '../lib/nightClose'
import AiAssistantWorkspace from './AiAssistantWorkspace'

const LIFECYCLE = ['draft', 'calculating', 'ready', 'approved', 'executing', 'completed', 'failed', 'cancelled']

function newId() {
  return `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function validTillAmount(row) {
  return saleValid(row)
}

const COMMANDS = [
  { id: 'sales', label: 'Explain recorded sales', kind: 'calculation' },
  { id: 'profit', label: 'Prepare a gross-profit note', kind: 'calculation' },
  { id: 'close', label: 'Prepare a cash-closing review', kind: 'proposal' },
  { id: 'stock', label: 'Review stock alerts', kind: 'calculation' },
  { id: 'labor', label: 'Prepare a labor note', kind: 'calculation' },
  { id: 'report', label: 'Draft a daily report', kind: 'draft' },
]

export default function AiOperationsCenter({ bar, onTab }) {
  const [actions, setActions] = useState([])
  const [note, setNote] = useState('')
  const [section, setSection] = useState('assistant')
  const night = tokyoNightKey()

  const scope = useMemo(() => ({
    bar: bar?.nome || 'This bar',
    night,
    mode: isLocalDemo ? 'Local demo' : 'Connected register',
  }), [bar?.nome, night])

  function upsert(next) {
    setActions(list => {
      const without = list.filter(row => row.id !== next.id)
      return [next, ...without]
    })
  }

  async function prepare(command) {
    const id = newId()
    const base = {
      id,
      command: command.id,
      kind: command.kind,
      title: command.label,
      status: 'calculating',
      bar: scope.bar,
      period: night,
      createdAt: new Date().toISOString(),
    }
    upsert(base)
    let sales = null
    let salesError = ''
    try {
      const res = await supabase.from('pos_vendas').select('id,total,refunded,void_status').eq('bar_id', bar.id)
      if (res.error) salesError = res.error.message || 'Sales could not be read'
      else sales = res.data || []
    } catch (e) {
      salesError = e.message || 'Sales could not be read'
    }
    const records = sales ? sales.length : null
    const validRows = sales ? sales.filter(row => validTillAmount(row) > 0) : null
    const count = validRows ? validRows.length : null
    const total = sales ? sales.reduce((sum, row) => sum + validTillAmount(row), 0) : null
    let body = ''
    let status = 'ready'
    if (command.id === 'sales') {
      body = salesError
        ? `Sales could not be read. ${salesError}`
        : count === 0
          ? 'No sales records were returned for this bar. This is not a live zero from another database.'
          : `${records} till row${records === 1 ? '' : 's'} stay on record. ${count} valid ticket${count === 1 ? '' : 's'}, ${Math.round(total)} yen. A voided row adds zero and is not deleted.`
      if (salesError) status = 'failed'
    } else if (command.id === 'profit') {
      body = 'Gross profit is not calculated here. It requires recorded product cost, not sales alone. Open Overview to see the profit state.'
    } else if (command.id === 'close') {
      body = 'This prepares a review only. Approving it does not close the register, post cash, or change stock. Finish the close on Cash Register.'
    } else if (command.id === 'stock') {
      body = isLocalDemo
        ? 'Inventory data is unavailable in local mode. Missing stock is not zero stock.'
        : 'Open Inventory to read quantities and minimums. This note does not create a purchase order.'
    } else if (command.id === 'labor') {
      body = isLocalDemo
        ? 'Time clock is unavailable in local mode. No punches were invented.'
        : 'Open Time Clock and Payroll to review recorded punches. This note does not approve payroll.'
    } else {
      const salesLine = salesError
        ? 'Sales: unavailable.'
        : count === 0
          ? 'Sales: no records in this session.'
          : `Sales: ${records} rows on record, ${count} valid tickets, ${Math.round(total)} yen.`
      body = [
        `Daily report draft for ${scope.bar}, night ${night}.`,
        salesLine,
        'Profit, stock, and labor are included only when those books are loaded on their own screens.',
        'Nothing has been sent.',
      ].join(' ')
    }
    upsert({
      ...base,
      status,
      body,
      formula: command.id === 'sales' && sales ? 'valid till = original total minus one capped refund; void status is zero' : 'No new formula',
      reversible: command.kind !== 'proposal' ? 'Nothing is written' : 'No register change is made by this screen',
    })
  }

  function approve(row) {
    if (row.status !== 'ready') return
    if (actions.some(item => item.id === row.id && item.status === 'approved')) return
    upsert({
      ...row,
      status: 'approved',
      approvedAt: new Date().toISOString(),
      result: row.kind === 'proposal'
        ? 'Approved as a review. The register is not closed.'
        : 'Approved as a note. No ledger was changed.',
    })
    setNote(row.kind === 'proposal'
      ? 'Open Cash Register to finish the close with the existing screen.'
      : 'The note is approved. No financial record was written.')
  }

  function cancel(row) {
    if (row.status === 'completed') return
    upsert({ ...row, status: 'cancelled' })
  }

  const approvals = actions.filter(row => row.status === 'ready' || row.status === 'approved')

  return (
    <div className="ai-ops">
      <header className="dashboard-header">
        <div>
          <div className="eyebrow">{scope.bar}</div>
          <h1 className="page-title">AI Operations</h1>
          <p className="page-subtitle">Ask in the assistant. Approvals and history stay separate, and neither one posts a financial action.</p>
        </div>
      </header>
      <nav className="ai-ops-nav" aria-label="AI workspace">
        {[
          ['assistant', 'Assistant'],
          ['approvals', `Approvals${approvals.length ? ` ${approvals.length}` : ''}`],
          ['history', 'Action history'],
        ].map(([id, label]) => (
          <button key={id} type="button" aria-pressed={section === id} onClick={() => setSection(id)}>{label}</button>
        ))}
      </nav>
      {section === 'assistant' && <AiAssistantWorkspace demo={isLocalDemo} />}
      {section === 'approvals' && (
        <section className="ai-ops-thread">
          <div className="ai-query-panel">
            <div className="ai-query-kicker">Prepare a review</div>
            <p className="ai-ops-status">These notes use the existing local calculations. They do not replace the assistant and do not close cash, payroll, or purchasing.</p>
            <div className="ai-ops-commands">
              {COMMANDS.map(command => (
                <button key={command.id} type="button" className="action-secondary" onClick={() => prepare(command)}>
                  {command.label}
                </button>
              ))}
            </div>
          </div>
          {note && <p className="metric-detail">{note}</p>}
          {!approvals.length && (
            <div className="empty-state">
              <strong>Nothing is waiting for approval</strong>
              <p>A prepared note stays here until someone reviews it. Approval still does not execute the operation.</p>
            </div>
          )}
          {approvals.map(row => (
            <ActionCard key={row.id} row={row} onApprove={approve} onCancel={cancel} onTab={onTab} />
          ))}
        </section>
      )}
      {section === 'history' && (
        <section className="panel ai-ops-thread">
          <h2 className="section-title">Action history</h2>
          {!actions.length && (
            <div className="empty-state">
              <strong>No proposal yet</strong>
              <p>Prepare a note from Approvals. A calculation is not a completed closing, purchase, or payroll run.</p>
            </div>
          )}
          {actions.map(row => (
            <ActionCard key={row.id} row={row} onApprove={approve} onCancel={cancel} onTab={onTab} />
          ))}
          <p className="metric-detail">States used: {LIFECYCLE.join(', ')}. Completed is reserved for a backend confirmation this screen does not issue.</p>
        </section>
      )}
    </div>
  )
}

function ActionCard({ row, onApprove, onCancel, onTab }) {
  return (
    <article className={`ai-action is-${row.status}`}>
      <header>
        <strong>{row.title}</strong>
        <span className={`status-badge is-${row.status === 'failed' ? 'danger' : row.status === 'approved' ? 'occupied' : 'available'}`}>{row.status}</span>
      </header>
      <ol className="ai-stages">
        {['Draft', 'Calculation', 'Human review', 'Approval recorded', 'Execution', 'Verification'].map(stage => {
          const reached = (row.status === 'calculating' && stage === 'Calculation')
            || (row.status === 'ready' && ['Draft', 'Calculation', 'Human review'].includes(stage))
            || (row.status === 'approved' && ['Draft', 'Calculation', 'Human review', 'Approval recorded'].includes(stage))
            || (row.status === 'failed' && stage === 'Calculation')
          return <li key={stage} className={reached ? 'is-on' : ''}>{stage}</li>
        })}
      </ol>
      <p className="metric-detail">Execution and verification stay off until a backend confirms the existing operation. Approval here does not close cash, payroll, or a month.</p>
      <p>{row.body}</p>
      <dl>
        <div><dt>Action</dt><dd>{row.id}</dd></div>
        <div><dt>Kind</dt><dd>{row.kind}</dd></div>
        <div><dt>Period</dt><dd>{row.period}</dd></div>
        <div><dt>Formula</dt><dd>{row.formula}</dd></div>
        <div><dt>Effect</dt><dd>{row.reversible}</dd></div>
      </dl>
      {row.result && <p className="metric-detail">{row.result}</p>}
      <div className="ai-action-buttons">
        <button type="button" className="action-primary" disabled={row.status !== 'ready'} onClick={() => onApprove(row)}>Approve note</button>
        <button type="button" className="action-secondary" disabled={row.status === 'cancelled'} onClick={() => onCancel(row)}>Cancel</button>
        {row.command === 'close' && (
          <button type="button" className="action-secondary" onClick={() => onTab?.('fechamento')}>Open cash register</button>
        )}
        {row.command === 'stock' && (
          <button type="button" className="action-secondary" onClick={() => onTab?.('estoque')}>Open inventory</button>
        )}
        {row.command === 'labor' && (
          <button type="button" className="action-secondary" onClick={() => onTab?.('ponto')}>Open time clock</button>
        )}
      </div>
    </article>
  )
}
