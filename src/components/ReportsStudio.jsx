/** Draft PDF from the same analyze() snapshot. Local approval is not a legal signature. */

import { useMemo, useState } from 'react'
import { isLocalDemo } from '../lib/supabase'
import { analyze } from '../lib/managerAnalytics'
import { pdfFromPages } from '../lib/simplePdf'
import { readApprovals, reportPages, reportSnapshot, storeApproval } from '../lib/managementReport'
import { tokyoNightKey } from '../lib/tokyo'

export default function ReportsStudio({ bar, tickets = [], people = [], registry = [], payroll = null }) {
  const night = tokyoNightKey()
  const [preset, setPreset] = useState('thisMonth')
  const [kind, setKind] = useState('executive')
  const [name, setName] = useState('')
  const [role, setRole] = useState('Manager')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(() => readApprovals())
  const report = useMemo(() => analyze({
    tickets,
    people,
    registry,
    payroll: preset === 'thisMonth' || preset === 'lastMonth' ? payroll : null,
    preset,
    nightKey: night,
    compare: 'previous',
    demo: isLocalDemo,
  }), [tickets, people, registry, payroll, preset, night])
  const snapshot = useMemo(() => reportSnapshot({
    barName: bar?.nome || 'Bar',
    report,
    kind,
    preparedBy: name.trim() || 'Draft, unsigned',
    demo: isLocalDemo,
  }), [bar?.nome, report, kind, name])
  const pages = reportPages(snapshot)

  function download(source) {
    const filePages = reportPages(source)
    const pdf = pdfFromPages(filePages)
    const blob = new Blob([pdf], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${source.id}.pdf`
    link.click()
    URL.revokeObjectURL(url)
  }

  function approve() {
    setError('')
    try {
      const approved = storeApproval(snapshot, { name, role })
      setSaved(readApprovals())
      download(approved)
    } catch (err) {
      setError(err.message || 'Approval was not stored')
    }
  }

  return (
    <div className="reports-studio">
      <div className="goal-modes">
        {['thisMonth', 'lastMonth', 'thisWeek'].map(id => (
          <button key={id} type="button" className={preset === id ? 'is-on' : ''} onClick={() => setPreset(id)}>{id === 'thisMonth' ? 'This month' : id === 'lastMonth' ? 'Last month' : 'This week'}</button>
        ))}
        <button type="button" className={kind === 'executive' ? 'is-on' : ''} onClick={() => setKind('executive')}>Executive</button>
        <button type="button" className={kind === 'financial' ? 'is-on' : ''} onClick={() => setKind('financial')}>Financial</button>
      </div>
      <p className="mp-note">
        {snapshot.period.start} → {snapshot.period.end}. Both report types copy the same sales figure from analyze(). {isLocalDemo ? 'This preview is demo data.' : 'Figures are from the loaded register.'}
      </p>
      <article className="panel report-sheet">
        {pages.map((page, index) => (
          <section key={page[0]}>
            {page.map(line => <p key={`${index}-${line}`}>{line}</p>)}
          </section>
        ))}
      </article>
      <div className="mp-custom">
        <label>Name <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" /></label>
        <label>Role <input value={role} onChange={e => setRole(e.target.value)} /></label>
        <button type="button" className="action-secondary" onClick={() => download(snapshot)}>Download draft PDF</button>
        <button type="button" className="action-primary" onClick={approve}>Approve and download</button>
      </div>
      {error && <p className="mp-note">{error}</p>}
      <p className="mp-note">Approval is stored in this browser only. It does not close the month and it is not a certified signature. An approved file keeps the snapshot from the moment of approval.</p>
      {!!saved.length && (
        <ul className="mp-pay">
          {saved.slice(0, 5).map(row => (
            <li key={row.id}>{row.id} · {row.approval?.status} · {row.approval?.name}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
