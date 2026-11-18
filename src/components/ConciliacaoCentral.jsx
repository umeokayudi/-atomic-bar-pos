import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import { useI18n } from '../lib/i18n'
import { fmtYen, fmtDate, Spinner } from './utils'
import { PageHeader } from './ui/PageLayout'
import { MoneyLabels } from './ui/MoneyLabels'
import { moneyBuckets } from '../lib/money'
import { findMoneyIssues, decisionsByKey } from '../lib/conciliacao'
import { errText } from '../lib/errText'
import { notify } from './ui/ConfirmDialog'

/**
 * Central de Conciliação: divergences, duplicates and pending money, side by side.
 * Read-only on money data. The only thing it writes is the owner's decision text, in the activity log
 * (live table audit_events, stamped by the server with who and when).
 */
export default function ConciliacaoCentral() {
  const { t } = useI18n()
  const { perfil } = useAuth()
  const [state, setState] = useState({ loading: true, error: '' })
  const [data, setData] = useState({ faturas: [], pagamentos: [], ryoshusho: [], produtos: [], bars: [], audit: [] })
  const [filter, setFilter] = useState('waiting')
  const [editing, setEditing] = useState(null)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const isOwner = perfil?.role === 'admin'

  async function load() {
    setState({ loading: true, error: '' })
    try {
      const [f, p, r, pr, b] = await Promise.all([
        supabase.from('faturas').select('*'),
        supabase.from('fatura_pagamentos').select('*'),
        supabase.from('ryoshusho').select('*'),
        supabase.from('produtos').select('id,nome,ativo,custo'),
        supabase.from('bars').select('id,nome'),
      ])
      const bad = [f, p, r, pr, b].find(x => x.error)
      if (bad) throw bad.error
      const a = await supabase.from('audit_events').select('*').eq('tabela', 'conciliacao').then(x => x, () => ({ data: [] }))
      setData({ faturas: f.data || [], pagamentos: p.data || [], ryoshusho: r.data || [], produtos: pr.data || [], bars: b.data || [], audit: a?.data || [] })
      setState({ loading: false, error: '' })
    } catch (e) {
      setState({ loading: false, error: errText(e) })
    }
  }
  useEffect(() => { load() }, [])

  const issues = useMemo(() => findMoneyIssues(data), [data])
  const decisions = useMemo(() => decisionsByKey(data.audit), [data.audit])
  const barName = id => data.bars.find(b => b.id === id)?.nome || ''
  const shown = issues.filter(i => filter === 'all' || (filter === 'done') === decisions.has(i.key))
  const waitingCount = issues.filter(i => !decisions.has(i.key)).length

  async function saveDecision(issue) {
    const decisao = text.trim()
    if (!decisao || saving) return
    setSaving(true)
    // Only the text and a picture of the numbers as they were when decided. No money row is touched.
    const { error } = await supabase.from('audit_events').insert({
      tabela: 'conciliacao', registro_id: issue.key, acao: 'owner_decision', bar_id: issue.barId || null,
      antes: null, depois: { decisao, kind: issue.kind, left: issue.left, right: issue.right, diff: issue.diff },
    })
    setSaving(false)
    if (error) { notify(t('mm.conc.saveError', { error: errText(error) }), 'error'); return }
    notify(t('mm.conc.saved'))
    setEditing(null); setText('')
    load()
  }

  const side = s => s && (
    <div className="conc-side">
      <div className="conc-side-label">{t(`mm.conc.side.${s.label}`)}</div>
      <div className="conc-side-value">{fmtYen(Math.round(s.valor || 0))}</div>
      <div className="conc-side-ref">{[s.ref, s.data ? fmtDate(s.data) : '', s.nota].filter(Boolean).join(' · ')}</div>
    </div>
  )

  return (
    <div>
      <PageHeader title={t('mm.conc.title')} subtitle={t('mm.conc.sub')} />
      {state.loading ? <Spinner text={t('mm.conc.loading')} /> : state.error ? (
        <div className="money-labels-error" role="alert">
          {t('mm.conc.error', { error: state.error })}{' '}
          <button type="button" className="ui-btn is-sm" onClick={load}>{t('mm.conc.retry')}</button>
        </div>
      ) : (
        <>
          <MoneyLabels buckets={moneyBuckets(data.faturas, data.pagamentos)} />
          <div className="conc-filters" role="tablist">
            {[['waiting', `${t('mm.conc.waiting')} (${waitingCount})`], ['done', `${t('mm.conc.done')} (${issues.length - waitingCount})`], ['all', `${t('mm.conc.all')} (${issues.length})`]].map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={filter === id} className={`ui-btn is-sm${filter === id ? ' is-primary' : ''}`} onClick={() => setFilter(id)}>{label}</button>
            ))}
          </div>
          {shown.length === 0 ? <div className="conc-item">{t('mm.conc.empty')}</div> : (
            <div className="conc-list">
              {shown.map(i => {
                const d = decisions.get(i.key)
                return (
                  <div key={i.key} className={`conc-item${d ? ' is-decided' : ''}`}>
                    <div className="conc-kind">{t(`mm.conc.kind.${i.kind}`)}{barName(i.barId) && <span className="conc-side-ref">· {barName(i.barId)}</span>}</div>
                    <div className="conc-sides">
                      {side(i.left)}
                      {i.right ? <div className="conc-diff"><span>{t('mm.conc.diff')}</span><b>{fmtYen(Math.abs(Math.round(i.diff || 0)))}</b></div> : <span />}
                      {side(i.right) || <span />}
                    </div>
                    <div className="conc-foot">
                      <div className="conc-decision">
                        {d ? <><b>{t('mm.conc.decided')}:</b> {String(d.depois?.decisao || '')}<small>{t('mm.conc.decidedBy', { who: d.user_nome || '', when: fmtDate(String(d.criado_em || '').slice(0, 10)) })}</small></> : t('mm.conc.noDecision')}
                      </div>
                      {isOwner
                        ? <button type="button" className="ui-btn is-sm" onClick={() => { setEditing(i.key); setText('') }}>{t('mm.conc.decide')}</button>
                        : <small className="conc-side-ref">{t('mm.conc.onlyOwner')}</small>}
                    </div>
                    {editing === i.key && (
                      <div className="conc-form" style={{ marginTop: 10 }}>
                        <label className="conc-side-label" htmlFor={`dec-${i.key}`}>{t('mm.conc.decisionTitle')}</label>
                        <div className="conc-side-ref" style={{ margin: '2px 0 6px' }}>{t('mm.conc.decisionHint')}</div>
                        <textarea id={`dec-${i.key}`} value={text} onChange={e => setText(e.target.value)} placeholder={t('mm.conc.decisionPlaceholder')} maxLength={1000} />
                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                          <button type="button" className="ui-btn is-primary is-sm" disabled={!text.trim() || saving} onClick={() => saveDecision(i)}>{t('mm.conc.save')}</button>
                          <button type="button" className="ui-btn is-sm" onClick={() => setEditing(null)}>{t('mm.conc.cancel')}</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
