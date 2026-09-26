/** Four money books. Never add POS till, JBM bill, wages or rent together. */

export function splitCostBooks({
  posMonthTotal = 0,
  jbmMonthBill = 0,
  staffMonthPay = 0,
  rentMonth = 0,
} = {}) {
  return {
    pos: {
      id: 'pos',
      kind: 'till',
      amount: Math.round(+posMonthTotal || 0),
    },
    jbm: {
      id: 'jbm',
      kind: 'bill',
      amount: Math.round(+jbmMonthBill || 0),
    },
    staff: {
      id: 'staff',
      kind: 'wages',
      amount: Math.round(+staffMonthPay || 0),
    },
    rent: {
      id: 'rent',
      kind: 'overhead',
      amount: Math.round(+rentMonth || 0),
    },
  }
}

export function booksAreSeparate(books) {
  return (
    books?.pos?.kind === 'till'
    && books?.jbm?.kind === 'bill'
    && books?.staff?.kind === 'wages'
    && books?.rent?.kind === 'overhead'
  )
}

export function booksGrandTotal(books) {
  return null
}

export function splitOverhead(rows = [], monthKey) {
  const fixed = (rows || []).filter(r => r.kind === 'fixo')
  const variable = (rows || []).filter(r => r.kind === 'variavel' && r.month_key === monthKey)
  const sum = list => Math.round(list.reduce((a, r) => a + (+r.amount || 0), 0))
  return {
    fixed,
    variable,
    fixedTotal: sum(fixed),
    variableTotal: sum(variable),
  }
}

export function rentForMonth(rows = [], monthKey) {
  const match = (rows || []).find(r => r.kind === 'rent' && r.month_key === monthKey)
  return Math.round(+match?.amount || 0)
}

export function lastRentOnOrBefore(rows = [], monthKey) {
  const list = (rows || [])
    .filter(r => r.kind === 'rent' && r.month_key && String(r.month_key) <= String(monthKey) && +r.amount > 0)
    .sort((a, b) => String(b.month_key).localeCompare(String(a.month_key)))
  return list[0] || null
}

/** Template for a month with no rent row — prefer earlier months, else any known rent. */
export function lastKnownRent(rows = [], monthKey) {
  const prior = lastRentOnOrBefore(rows, monthKey)
  if (prior && prior.month_key !== monthKey) return prior
  const list = (rows || [])
    .filter(r => r.kind === 'rent' && r.month_key && r.month_key !== monthKey && +r.amount > 0)
    .sort((a, b) => String(b.month_key).localeCompare(String(a.month_key)))
  return list[0] || null
}
