/** Report snapshots copy analyze() fields. They do not invent profit. */

const KEY = 'atomic-bar-report-approvals'

export function moneyLine(value) {
  if (value == null) return 'Insufficient data'
  return `JPY ${Math.round(value).toLocaleString('en-US')}`
}

export function reportSnapshot({
  barName = 'Bar',
  report,
  kind = 'executive',
  preparedBy = 'Not signed',
  demo = false,
  id,
  generatedAt = new Date().toISOString(),
}) {
  if (!report?.range) throw new Error('A report needs an analyze() result')
  return {
    id: id || `rpt-${generatedAt.replace(/\W/g, '').slice(0, 15)}`,
    version: 1,
    kind,
    barName,
    demo: !!demo,
    generatedAt,
    preparedBy,
    period: { ...report.range },
    compare: { ...report.compareTo },
    timezone: report.timezone,
    operationalDay: report.operationalDay,
    sales: report.current?.sales ?? null,
    orders: report.current?.orders ?? null,
    ticket: report.current?.ticket ?? null,
    previousSales: report.previous?.sales ?? null,
    salesChangePct: report.salesChange?.pct ?? null,
    grossProfit: report.grossProfit?.status === 'available' ? report.grossProfit.amount : null,
    operatingProfit: null,
    labor: report.labor?.status === 'available' ? report.labor.amount : null,
    expenses: (report.expenses || []).map(row => ({ kind: row.kind, amount: row.amount })),
    insights: (report.insights || []).map(note => note.text),
    legalSignature: false,
    approval: null,
  }
}

export function reportPages(snapshot) {
  const mark = snapshot.demo ? 'DEMO DATA — not a live result' : 'Loaded register'
  const change = snapshot.salesChangePct == null
    ? 'Percentage change is omitted because the comparison baseline is missing or zero.'
    : `Sales change versus the comparison window: ${snapshot.salesChangePct}%.`
  const cover = [
    snapshot.barName,
    snapshot.kind === 'financial' ? 'Detailed financial report' : 'Monthly executive report',
    mark,
    `Period ${snapshot.period.start} to ${snapshot.period.end}`,
    `Comparison ${snapshot.compare.start} to ${snapshot.compare.end}`,
    `Timezone ${snapshot.timezone}`,
    `Operational day ${snapshot.operationalDay}`,
    `Generated ${snapshot.generatedAt}`,
    `Prepared by ${snapshot.preparedBy}`,
    `Report ${snapshot.id} version ${snapshot.version}`,
    snapshot.approval ? `Approval ${snapshot.approval.status}` : 'Approval status: draft',
  ]
  const summary = [
    'Executive summary',
    mark,
    `Net sales ${moneyLine(snapshot.sales)}`,
    `Orders ${snapshot.orders == null ? 'Insufficient data' : snapshot.orders}`,
    `Average ticket ${moneyLine(snapshot.ticket)}`,
    `Previous sales ${moneyLine(snapshot.previousSales)}`,
    change,
    `Gross profit ${moneyLine(snapshot.grossProfit)}`,
    'Operating profit Insufficient data',
    'Gross profit is shown only when analyze() marks it available.',
    'Operating profit is not estimated from sales.',
  ]
  const costs = [
    'Recorded costs',
    mark,
    snapshot.labor == null ? 'Labor Insufficient data' : `Labor book ${moneyLine(snapshot.labor)}`,
    ...(snapshot.expenses.length
      ? snapshot.expenses.map(row => `${row.kind} ${moneyLine(row.amount)} (registered amount, not profit)`)
      : ['No registered operating amounts in this snapshot.']),
    'Cash closing is not included. Open Cash Register for the existing close.',
  ]
  const notes = [
    'Observations and limits',
    mark,
    ...(snapshot.insights.length ? snapshot.insights : ['No comparison insight was produced for this snapshot.']),
    'This PDF is not a legal electronic signature.',
    'Japanese text is not embedded. Amounts use JPY.',
  ]
  const sign = [
    'Approval page',
    `Report ${snapshot.id}`,
    `Version ${snapshot.version}`,
    snapshot.approval
      ? `Approved locally by ${snapshot.approval.name} (${snapshot.approval.role}) at ${snapshot.approval.at}`
      : 'Not approved. Download of a draft is allowed. It is not an approved pack.',
    'Identity is the name typed in this browser. It is not a certified signature.',
  ]
  return [cover, summary, costs, notes, sign]
}

export function readApprovals() {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function storeApproval(snapshot, signer) {
  const name = String(signer?.name || '').trim()
  const role = String(signer?.role || '').trim()
  if (!name || !role) throw new Error('Name and role are required')
  const approved = {
    ...snapshot,
    approval: {
      name,
      role,
      at: new Date().toISOString(),
      status: 'approved-local',
    },
  }
  const next = [approved, ...readApprovals().filter(row => row.id !== approved.id)]
  localStorage.setItem(KEY, JSON.stringify(next))
  return approved
}
