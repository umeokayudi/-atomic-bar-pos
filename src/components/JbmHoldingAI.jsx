import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { callGeminiChat } from '../lib/ai'
import { Spinner, fmtYen } from './utils'
import { staffFetch } from '../lib/apiAuth'
import {
  fetchHoldingSystemSnapshot,
  buildHoldingFullAuditPrompt,
  buildHoldingChatSystem,
} from '../lib/holdingDataSync'
import AiPromptStrip from './ai/AiPromptStrip'
import { PortalKpi, PortalSurface } from './ui/PageLayout'
import Icon from './ui/Icon'

const QUICK_PROMPTS = [
  'Full check: is everything sustainable?',
  'Can I buy drinks for cash now, or is it better on terms?',
  'Can cash take another large purchase this week?',
  'What is at urgent risk?',
  'How should capital be split between JBM Drinks and the other businesses?',
]

/**
 * Holding view: live checks, the full audit, and questions through the one "Ask AI" panel
 * (with the holding snapshot passed as screen data).
 */
export default function JbmHoldingAI({ holdingProfile }) {
  const [snapshot, setSnapshot] = useState(null)
  const [loadingSnap, setLoadingSnap] = useState(true)
  const [auditText, setAuditText] = useState('')
  const [auditLoading, setAuditLoading] = useState(false)

  useEffect(() => {
    refreshSnapshot()
  }, [holdingProfile]) // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshSnapshot() {
    setLoadingSnap(true)
    try {
      const local = await fetchHoldingSystemSnapshot(supabase, holdingProfile)
      setSnapshot(local)
      // Server-side figures when the endpoint is available
      try {
        const res = await staffFetch('/api/holding-audit')
        if (res.ok) {
          const server = await res.json()
          setSnapshot(s => ({ ...s, ...server, holding: s?.holding || server.holding }))
        }
      } catch { /* client snapshot ok */ }
    } catch (e) {
      setSnapshot({ erro: e.message })
    }
    setLoadingSnap(false)
  }

  async function runFullAudit() {
    if (!snapshot) await refreshSnapshot()
    setAuditLoading(true)
    setAuditText('')
    const prompt = buildHoldingFullAuditPrompt(snapshot || {})
    const text = await callGeminiChat({ ...prompt, temperature: 0.35, maxOutputTokens: 2048 })
    setAuditText(text)
    setAuditLoading(false)
  }

  const ok = snapshot && !snapshot.erro
  const notes = ok ? buildHoldingChatSystem(snapshot) : ''

  return (
    <div className="holding-ai">
      <div className="holding-ai-head">
        <div>
          <div className="portal-section-title">JBM Holding</div>
          <div className="portal-section-sub">Connected to system data: cash, invoices, purchases, sales, suppliers, POS prices</div>
        </div>
        <div className="ui-row is-wrap">
          <button type="button" className="ui-btn is-sm" onClick={refreshSnapshot} disabled={loadingSnap}>
            <Icon name="refresh" size={14} /> {loadingSnap ? '…' : 'Refresh data'}
          </button>
          <button type="button" className="ui-btn is-sm is-primary" onClick={runFullAudit} disabled={auditLoading}>
            <Icon name="search" size={14} /> {auditLoading ? 'Analyzing…' : 'Check everything'}
          </button>
        </div>
      </div>

      {ok && (
        <div className="portal-hero-grid">
          <PortalKpi icon="ok" tone={snapshot.checksOk === snapshot.checksTotal ? 'success' : 'warning'} label="Checks" value={`${snapshot.checksOk}/${snapshot.checksTotal}`} />
          <PortalKpi icon="coins" label="Caixa" value={fmtYen(snapshot.financeiro?.caixaLiquido)} />
          <PortalKpi icon="invoices" tone="success" label="A receber" value={fmtYen(snapshot.financeiro?.aReceber)} color="var(--green)" />
          <PortalKpi icon="trendUp" tone="info" label="Proj. 30d" value={fmtYen(snapshot.financeiro?.projetado30d)} sub={`${snapshot.opportunityCostPct}%/ano`} />
        </div>
      )}

      {snapshot?.checks && (
        <div className="holding-checks">
          {snapshot.checks.map((c, i) => (
            <span key={i} className={`ui-badge ${c.ok ? 'is-success' : 'is-danger'}`}>
              <Icon name={c.ok ? 'ok' : 'warning'} size={12} /> {c.label}
            </span>
          ))}
        </div>
      )}

      {auditLoading && <Spinner text="Analyzing the whole JBM Holding system…" />}
      {auditText && !auditLoading && (
        <PortalSurface title="Full audit">
          <div className="holding-audit">{auditText}</div>
        </PortalSurface>
      )}

      <AiPromptStrip title="Ask about the holding" hint="Answers use the figures above." prompts={QUICK_PROMPTS} notes={notes} module="finance" />
    </div>
  )
}
