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

const VERDICT_STYLE = {
  pay_now: { bg: '#f0fdf4', border: '#86efac', icon: '💵', label: 'Pagar à vista' },
  pay_later: { bg: '#eff6ff', border: '#93c5fd', icon: '📅', label: 'Pagar a prazo' },
  caution: { bg: '#fffbeb', border: '#fcd34d', icon: '⚠️', label: 'Atenção' },
  neutral: { bg: 'var(--bg3)', border: 'var(--border)', icon: '📊', label: 'Análise' },
  incomplete: { bg: 'var(--bg3)', border: 'var(--border)', icon: '—', label: 'Aguardando' },
}

const PRESSURE_LABEL = { alta: 'Alta', média: 'Média', baixa: 'Baixa' }

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
    const text = await callGeminiChat({ ...prompt, temperature: 0.4, maxOutputTokens: 900 })
    setAiText(text)
    setAiLoading(false)
  }

  if (!purchaseAmount || purchaseAmount <= 0) {
    if (compact) return null
    return (
      <div style={{ background: 'var(--bg3)', borderRadius: 12, padding: 14, fontSize: 12, color: 'var(--text2)' }}>
        💡 Informe fornecedor e valor — a IA compara pagar à vista vs a prazo com base na <strong>JBM Holding</strong>.
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
            {style.icon} Advisor JBM Holding · custo oport. {analysis.opportunityCostPct}%/ano
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--navy)', lineHeight: 1.3 }}>
            {analysis.headline}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowSettings(s => !s)}
          style={{ fontSize: 11, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'white', cursor: 'pointer' }}
        >
          ⚙️ {showSettings ? 'Ocultar' : 'Premissas'}
        </button>
      </div>

      {showSettings && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 10, marginBottom: 14, fontSize: 12 }}>
          {[
            ['cashDiscountPct', 'Desconto à vista %'],
            ['cardFeePct', 'Taxa cartão %'],
            ['daysToCollectBar', 'Dias p/ cobrar bar'],
            ['minCashBuffer', 'Buffer mínimo ¥'],
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
            <div style={{ color: 'var(--text2)' }}>Caixa líquido</div>
            <strong>{fmtYen(analysis.cashflow.netCash)}</strong>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.6)', borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ color: 'var(--text2)' }}>Projetado 30d</div>
            <strong style={{ color: analysis.cashflow.projectedCash >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {fmtYen(analysis.cashflow.projectedCash)}
            </strong>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.6)', borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ color: 'var(--text2)' }}>Cobrar do bar</div>
            <strong>~dia {analysis.timeline.collectDay}</strong>
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto', marginBottom: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Opção', 'Paga dia', 'Custo efetivo', 'Pressão caixa'].map(h => (
                <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, color: 'var(--text2)', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {analysis.scenarios.map((sc, i) => (
              <tr key={sc.id} style={{ background: i === 0 ? 'rgba(255,255,255,0.5)' : 'transparent', borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '8px', fontWeight: i === 0 ? 700 : 500 }}>{i === 0 ? '🏆 ' : ''}{sc.label}</td>
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
                    background: sc.cashPressure === 'alta' ? '#fef2f2' : sc.cashPressure === 'média' ? '#fffbeb' : '#f0fdf4',
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
        style={{
          padding: '10px 16px', borderRadius: 10, border: 'none',
          background: 'var(--navy)', color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer',
        }}
      >
        {aiLoading ? 'Analisando...' : '🤖 IA Holding: à vista ou a prazo?'}
      </button>

      {aiLoading && <div style={{ marginTop: 10 }}><Spinner text="IA sincronizada com JBM Holding..." /></div>}
      {aiText && !aiLoading && (
        <div style={{
          marginTop: 12, padding: '12px 14px', background: 'white',
          borderRadius: 12, fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap',
          border: '1px solid var(--border)',
        }}>
          {aiText}
        </div>
      )}
    </div>
  )
}
