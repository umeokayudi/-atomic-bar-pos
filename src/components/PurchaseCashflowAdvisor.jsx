import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { callGeminiChat } from '../lib/ai'
import { fmtYen, Spinner } from './utils'
import {
  analyzePurchaseCashflow,
  buildAIAdvisorPrompt,
  DEFAULTS,
  loadCashflowSnapshot,
} from '../lib/purchaseCashflowAdvisor'
import { loadHoldingLocal, syncHoldingFromCloud } from '../lib/jbmHolding'
import { useAiPanel } from '../lib/aiPanel'
import Icon from './ui/Icon'

const VERDICT_STYLE = {
  pay_now: { bg: 'var(--c-success-bg)', border: 'color-mix(in srgb, var(--c-success) 35%, transparent)', icon: 'payCash', label: 'Pay cash' },
  pay_later: { bg: 'var(--c-info-bg)', border: 'color-mix(in srgb, var(--c-info) 35%, transparent)', icon: 'shifts', label: 'Pay on terms' },
  caution: { bg: 'var(--c-warning-bg)', border: 'color-mix(in srgb, var(--c-warning) 35%, transparent)', icon: 'warning', label: 'Caution' },
  neutral: { bg: 'var(--c-surface-2)', border: 'var(--c-border)', icon: 'report', label: 'Analysis' },
  incomplete: { bg: 'var(--c-surface-2)', border: 'var(--c-border)', icon: 'info', label: 'Waiting' },
}

const PRESSURE_LABEL = { alta: 'High', média: 'Medium', baixa: 'Low' }

export default function PurchaseCashflowAdvisor({
  purchaseAmount = 0,
  supplierName = '',
  supplierPayment = 'Cash',
  deliveryDays = 1,
  pointsPct = 0,
  productName = '',
  categoria = 'Others',
  qtd = 1,
  jbmSellPrice = 0,
  posProjectedRevenue = 0,
  compact = false,
}) {
  const [cashflow, setCashflow] = useState(null)
  const [holding, setHolding] = useState(null)
  const [settings, setSettings] = useState({ ...DEFAULTS })
  const [showSettings, setShowSettings] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const panel = useAiPanel()

  useEffect(() => {
    loadCashflowSnapshot(supabase).then(setCashflow).catch(() => setCashflow({}))
    syncHoldingFromCloud().then(setHolding).catch(() => setHolding(loadHoldingLocal()))
  }, [])

  const analysis = useMemo(() => analyzePurchaseCashflow({
    purchaseAmount,
    supplierPayment,
    deliveryDays,
    pointsPct,
    jbmSellPrice,
    posProjectedRevenue,
    qtd,
    categoria,
    cashflow: cashflow || {},
    settings,
    holding: holding || loadHoldingLocal(),
  }), [purchaseAmount, supplierPayment, deliveryDays, pointsPct, jbmSellPrice, posProjectedRevenue, qtd, categoria, cashflow, settings, holding])

  const style = VERDICT_STYLE[analysis.verdict] || VERDICT_STYLE.neutral

  async function askAI() {
    setAiLoading(true)
    setAiText('')
    const prompt = buildAIAdvisorPrompt(analysis, {
      supplierName,
      productName,
      categoria,
      purchaseAmount,
      supplierPayment,
      deliveryDays,
      pointsPct,
      holding: holding || loadHoldingLocal(),
    })
    // With the Ask AI panel: hand it this purchase and ask there, so the answer can be followed up.
    if (panel.enabled) {
      const screen = panel.ctx?.screen || panel.ctx?.module
      if (screen) panel.setPageCtx(screen, { notes: `${prompt.system}\n\n${prompt.messages.map(m => m.content).join('\n')}` })
      setAiLoading(false)
      panel.openAi('Cash or terms for this purchase? Give the recommendation first.', true)
      return
    }
    const text = await callGeminiChat({ ...prompt, temperature: 0.4, maxOutputTokens: 900 })
    setAiText(text)
    setAiLoading(false)
  }

  if (!purchaseAmount || purchaseAmount <= 0) {
    if (compact) return null
    return (
      <div style={{ background: 'var(--bg3)', borderRadius: 12, padding: 14, fontSize: 12, color: 'var(--text2)' }}>
        <Icon name="idea" size={14} /> Enter the supplier and the amount — AI compares paying cash vs on terms using <strong>JBM Holding</strong>.
      </div>
    )
  }

  return (
    <div style={{
      background: style.bg,
      border: `1px solid ${style.border}`,
      borderRadius: 16,
      padding: compact ? '14px 16px' : '18px 20px',
      marginTop: compact ? 0 : 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text2)', marginBottom: 4 }}>
            <Icon name={style.icon} size={13} /> Advisor JBM Holding · custo oport. {analysis.opportunityCostPct}%/ano
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--c-text)', lineHeight: 1.3 }}>
            {analysis.headline}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowSettings(s => !s)}
          style={{ fontSize: 11, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', cursor: 'pointer' }}
        >
          <Icon name="settings" size={13} /> {showSettings ? 'Hide' : 'Assumptions'}
        </button>
      </div>

      {showSettings && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 10, marginBottom: 14, fontSize: 12 }}>
          {[
            ['cashDiscountPct', 'Cash discount %'],
            ['cardFeePct', 'Card fee %'],
            ['daysToCollectBar', 'Days to collect from bar'],
            ['minCashBuffer', 'Minimum buffer ¥'],
          ].map(([key, label]) => (
            <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'var(--text2)' }}>{label}</span>
              <input
                type="number"
                value={settings[key]}
                onChange={e => setSettings(s => ({ ...s, [key]: +e.target.value }))}
                style={{ padding: '6px 8px', borderRadius: 8, fontSize: 12 }}
              />
            </label>
          ))}
        </div>
      )}

      {cashflow && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 14, fontSize: 11 }}>
          <div style={{ background: 'rgba(255,255,255,0.6)', borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ color: 'var(--text2)' }}>Net cash</div>
            <strong>{fmtYen(analysis.cashflow.netCash)}</strong>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.6)', borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ color: 'var(--text2)' }}>Projected 30d</div>
            <strong style={{ color: analysis.cashflow.projectedCash >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {fmtYen(analysis.cashflow.projectedCash)}
            </strong>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.6)', borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ color: 'var(--text2)' }}>Collect from bar</div>
            <strong>~dia {analysis.timeline.collectDay}</strong>
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto', marginBottom: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Option', 'Pays on day', 'Effective cost', 'Cash pressure'].map(h => (
                <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {analysis.scenarios.map((sc, i) => (
              <tr key={sc.id} style={{ background: i === 0 ? 'rgba(255,255,255,0.5)' : 'transparent', borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px', fontWeight: i === 0 ? 700 : 500 }}>{sc.label}</td>
                <td style={{ padding: '8px' }}>Dia {sc.paymentDay}</td>
                <td style={{ padding: '8px', fontWeight: 700 }}>
                  {fmtYen(sc.effectiveCost)}
                  {sc.opportunityCost > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--amber)', fontWeight: 500 }}>
                      +{fmtYen(sc.opportunityCost)} oportunidade
                    </div>
                  )}
                </td>
                <td style={{ padding: '8px' }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                    background: sc.cashPressure === 'alta' ? 'var(--red-bg)' : sc.cashPressure === 'média' ? 'var(--amber-bg)' : 'var(--green-bg)',
                    color: sc.cashPressure === 'alta' ? 'var(--red)' : sc.cashPressure === 'média' ? 'var(--amber)' : 'var(--green)',
                  }}>
                    {PRESSURE_LABEL[sc.cashPressure] || sc.cashPressure}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {analysis.reasons.length > 0 && (
        <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>
          {analysis.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}

      <button
        type="button"
        onClick={askAI}
        disabled={aiLoading}
        className="ui-btn is-primary is-sm"
      >
        <Icon name="ai" size={14} /> {aiLoading ? 'Analyzing...' : 'Ask AI: cash or terms?'}
      </button>

      {aiLoading && <div style={{ marginTop: 10 }}><Spinner text="AI synced with JBM Holding..." /></div>}
      {aiText && !aiLoading && (
        <div style={{
          marginTop: 12, padding: '12px 14px', background: 'var(--bg2)',
          borderRadius: 12, fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap',
          border: '1px solid var(--border)',
        }}>
          {aiText}
        </div>
      )}
    </div>
  )
}
