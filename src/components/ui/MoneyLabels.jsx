import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { moneyBuckets } from '../../lib/money'
import { useI18n } from '../../lib/i18n'
import { fmtYen } from '../utils'
import './moneyLabels.css'

/**
 * The same four numbers on every money screen (Missão Máxima 4.4):
 * FATURADO × RECEBIDO (confirmado) × A RECEBER × PENDENTE DE CONFIRMAÇÃO.
 * Pending credit is shown on its own and is never part of "received".
 */
export function MoneyLabels({ buckets, compact = false }) {
  const { t } = useI18n()
  const b = buckets || { faturado: 0, recebido: 0, aReceber: 0, pendente: 0 }
  const cells = [
    ['faturado', b.faturado, ''],
    ['recebido', b.recebido, 'is-ok'],
    ['aReceber', b.aReceber, 'is-due'],
    ['pendente', b.pendente, 'is-pending'],
  ]
  return (
    <div className={`money-labels${compact ? ' is-compact' : ''}`} role="group" aria-label={`${t('mm.money.faturado')} / ${t('mm.money.recebido')}`}>
      {cells.map(([k, v, cls]) => (
        <div key={k} className={`money-label ${cls}`}>
          <div className="money-label-name">{t(`mm.money.${k}`)}</div>
          <div className="money-label-value">{fmtYen(Math.round(v || 0))}</div>
          {!compact && <div className="money-label-hint">{t(`mm.money.${k}Hint`)}</div>}
        </div>
      ))}
    </div>
  )
}

/** Loads invoices and payments itself (all bars, or one bar; optional month 'YYYY-MM' by invoice period). */
export default function MoneyLabelsLive({ barId = null, month = null, compact = false, refreshKey = 0 }) {
  const { t } = useI18n()
  const [state, setState] = useState({ loading: true, error: '', buckets: null })
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        let q = supabase.from('faturas').select('id,bar_id,total,valor,pago,status,periodo_inicio,periodo_fim,data_emissao')
        if (barId) q = q.eq('bar_id', barId)
        const { data: faturas, error } = await q
        if (error) throw error
        let list = faturas || []
        if (month) list = list.filter(f => String(f.periodo_inicio || f.data_emissao || '').slice(0, 7) <= month && month <= String(f.periodo_fim || f.periodo_inicio || f.data_emissao || '').slice(0, 7))
        const ids = list.map(f => f.id)
        let pagamentos = []
        if (ids.length) {
          const r = await supabase.from('fatura_pagamentos').select('id,fatura_id,valor,metodo,confirmado').in('fatura_id', ids)
          if (r.error) throw r.error
          pagamentos = r.data || []
        }
        if (alive) setState({ loading: false, error: '', buckets: moneyBuckets(list, pagamentos) })
      } catch {
        if (alive) setState({ loading: false, error: t('mm.money.loadError'), buckets: null })
      }
    })()
    return () => { alive = false }
  }, [barId, month, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps
  if (state.error) return <div className="money-labels-error" role="alert">{state.error}</div>
  if (state.loading) return <div className="money-labels is-loading" aria-busy="true">{[0, 1, 2, 3].map(i => <div key={i} className="money-label"><div className="money-label-name">&nbsp;</div><div className="money-label-value">…</div></div>)}</div>
  return <MoneyLabels buckets={state.buckets} compact={compact} />
}
