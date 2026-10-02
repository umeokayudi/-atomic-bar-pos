/**
 * Fictional studio used only to show how an answer can look.
 * live is always false. These names and amounts are not a venue's books.
 */

export const SAMPLE_STUDIO = {
  name: 'Harbor Sample',
  live: false,
  months: [
    { label: 'Apr', revenue: 8420000, profit: 5890000, cogs: 1680000, laborPct: 22.4 },
    { label: 'May', revenue: 9150000, profit: 6410000, cogs: 1740000, laborPct: 22.8 },
    { label: 'Jun', revenue: 9840000, profit: 6890000, cogs: 1810000, laborPct: 23.1 },
    { label: 'Jul', revenue: 10260000, profit: 7180000, cogs: 1860000, laborPct: 23.6 },
    { label: 'Aug', revenue: 9480000, profit: 6260000, cogs: 1860000, laborPct: 24.1 },
    { label: 'Sep', revenue: 8910000, profit: 5520000, cogs: 2140000, laborPct: 28.4 },
  ],
  products: [
    { name: 'Highball set', sold: 1840, marginPct: 72, profit: 920000 },
    { name: 'House whisky', sold: 960, marginPct: 64, profit: 610000 },
    { name: 'Sparkling', sold: 740, marginPct: 58, profit: 390000 },
    { name: 'Draft beer', sold: 2100, marginPct: 41, profit: 280000 },
    { name: 'Bottled wine', sold: 420, marginPct: 33, profit: 150000 },
  ],
  venues: [
    { name: 'Counter Sample', revenue: 4820000, profit: 3210000 },
    { name: 'Lounge Sample', revenue: 2640000, profit: 1480000 },
    { name: 'Terrace Sample', revenue: 1450000, profit: 830000 },
  ],
  alerts: [
    { item: 'Yuzu syrup', onHand: 2, minimum: 8 },
    { item: 'Tonic', onHand: 4, minimum: 10 },
    { item: 'House whisky', onHand: 3, minimum: 6 },
  ],
}

const FOLLOWUPS = [
  'How much did we make this month?',
  'Which products have the highest margin?',
  'Why did profit decrease?',
  'Compare the venues.',
]

export function formatSampleYen(value) {
  return `¥${Math.round(Number(value) || 0).toLocaleString('en-US')}`
}

function monthPair() {
  const months = SAMPLE_STUDIO.months
  return { previous: months[months.length - 2], current: months[months.length - 1] }
}

function revenueChart() {
  return {
    kind: 'line',
    title: 'Revenue',
    points: SAMPLE_STUDIO.months.map(month => ({ label: month.label, value: month.revenue })),
  }
}

function profitChart() {
  return {
    kind: 'line',
    title: 'Gross profit',
    points: SAMPLE_STUDIO.months.map(month => ({ label: month.label, value: month.profit })),
  }
}

function base(extra) {
  return {
    illustrative: true,
    live: false,
    detail: `${SAMPLE_STUDIO.name} is a fictional set for layout only.`,
    sources: ['Sample studio · fictional', 'Not a model reply', 'Not live books'],
    ...extra,
  }
}

function overview() {
  const { current, previous } = monthPair()
  return base({
    text: `Sample studio. September revenue is ${formatSampleYen(current.revenue)}, down from ${formatSampleYen(previous.revenue)} in August. These amounts are not this bar’s books.`,
    kpis: [
      { label: 'Revenue', value: formatSampleYen(current.revenue), note: 'September sample' },
      { label: 'Gross profit', value: formatSampleYen(current.profit), note: 'September sample' },
      { label: 'Cost of goods', value: formatSampleYen(current.cogs), note: 'September sample' },
      { label: 'Labor', value: `${current.laborPct}%`, note: 'Of sample revenue' },
    ],
    chart: revenueChart(),
    bars: {
      kind: 'bar',
      title: 'Product margin',
      points: SAMPLE_STUDIO.products.map(product => ({ label: product.name, value: product.marginPct })),
    },
    comparison: {
      title: 'Venues in September',
      columns: ['Venue', 'Revenue', 'Gross profit'],
      rows: SAMPLE_STUDIO.venues.map(venue => [venue.name, formatSampleYen(venue.revenue), formatSampleYen(venue.profit)]),
    },
    table: null,
    evidence: [
      { label: 'Revenue change', formula: `(${current.revenue} − ${previous.revenue}) / ${previous.revenue} = ${(((current.revenue - previous.revenue) / previous.revenue) * 100).toFixed(1)}%` },
      { label: 'Scope', formula: 'No till, invoice, stock ledger, or payroll book was read.' },
    ],
    followups: FOLLOWUPS.slice(1),
  })
}

function products() {
  return base({
    text: 'Sample studio. Highball set leads margin in this fictional ranking. Sell-through is not from the register.',
    kpis: SAMPLE_STUDIO.products.slice(0, 4).map(product => ({
      label: product.name,
      value: `${product.marginPct}%`,
      note: `${product.sold.toLocaleString('en-US')} sample units`,
    })),
    chart: null,
    bars: {
      kind: 'bar',
      title: 'Margin ranking',
      points: SAMPLE_STUDIO.products.map(product => ({ label: product.name, value: product.marginPct })),
    },
    comparison: null,
    table: {
      columns: ['Product', 'Sample units', 'Margin', 'Sample profit'],
      rows: SAMPLE_STUDIO.products.map(product => [product.name, String(product.sold), `${product.marginPct}%`, formatSampleYen(product.profit)]),
    },
    evidence: [
      { label: 'Ranking', formula: 'Sorted by sample margin percent, not by units sold.' },
      { label: 'Scope', formula: 'Product cost and POS price books were not opened.' },
    ],
    followups: ['Why did profit decrease?', 'Compare the venues.', 'Prepare a purchase order for low-stock items.'],
  })
}

function profitDrop() {
  const { current, previous } = monthPair()
  const revenueChange = ((current.revenue - previous.revenue) / previous.revenue) * 100
  const profitChange = ((current.profit - previous.profit) / previous.profit) * 100
  const cogsChange = ((current.cogs - previous.cogs) / previous.cogs) * 100
  return base({
    text: 'Sample studio. Profit fell because sample revenue dipped while cost of goods and labor both rose. This is not a diagnosis of the live bar.',
    kpis: [
      { label: 'Profit change', value: `${profitChange.toFixed(1)}%`, note: 'August to September' },
      { label: 'Revenue change', value: `${revenueChange.toFixed(1)}%`, note: 'August to September' },
      { label: 'Cost of goods', value: `${cogsChange.toFixed(1)}%`, note: 'August to September' },
      { label: 'Labor', value: `${current.laborPct}%`, note: `Was ${previous.laborPct}%` },
    ],
    chart: profitChart(),
    bars: null,
    comparison: {
      title: 'August against September',
      columns: ['', 'August', 'September'],
      rows: [
        ['Revenue', formatSampleYen(previous.revenue), formatSampleYen(current.revenue)],
        ['Gross profit', formatSampleYen(previous.profit), formatSampleYen(current.profit)],
        ['Cost of goods', formatSampleYen(previous.cogs), formatSampleYen(current.cogs)],
        ['Labor', `${previous.laborPct}%`, `${current.laborPct}%`],
      ],
    },
    table: null,
    evidence: [
      { label: 'Profit change', formula: `(${current.profit} − ${previous.profit}) / ${previous.profit} = ${profitChange.toFixed(1)}%` },
      { label: 'Cost of goods change', formula: `(${current.cogs} − ${previous.cogs}) / ${previous.cogs} = ${cogsChange.toFixed(1)}%` },
      { label: 'Labor', formula: `Sample labor share moved from ${previous.laborPct}% to ${current.laborPct}%.` },
    ],
    followups: ['Which products have the highest margin?', 'Compare the venues.', 'How much did we make this month?'],
  })
}

function venues() {
  return base({
    text: 'Sample studio. Counter Sample carries the largest share of this fictional September. No venue ledger was compared.',
    kpis: SAMPLE_STUDIO.venues.map(venue => ({
      label: venue.name,
      value: formatSampleYen(venue.revenue),
      note: `Profit ${formatSampleYen(venue.profit)}`,
    })),
    chart: null,
    bars: {
      kind: 'bar',
      title: 'Revenue by venue',
      points: SAMPLE_STUDIO.venues.map(venue => ({ label: venue.name, value: venue.revenue })),
    },
    comparison: {
      title: 'September sample',
      columns: ['Venue', 'Revenue', 'Gross profit'],
      rows: SAMPLE_STUDIO.venues.map(venue => [venue.name, formatSampleYen(venue.revenue), formatSampleYen(venue.profit)]),
    },
    table: null,
    evidence: [
      { label: 'Total', formula: `Counter + Lounge + Terrace revenue = ${formatSampleYen(SAMPLE_STUDIO.venues.reduce((sum, venue) => sum + venue.revenue, 0))}.` },
      { label: 'Scope', formula: 'These venue names exist only in the sample studio.' },
    ],
    followups: ['Why did profit decrease?', 'Which products have the highest margin?'],
  })
}

function stock() {
  return base({
    text: 'Sample studio. Three fictional items sit below their sample minimum. A purchase order was not created.',
    kpis: [
      { label: 'Alerts', value: String(SAMPLE_STUDIO.alerts.length), note: 'Sample items' },
      { label: 'Lowest', value: SAMPLE_STUDIO.alerts[0].item, note: `${SAMPLE_STUDIO.alerts[0].onHand} on hand` },
    ],
    chart: null,
    bars: {
      kind: 'bar',
      title: 'On hand against minimum',
      points: SAMPLE_STUDIO.alerts.map(alert => ({ label: alert.item, value: alert.onHand, marker: alert.minimum })),
    },
    comparison: null,
    table: {
      columns: ['Item', 'On hand', 'Minimum'],
      rows: SAMPLE_STUDIO.alerts.map(alert => [alert.item, String(alert.onHand), String(alert.minimum)]),
    },
    evidence: [
      { label: 'Draft', formula: 'A purchase order is not created from the sample studio.' },
      { label: 'Scope', formula: 'Inventory quantities were not read from a ledger.' },
    ],
    followups: ['Which products have the highest margin?', 'How much did we make this month?'],
  })
}

export function composeSampleAnswer(question) {
  const q = String(question || '').toLowerCase()
  if (/purchase order|reorder|running low|low-stock|low stock|restock|発注/.test(q)) return stock()
  if (/why|decrease|drop|fell|lower/.test(q) && /profit|margin/.test(q)) return profitDrop()
  if (/product|margin|best-selling|best selling|ranking/.test(q)) return products()
  if (/venue|compare|comparison|other bar/.test(q)) return venues()
  if (/labor|payroll|shift/.test(q)) {
    const current = monthPair().current
    return base({
      text: `Sample studio. Labor is ${current.laborPct}% of September sample revenue. No time clock was read.`,
      kpis: [{ label: 'Labor', value: `${current.laborPct}%`, note: 'September sample' }],
      chart: {
        kind: 'line',
        title: 'Labor share',
        points: SAMPLE_STUDIO.months.map(month => ({ label: month.label, value: month.laborPct })),
      },
      bars: null,
      comparison: null,
      table: null,
      evidence: [{ label: 'Scope', formula: 'Payroll and punches were not loaded.' }],
      followups: ['Why did profit decrease?', 'How much did we make this month?'],
    })
  }
  return overview()
}
