/** Deterministic cash-close explanation. It never closes the drawer and never calls a model. */

export function explainCashClose(snapshot) {
  const sources = Array.isArray(snapshot?.sources) ? snapshot.sources.map(item => String(item)) : []
  const required = ['barId', 'operationalDay', 'expected', 'counted']
  const missing = required.filter(key => {
    const value = snapshot?.[key]
    return value === undefined || value === null || value === ''
  })
  const expected = Number(snapshot?.expected)
  const counted = Number(snapshot?.counted)
  const numbersOk = Number.isInteger(expected) && Number.isInteger(counted)
  if (missing.length || !numbersOk) {
    const gaps = missing.length ? missing : ['expected', 'counted']
    return {
      executed: false,
      requiresApproval: true,
      variance: null,
      missing: gaps,
      text: 'Cash close cannot be explained. Required figures are missing, so no variance was calculated and the register was not closed.',
      sources,
    }
  }
  const variance = counted - expected
  return {
    executed: false,
    requiresApproval: true,
    variance,
    missing: [],
    text: `Expected ${expected}, counted ${counted}, variance ${variance}. This explanation does not close the register. A person must approve a close before cash_close_night runs.`,
    sources: sources.length ? sources : ['cash_drawer_expected', 'counted cash entered by a person'],
  }
}
