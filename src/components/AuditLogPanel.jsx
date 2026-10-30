import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useI18n } from '../lib/i18n'
import { asReactText } from '../lib/errText'
import { auditSubject, changedFields, loadAudit } from '../lib/audit'
import { PortalSurface } from './ui/PageLayout'

const TABLES = ['faturas', 'fatura_pagamentos', 'ryoshusho', 'produtos', 'compras']

/** Who created, changed or deleted invoices, payments, receipts, products and purchases. */
export default function AuditLogPanel() {
  const { t, lang } = useI18n()
  const [tabela, setTabela] = useState('')
  const [state, setState] = useState({ rows: [], missing: false, loading: true })

  useEffect(() => {
    let alive = true
    setState(s => ({ ...s, loading: true }))
    loadAudit(supabase, { tabela: tabela || undefined }).then(r => { if (alive) setState({ ...r, loading: false }) })
    return () => { alive = false }
  }, [tabela])

  const fmtWhen = iso => new Date(iso).toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })

  return (
    <PortalSurface style={{ padding: 16, marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{t('audit.title')}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>{t('audit.subtitle')}</div>
        </div>
        <select className="input" style={{ padding: '4px 8px', fontSize: 12, width: 'auto' }} value={tabela} onChange={e => setTabela(e.target.value)}>
          <option value="">{t('audit.all')}</option>
          {TABLES.map(k => <option key={k} value={k}>{t(`audit.table.${k}`)}</option>)}
        </select>
      </div>
      {state.missing ? (
        <div style={{ fontSize: 12, color: 'var(--text2)' }}>{t('audit.notReady')}</div>
      ) : state.loading ? (
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>{t('common.loading')}</div>
      ) : state.rows.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>{t('audit.empty')}</div>
      ) : (
        <div style={{ maxHeight: 360, overflowY: 'auto' }}>
          {state.rows.map(r => {
            const fields = changedFields(r.antes, r.depois)
            return (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
                <span style={{ color: 'var(--text3)' }}>{fmtWhen(r.criado_em)}</span>
                <span>
                  <b>{asReactText(r.user_nome || t('audit.system'))}</b>{' '}
                  {t(`audit.action.${r.acao}`)} · {t(`audit.table.${r.tabela}`)} <b>{asReactText(auditSubject(r))}</b>
                  {fields.length > 0 && <span style={{ color: 'var(--text3)' }}> ({fields.join(', ')})</span>}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </PortalSurface>
  )
}
