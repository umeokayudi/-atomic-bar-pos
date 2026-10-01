/** Local approval list. It does not execute closings or payroll. */

import { useState } from 'react'
import { readApprovals } from '../lib/managementReport'

export default function ApprovalCenter({ onTab }) {
  const [rows] = useState(() => readApprovals())
  return (
    <div className="approval-center">
      <p className="mp-note">This queue lists report approvals saved in this browser. Cash, payroll, and inventory changes still use their own screens and are not marked complete here.</p>
      {!rows.length && <p className="mp-note">No local report approval yet.</p>}
      {rows.map(row => (
        <article key={row.id} className="panel">
          <h2 className="section-title">{row.kind} · {row.period?.start} → {row.period?.end}</h2>
          <p className="mp-note">{row.approval?.status} · {row.approval?.name} · {row.approval?.role} · {row.approval?.at}</p>
          <p className="mp-note">Sales in the frozen snapshot stay as recorded. Later tickets do not rewrite this approval.</p>
        </article>
      ))}
      <div className="quick-actions">
        <button type="button" className="action-secondary" onClick={() => onTab?.('fechamento')}>Open cash register</button>
        <button type="button" className="action-secondary" onClick={() => onTab?.('ia')}>Open AI Operations</button>
        <button type="button" className="action-secondary" onClick={() => onTab?.('salarios')}>Open payroll</button>
      </div>
    </div>
  )
}
