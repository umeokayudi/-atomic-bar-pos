import { useEffect, useRef, useState } from 'react'
import { compactContext, useAiPanel } from '../../lib/aiPanel'
import { useI18n } from '../../lib/i18n'
import Icon from '../ui/Icon'
import AiChat from './AiChat'

/** The header button. Same place on every admin screen. */
export function AskAiButton({ className = '' }) {
  const { enabled, openAi } = useAiPanel()
  const { t } = useI18n()
  if (!enabled) return null
  return (
    <button type="button" className={`ui-btn ui-ask-ai ${className}`.trim()} onClick={() => openAi()} title={`${t('ai.ask')} (Ctrl+J)`}>
      <Icon name="ai" size={16} />
      <span className="ui-ask-ai-label">{t('ai.ask')}</span>
    </button>
  )
}

/** Side panel. The page underneath stays mounted, so its filters and forms are untouched. */
export default function AskAiDrawer() {
  const { enabled, open, closeAi, ctx, seed, seedSend, setSeed } = useAiPanel()
  const { t } = useI18n()
  const [thread, setThread] = useState({ id: 'panel', messages: [] })
  const lastModule = useRef(ctx.module)
  const closeRef = useRef(null)

  // A new screen starts a fresh conversation (its context is different).
  useEffect(() => {
    if (lastModule.current !== (ctx.screen || ctx.module)) {
      lastModule.current = ctx.screen || ctx.module
      setThread({ id: `panel-${Date.now()}`, messages: [] })
    }
  }, [ctx.screen, ctx.module])

  useEffect(() => {
    if (!open) return undefined
    const onKey = e => { if (e.key === 'Escape') closeAi() }
    window.addEventListener('keydown', onKey)
    closeRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeAi])

  if (!enabled || !open) return null
  const c = compactContext(ctx)
  return (
    <>
      <div className="ui-drawer-scrim" onClick={closeAi} />
      <aside className="ui-drawer ai-drawer" role="dialog" aria-modal="true" aria-label={t('ai.ask')}>
        <div className="ui-drawer-head">
          <span className="ui-kpi-icon"><Icon name="ai" size={18} /></span>
          <div className="ui-drawer-title">
            {t('ai.ask')}
            <div className="ui-card-sub">{c.page || t(`ai.module.${ctx.module || 'overview'}`)}</div>
          </div>
          <button type="button" className="ui-btn is-ghost is-sm" onClick={() => setThread({ id: `panel-${Date.now()}`, messages: [] })}>{t('ai.newChat')}</button>
          <button ref={closeRef} type="button" className="ui-btn is-ghost is-icon" onClick={closeAi} aria-label={t('common.close')}><Icon name="close" /></button>
        </div>
        <div className="ai-drawer-ctx" aria-label={t('ai.seesTitle')}>
          <span className="ui-badge is-accent">{t(`ai.module.${ctx.module || 'overview'}`)}</span>
          {c.unit && <span className="ui-badge">{c.unit}</span>}
          <span className="ui-badge">{c.period || t('ai.lastDays', { n: ctx.days || 30 })}</span>
          {c.filters && Object.entries(c.filters).map(([k, v]) => <span key={k} className="ui-badge">{k}: {v}</span>)}
        </div>
        <div className="ui-drawer-body ai-drawer-body">
          <AiChat ctx={ctx} thread={thread} seed={seed} seedSend={seedSend} onSeedUsed={() => setSeed('')} autoFocus compact />
        </div>
      </aside>
    </>
  )
}
