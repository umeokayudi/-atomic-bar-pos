import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { staffFetch } from '../lib/apiAuth'
import { useAuth } from './Auth'
import { fmtYen, fmtDate, Spinner, Empty } from './utils'
import { AdminPage, PortalKpi, PortalSurface, PortalPills, PortalAlert } from './ui/PageLayout'
import { useI18n } from '../lib/i18n'

function faturaRemaining(f) {
  return Math.max(0, (+f.valor || +f.total || 0) - (+f.pago || 0))
}

export default function ReportsBilling({ onNav }) {
  const { t } = useI18n()
  const { perfil } = useAuth()
  const isAdmin = perfil?.role === 'admin'
  const [tab, setTab] = useState('summary')
  const [loading, setLoading] = useState(true)
  const [hub, setHub] = useState(null)
  const [faturas, setFaturas] = useState([])
  const [pagamentos, setPagamentos] = useState([])
  const [sending, setSending] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const [fR, pR, hubR] = await Promise.all([
        supabase.from('faturas').select('*, bars(nome)').order('data_vencimento', { ascending: true }),
        supabase.from('fatura_pagamentos').select('*, faturas(*, bars(nome))').eq('confirmado', false).order('criado_em', { ascending: false }),
        staffFetch('/api/billing-hub').then(r => r.ok ? r.json() : null).catch(() => null),
      ])
      setFaturas(fR.data || [])
      setPagamentos(pR.data || [])
      setHub(hubR)
    } catch (e) {
      setErr(e.message)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const today = new Date().toISOString().slice(0, 10)
  const pending = faturas.filter(f => f.status !== 'pago')
  const overdue = pending.filter(f => f.data_vencimento && f.data_vencimento < today)
  const totalPending = pending.reduce((a, f) => a + faturaRemaining(f), 0)
  const totalOverdue = overdue.reduce((a, f) => a + faturaRemaining(f), 0)
  const fin = hub?.financeiro

  async function triggerEmail(action) {
    if (!isAdmin) return
    setSending(action)
    setMsg('')
    setErr('')
    try {
      const res = await staffFetch('/api/billing-hub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed')
      setMsg(action === 'report' ? t('billingHub.reportSent') : t('billingHub.remindersSent'))
      await load()
    } catch (e) {
      setErr(e.message)
    }
    setSending('')
  }

  if (loading) return <Spinner text={t('billingHub.loading')} />

  return (
    <AdminPage
      title={t('billingHub.title')}
      subtitle={t('billingHub.subtitle')}
      actions={(
        <PortalPills
          scrollable
          options={[
            ['summary', t('billingHub.tabSummary')],
            ['overdue', t('billingHub.tabOverdue')],
            ['email', t('billingHub.tabEmail')],
          ]}
          value={tab}
          onChange={setTab}
        />
      )}
    >
      {err && <PortalAlert variant="red">{err}</PortalAlert>}
      {msg && <PortalAlert variant="green">{msg}</PortalAlert>}

      {tab === 'summary' && (
        <>
          {overdue.length > 0 && (
            <PortalAlert variant="red">
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('billingHub.overdueAlert', { count: overdue.length })}</div>
              <div style={{ fontSize: 12 }}>{fmtYen(totalOverdue)} {t('billingHub.toCollect')}</div>
            </PortalAlert>
          )}

          <div className="portal-hero-grid admin-kpi-grid" style={{ marginBottom: 16 }}>
            <PortalKpi label={t('billingHub.toReceive')} value={fmtYen(fin?.aReceber ?? totalPending)} color={totalPending > 0 ? 'var(--red)' : 'var(--green)'} onClick={() => onNav?.('faturas')} hint={t('billingHub.openInvoices')} />
            <PortalKpi label={t('billingHub.overdue')} value={String(overdue.length)} color={overdue.length ? 'var(--red)' : 'var(--green)'} sub={fmtYen(totalOverdue)} onClick={() => setTab('overdue')} />
            <PortalKpi label={t('billingHub.monthProfit')} value={fmtYen(fin?.lucroMes ?? 0)} color={(fin?.lucroMes ?? 0) >= 0 ? 'var(--green)' : 'var(--red)'} onClick={() => onNav?.('relatorio')} hint={t('billingHub.openReport')} />
            <PortalKpi label={t('billingHub.pendingProofs')} value={String(pagamentos.length)} color={pagamentos.length ? 'var(--amber)' : 'var(--green)'} onClick={() => onNav?.('faturas')} />
          </div>

          <PortalSurface title={t('billingHub.quickLinks')}>
            <div className="billing-hub-links">
              {[
                { id: 'faturas', icon: '💰', label: t('nav.invoices') },
                { id: 'relatorio', icon: '📈', label: t('nav.report') },
                { id: 'cashflow', icon: '💸', label: t('nav.cashflow') },
              ].map(link => (
                <button key={link.id} type="button" className="billing-hub-link" onClick={() => onNav?.(link.id)}>
                  <span>{link.icon}</span>
                  <span>{link.label}</span>
                </button>
              ))}
            </div>
          </PortalSurface>
        </>
      )}

      {tab === 'overdue' && (
        <PortalSurface title={t('billingHub.overdueList', { count: overdue.length })}>
          {overdue.length === 0 ? (
            <Empty text={t('billingHub.noOverdue')} />
          ) : (
            <div className="billing-hub-list">
              {overdue.map(f => {
                const bar = hub?.overdue?.bars?.find(b => b.barId === f.bar_id)
                const contacts = bar?.contacts || []
                return (
                  <div key={f.id} className="billing-hub-card">
                    <div className="billing-hub-card-head">
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{f.bars?.nome || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                          {t('billingHub.due')} {fmtDate(f.data_vencimento)}
                          {f.periodo_inicio && ` · ${fmtDate(f.periodo_inicio)}–${fmtDate(f.periodo_fim)}`}
                        </div>
                      </div>
                      <div style={{ fontWeight: 800, color: 'var(--red)', fontSize: 16 }}>{fmtYen(faturaRemaining(f))}</div>
                    </div>
                    {contacts.length > 0 ? (
                      <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 8 }}>
                        📧 {contacts.map(c => c.email).join(', ')}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>{t('billingHub.noClientEmail')}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </PortalSurface>
      )}

      {tab === 'email' && (
        <>
          <PortalSurface title={t('billingHub.emailAutomation')} sub={t('billingHub.emailSub')}>
            <div className="billing-hub-status">
              <div className={`billing-hub-chip${hub?.email?.configured ? ' ok' : ' warn'}`}>
                {hub?.email?.configured ? '✅' : '⚠️'} Resend {hub?.email?.configured ? t('billingHub.configured') : t('billingHub.notConfigured')}
              </div>
              <div className="billing-hub-chip">
                📬 {t('billingHub.reportRecipients', { count: hub?.email?.reportRecipients ?? 0 })}
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, marginTop: 12 }}>
              <div>⏰ {t('billingHub.scheduleReport')}: {hub?.email?.schedules?.report || '06:00 UTC'}</div>
              <div>⏰ {t('billingHub.scheduleBilling')}: {hub?.email?.schedules?.billing || 'Mon/Wed/Fri 09:00 UTC'}</div>
            </div>
            {!hub?.email?.configured && (
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text2)' }}>
                {t('billingHub.envHint')}
              </div>
            )}
          </PortalSurface>

          {isAdmin && (
            <PortalSurface title={t('billingHub.sendNow')} style={{ marginTop: 16 }}>
              <div className="billing-hub-actions">
                <button type="button" className="btn-primary billing-hub-action" disabled={!hub?.email?.configured || !!sending} onClick={() => triggerEmail('report')}>
                  {sending === 'report' ? t('common.loading') : t('billingHub.sendReport')}
                </button>
                <button type="button" className="btn-primary billing-hub-action" disabled={!hub?.email?.configured || !!sending || overdue.length === 0} onClick={() => triggerEmail('billing')}>
                  {sending === 'billing' ? t('common.loading') : t('billingHub.sendReminders')}
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 10 }}>{t('billingHub.cooldownHint')}</div>
            </PortalSurface>
          )}
        </>
      )}
    </AdminPage>
  )
}
