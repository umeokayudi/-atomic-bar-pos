import { useState } from 'react'
import { confirmAiAction } from '../lib/aiAgent'
import { useI18n } from '../lib/i18n'

/** One card per AI proposal. Nothing is written until the user presses Confirm. */
function ActionCard({ proposal, onSaved }) {
  const { t } = useI18n()
  const [state, setState] = useState(proposal.ok ? 'pending' : 'invalid')
  const [note, setNote] = useState('')

  async function confirm() {
    if (state !== 'pending') return
    setState('saving')
    try {
      const out = await confirmAiAction(proposal)
      setNote(out.message || '')
      setState('done')
      onSaved?.(proposal, out)
    } catch (e) {
      setNote(e.message)
      setState('failed')
    }
  }

  const tone = state === 'done' ? 'is-done' : state === 'failed' || state === 'invalid' ? 'is-bad' : ''
  return (
    <div className={`ai-act-card ${tone}`}>
      <div className="ai-act-tag">
        {state === 'invalid' ? t('aiAct.cannot')
          : state === 'done' ? `✓ ${t('aiAct.done')}`
            : state === 'failed' ? t('aiAct.failed')
              : state === 'cancelled' ? t('aiAct.cancelled')
                : t('aiAct.needsConfirm')}
      </div>
      {proposal.ok ? (
        <>
          <div className="ai-act-title">{proposal.title}</div>
          <ul className="ai-act-lines">
            {(proposal.lines || []).map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </>
      ) : (
        <div className="ai-act-title">{proposal.error}</div>
      )}
      {note && <div className="ai-act-note">{note}</div>}
      {(state === 'pending' || state === 'saving') && (
        <div className="ai-act-buttons">
          <button type="button" className="btn-primary" disabled={state === 'saving'} onClick={confirm}>
            {state === 'saving' ? t('aiAct.saving') : t('aiAct.confirm')}
          </button>
          <button type="button" className="ai-act-cancel" disabled={state === 'saving'} onClick={() => setState('cancelled')}>
            {t('aiAct.cancel')}
          </button>
        </div>
      )}
    </div>
  )
}

export default function AiActionCards({ proposals, onSaved }) {
  if (!proposals?.length) return null
  return (
    <div className="ai-act-list">
      {proposals.map((p, i) => <ActionCard key={p.key || i} proposal={p} onSaved={onSaved} />)}
    </div>
  )
}
