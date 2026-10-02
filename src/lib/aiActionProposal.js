/** Proposal lifecycle. Execution is refused unless staging is operational, and this module never writes. */

const NUMBER_RE = /-?\d[\d,]*(?:\.\d+)?/g

export function numbersIn(value) {
  return [...String(value ?? '').matchAll(NUMBER_RE)].map(match => match[0].replace(/,/g, ''))
}

export function groundNumbers(text, allowed) {
  const permitted = new Set((allowed || []).map(item => String(item).replace(/,/g, '')))
  const invented = numbersIn(text).filter(item => !permitted.has(item))
  return { grounded: invented.length === 0, invented }
}

export function createProposal({ action, sources, rationale, impact, risk = 'low', figures = [] } = {}) {
  if (!action) return { ok: false, error: 'An action is required.' }
  if (!sources?.length) return { ok: false, error: 'Source data is required.' }
  const grounding = groundNumbers(`${rationale || ''} ${impact || ''}`, figures)
  if (!grounding.grounded) return { ok: false, error: 'The proposal contains a figure that is not in the source.', invented: grounding.invented }
  return {
    ok: true,
    action,
    sources,
    rationale: rationale || '',
    impact: impact || '',
    risk,
    approval: 'draft',
    execution: 'not_started',
    verification: 'unverified',
    executed: false,
  }
}

export function approveProposal(proposal) {
  if (!proposal?.ok || proposal.approval !== 'draft') return { ...proposal, ok: false, executed: false, error: 'Only a draft can be approved.' }
  return { ...proposal, approval: 'approved', executed: false }
}

export function executeProposal(proposal, staging) {
  if (!proposal?.ok || proposal.approval !== 'approved') {
    return { ...proposal, execution: 'blocked', verification: 'not_executed', executed: false, error: 'Approval is required before execution.' }
  }
  if (!staging?.operational) {
    return {
      ...proposal,
      execution: 'blocked',
      verification: 'staging_required',
      executed: false,
      error: 'Execution did not run. Isolated staging is not connected.',
    }
  }
  return { ...proposal, execution: 'blocked', verification: 'not_connected', executed: false, error: 'No writer is attached.' }
}
