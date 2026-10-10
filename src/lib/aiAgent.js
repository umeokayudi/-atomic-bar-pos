import { staffFetch } from './apiAuth'
import { errText } from './errText'

async function post(body) {
  const res = await staffFetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module: 'agent', ...body }),
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { error: text?.slice(0, 200) || res.statusText } }
  if (!res.ok || data.error) throw new Error(errText(data.error, res.statusText))
  return data
}

/** Ask the AI. Nothing is written: returns { reply, proposals } for the user to confirm. */
export function planAiActions({ messages, image, screen, analysis }) {
  return post({ step: 'plan', messages, image, screen, analysis })
}

/** Write one proposal the user confirmed. The server re-checks it against fresh data first. */
export function confirmAiAction(proposal) {
  return post({ step: 'execute', proposal: { key: proposal.key, type: proposal.type, params: proposal.params } })
}
