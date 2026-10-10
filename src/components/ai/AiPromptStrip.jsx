import { useEffect } from 'react'
import { NOTES_MAX, useAiPanel } from '../../lib/aiPanel'
import { useI18n } from '../../lib/i18n'
import Icon from '../ui/Icon'
import AiChat from './AiChat'

/**
 * Where a screen used to embed its own AI chat: a row of suggested questions that open the one
 * "Ask AI" panel, with this screen's data passed along as context. Without the panel (no shell),
 * the same chat shows inline so the screen keeps its AI.
 */
export default function AiPromptStrip({ title, hint, prompts = [], notes = '', module }) {
  const { t } = useI18n()
  const panel = useAiPanel()
  const screen = panel.ctx?.screen || panel.ctx?.module
  const text = String(notes || '').slice(0, NOTES_MAX)

  useEffect(() => {
    if (!panel.enabled || !screen) return
    panel.setPageCtx(screen, { notes: text, ...(module ? { module } : {}) })
  }, [panel.enabled, screen, text, module]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!panel.enabled) {
    return (
      <section className="ai-strip is-inline" aria-label={title || t('ai.ask')}>
        <div className="ai-strip-head"><span className="ai-strip-icon"><Icon name="ai" size={16} /></span><strong>{title || t('ai.ask')}</strong></div>
        <AiChat compact ctx={{ module: module || 'overview', title, notes: text }} />
      </section>
    )
  }

  return (
    <section className="ai-strip" aria-label={title || t('ai.ask')}>
      <div className="ai-strip-head">
        <span className="ai-strip-icon"><Icon name="ai" size={16} /></span>
        <div>
          <strong>{title || t('ai.ask')}</strong>
          {hint && <span>{hint}</span>}
        </div>
        <button type="button" className="ui-btn is-sm" onClick={() => panel.openAi('')}>
          <Icon name="ai" size={14} /> {t('ai.askAnything')}
        </button>
      </div>
      {prompts.length > 0 && (
        <div className="ai-strip-chips">
          {prompts.map(p => (
            <button key={p} type="button" className="ai-strip-chip" onClick={() => panel.openAi(p, true)}>{p}</button>
          ))}
        </div>
      )}
    </section>
  )
}
