import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { analyze } from '../src/lib/managerAnalytics.js'
import { moneyLine, reportPages, reportSnapshot } from '../src/lib/managementReport.js'
import { pdfFromPages } from '../src/lib/simplePdf.js'
import { tokyoWallToUtcMs } from '../src/lib/tokyo.js'

const at = new Date(tokyoWallToUtcMs(2026, 10, 1, 21, 0)).toISOString()
const report = analyze({
  tickets: [{ id: 'a', total: 12500, criado_em: at, data: '2026-10-01', obs: '', metodo_pagamento: 'Cash' }],
  preset: 'today',
  nightKey: '2026-10-01',
  compare: 'previous',
  demo: false,
})
const executive = reportSnapshot({ barName: 'Atomic Bar', report, kind: 'executive', demo: true, id: 'rpt-test', generatedAt: '2026-10-01T12:00:00.000Z' })
const financial = reportSnapshot({ barName: 'Atomic Bar', report, kind: 'financial', demo: true, id: 'rpt-test', generatedAt: '2026-10-01T12:00:00.000Z' })
assert.equal(executive.sales, financial.sales)
assert.equal(executive.sales, 12500)
assert.equal(executive.grossProfit, null)
assert.equal(executive.operatingProfit, null)
assert.equal(moneyLine(null), 'Insufficient data')
assert.equal(executive.salesChangePct, null)

const pages = reportPages(executive)
const pdf = pdfFromPages(pages)
assert.ok(pdf.startsWith('%PDF-1.4'))
assert.ok(pdf.includes('JPY 12,500'))
assert.ok(pdf.includes('DEMO DATA'))
assert.ok(pdf.includes('Operating profit Insufficient data'))
assert.equal(pages.length, 5)
writeFileSync('/opt/cursor/artifacts/demo-monthly-report.pdf', pdf)
console.log('management report tests passed')
