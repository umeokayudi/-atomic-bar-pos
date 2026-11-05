import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import { fmtYen } from './utils'
import { useI18n } from '../lib/i18n'
import { errText } from '../lib/errText'
import { tokyoNightKey } from '../lib/tokyo'
import { closeVariance, nextTokyoDateKey, prevTokyoDateKey } from '../lib/nightClose'
import OpenTabsGate from './OpenTabsGate'
import { ALL_METHODS, CHECK_METHODS, CHECK_TABLE, checkRowId, checkState, closeCheck, methodDiff } from '../lib/closeCheck'

const SALE_COLS = 'id,total,refunded,card_fee,card_fee_reversed,data,criado_em,metodo_pagamento,obs,comanda_id'
const SALE_COLS_PLAIN = 'id,total,data,criado_em,metodo_pagamento,obs'

function money(n) {
  return fmtYen(Math.round(+n || 0))
}

/** Night choices: tonight and the six nights before it. */
function nightChoices(today) {
  const out = [today]
  for (let i = 0; i < 6; i++) out.push(prevTokyoDateKey(out[out.length - 1]))
  return out
}

function DiffBadge({ t, diff }) {
  if (diff == null) return <span className="ui-badge">{t('portal.close.check.notCounted')}</span>
  if (diff === 0) return <span className="ui-badge is-success">{t('portal.close.check.match')}</span>
  return (
    <span className="ui-badge is-danger">
      {diff < 0 ? t('portal.close.check.short', { amount: money(-diff) }) : t('portal.close.check.over', { amount: money(diff) })}
    </span>
  )
}

/**
 * Close check on the Close page: per payment method, what the till recorded for the night next to what was
 * counted (drawer cash, card machine total, PayPay app), the difference, and the list of tickets behind each total.
 */
export default function CloseCheck({ bar, onOpenTill }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const today = tokyoNightKey()
  const [night, setNight] = useState(today)
  const [sales, setSales] = useState([])
  const [tabPays, setTabPays] = useState({})
  const [shift, setShift] = useState(null)
  const [saved, setSaved] = useState(null)
  const [counted, setCounted] = useState({ cash: '', card: '', paypay: '' })
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [openList, setOpenList] = useState('')
  // Open tabs block the close until they are closed/transferred or the owner records an exception (PIN + reason).
  const [gate, setGate] = useState({ loading: true, blocking: 0, cleared: false })

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setMsg('')
      // pos_vendas.data is the night; a sale rung after midnight can carry the next day, so read one day each side.
      const from = prevTokyoDateKey(night)
      const to = nextTokyoDateKey(night)
      let sl = await supabase.from('pos_vendas').select(SALE_COLS).eq('bar_id', bar.id).gte('data', from).lte('data', to)
      if (sl.error) sl = await supabase.from('pos_vendas').select(SALE_COLS_PLAIN).eq('bar_id', bar.id).gte('data', from).lte('data', to)
      const rows = sl.data || []
      const tabIds = [...new Set(rows.map(r => r.comanda_id).filter(Boolean))]
      const [pays, sh, chk] = await Promise.all([
        tabIds.length
          ? supabase.from('pos_comanda_pagamentos').select('comanda_id,valor,metodo,estornado_em').in('comanda_id', tabIds)
          : Promise.resolve({ data: [] }),
        supabase.from('pos_shifts').select('*').eq('bar_id', bar.id).eq('night_key', night).maybeSingle(),
        supabase.from(CHECK_TABLE).select('*').eq('bar_id', bar.id).eq('night_key', night).maybeSingle(),
      ])
      if (cancelled) return
      const byTab = {}
      for (const p of pays.data || []) (byTab[p.comanda_id] ||= []).push(p)
      setSales(rows)
      setTabPays(byTab)
      setShift(sh.data || null)
      const row = chk.data || null
      setSaved(row)
      const c = row?.counted || {}
      const shiftCash = sh.data?.counted_cash != null && sh.data?.status === 'closed' ? String(Math.round(+sh.data.counted_cash)) : ''
      setCounted({
        cash: c.cash != null ? String(c.cash) : shiftCash,
        card: c.card != null ? String(c.card) : '',
        paypay: c.paypay != null ? String(c.paypay) : '',
      })
      setNote(row?.note || '')
      if (sl.error) setMsg(errText(sl.error))
      setLoading(false)
    }
    load().catch(e => { if (!cancelled) { setMsg(errText(e)); setLoading(false) } })
    return () => { cancelled = true }
  }, [bar.id, night])

  const check = useMemo(() => closeCheck(sales, night, tabPays), [sales, night, tabPays])
  const state = checkState(check, counted)
  const countedTotal = CHECK_METHODS.reduce((a, m) => a + (counted[m] === '' ? 0 : Math.round(+counted[m] || 0)), 0)
  const systemCounted = CHECK_METHODS.reduce((a, m) => a + check.methods[m].total, 0)

  async function save() {
    if (!gate.cleared) {
      setMsg(t('openTabs.saveBlocked', { n: gate.blocking }))
      return
    }
    if (CHECK_METHODS.some(m => counted[m] !== '' && !Number.isFinite(+counted[m]))) {
      setMsg(t('portal.close.check.badNumber'))
      return
    }
    setBusy(true)
    setMsg('')
    const clean = Object.fromEntries(CHECK_METHODS.map(m => [m, counted[m] === '' ? null : Math.round(+counted[m])]))
    const row = {
      id: saved?.id || checkRowId(bar.id, night),
      bar_id: bar.id,
      night_key: night,
      counted: clean,
      system: Object.fromEntries(ALL_METHODS.map(m => [m, check.methods[m].total])),
      diff: Object.fromEntries(CHECK_METHODS.map(m => [m, methodDiff(check.methods[m].total, clean[m])])),
      state: checkState(check, clean),
      tickets: check.tickets,
      note: note.trim(),
      checked_at: new Date().toISOString(),
      checked_by: user?.id || null,
    }
    try {
      const { error } = await supabase.from(CHECK_TABLE).upsert(row)
      if (error) throw error
      // The night close keeps the drawer count too, so the till and this page show the same cash.
      if (shift?.id && clean.cash != null && shift.status !== 'open') {
        const patch = { counted_cash: clean.cash, variance: closeVariance(shift.expected_cash, clean.cash), status: 'closed' }
        const res = await supabase.from('pos_shifts').update(patch).eq('id', shift.id)
        if (!res.error) setShift(s => ({ ...s, ...patch }))
      }
      setSaved(row)
      setMsg(t(row.state === 'ok' ? 'portal.close.check.savedOk' : 'portal.close.check.saved'))
    } catch (e) {
      setMsg(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const choices = nightChoices(today)
  const stateBadge = {
    empty: ['', 'stateEmpty'],
    partial: ['is-warning', 'statePartial'],
    ok: ['is-success', 'stateOk'],
    off: ['is-danger', 'stateOff'],
  }[state]

  return (
    <section className="desk-card close-check">
      <div className="close-check-head">
        <h3>{t('portal.close.check.title')}</h3>
        <span className={`ui-badge ${stateBadge[0]}`}>{t(`portal.close.check.${stateBadge[1]}`)}</span>
      </div>
      <p className="desk-note">{t('portal.close.check.lead')}</p>

      <div className="goal-modes close-check-nights">
        {choices.map(k => (
          <button key={k} type="button" className={night === k ? 'is-on' : ''} onClick={() => setNight(k)}>
            {k === today ? t('portal.close.check.tonight') : k.slice(5).replace('-', '/')}
          </button>
        ))}
        <input
          type="date"
          aria-label={t('portal.close.check.pickNight')}
          value={night}
          max={today}
          onChange={e => e.target.value && setNight(e.target.value)}
        />
      </div>

      <OpenTabsGate bar={bar} night={night} onState={setGate} onOpenTill={onOpenTill} />

      {loading ? (
        <p className="desk-note">{t('portal.close.check.loading')}</p>
      ) : (
        <>
          <p className="desk-note">
            {t('portal.close.check.nightLine', { night, count: check.tickets, total: money(check.total) })}
            {saved?.checked_at ? ` · ${t('portal.close.check.lastSaved', { at: new Date(saved.checked_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}` : ''}
          </p>
          <div className="close-check-scroll">
            <table className="close-doc close-check-table">
              <thead>
                <tr>
                  <th>{t('portal.close.check.method')}</th>
                  <th>{t('portal.close.check.system')}</th>
                  <th>{t('portal.close.check.counted')}</th>
                  <th>{t('portal.close.check.diff')}</th>
                </tr>
              </thead>
              <tbody>
                {CHECK_METHODS.map(m => {
                  const diff = methodDiff(check.methods[m].total, counted[m])
                  return (
                    <tr key={m}>
                      <td>
                        {t(`portal.close.check.m.${m}`)}
                        <div className="close-check-hint">{t(`portal.close.check.where.${m}`)}</div>
                      </td>
                      <td>{money(check.methods[m].total)}</td>
                      <td>
                        <label className="close-check-input">
                          <span aria-hidden="true">¥</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min="0"
                            step="1"
                            placeholder="0"
                            aria-label={t('portal.close.check.countedOf', { method: t(`portal.close.check.m.${m}`) })}
                            value={counted[m]}
                            onChange={e => setCounted(c => ({ ...c, [m]: e.target.value }))}
                          />
                        </label>
                      </td>
                      <td><DiffBadge t={t} diff={diff} /></td>
                    </tr>
                  )
                })}
                {check.methods.other.total !== 0 && (
                  <tr>
                    <td>
                      {t('portal.close.check.m.other')}
                      <div className="close-check-hint">{t('portal.close.check.where.other')}</div>
                    </td>
                    <td>{money(check.methods.other.total)}</td>
                    <td>—</td>
                    <td />
                  </tr>
                )}
                <tr className="close-check-total">
                  <td>{t('portal.close.check.total')}</td>
                  <td>{money(systemCounted)}</td>
                  <td>{money(countedTotal)}</td>
                  <td>
                    {state === 'empty' ? null : (
                      <span className={countedTotal - systemCounted === 0 ? 'is-up' : 'is-down'}>
                        {countedTotal - systemCounted > 0 ? '+' : ''}{money(countedTotal - systemCounted)}
                      </span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <label className="close-check-note">
            {t('portal.close.check.note')}
            <input type="text" value={note} placeholder={t('portal.close.check.notePh')} onChange={e => setNote(e.target.value)} />
          </label>
          <div className="close-check-actions">
            <button type="button" className="btn-primary" disabled={busy || !gate.cleared} title={gate.cleared ? undefined : t('openTabs.saveBlocked', { n: gate.blocking })} onClick={save}>
              {busy ? t('common.saving') : t('portal.close.check.save')}
            </button>
            {msg && <span className="desk-note">{msg}</span>}
          </div>

          <h4 className="close-check-sub">{t('portal.close.check.listTitle')}</h4>
          <div className="close-check-lists">
            {ALL_METHODS.filter(m => m !== 'other' || check.methods.other.rows.length).map(m => {
              const box = check.methods[m]
              const open = openList === m
              return (
                <div key={m} className={`close-check-list ${open ? 'is-open' : ''}`}>
                  <button type="button" className="close-check-list-head" aria-expanded={open} onClick={() => setOpenList(open ? '' : m)}>
                    <span>{t(`portal.close.check.m.${m}`)}</span>
                    <span className="close-check-count">{t('portal.close.check.tickets', { count: box.rows.length })}</span>
                    <strong>{money(box.total)}</strong>
                    <span aria-hidden="true" className="close-check-caret">{open ? '▴' : '▾'}</span>
                  </button>
                  {open && (
                    box.rows.length ? (
                      <table className="close-doc close-check-rows">
                        <thead>
                          <tr>
                            <th>{t('portal.close.check.time')}</th>
                            <th>{t('portal.close.check.ticket')}</th>
                            <th>{t('portal.close.check.amount')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {box.rows.map(r => (
                            <tr key={r.id}>
                              <td>{r.time || '—'}</td>
                              <td>
                                {r.label || t(r.tab ? 'portal.close.check.tab' : 'portal.close.check.counter')}
                                {r.split && <span className="ui-badge">{t('portal.close.check.split')}</span>}
                                {r.void && <span className="ui-badge is-danger">{t('portal.close.check.void')}</span>}
                                {r.refunded && <span className="ui-badge is-warning">{t('portal.close.check.refunded')}</span>}
                              </td>
                              <td>{money(r.amount)}</td>
                            </tr>
                          ))}
                          <tr className="close-check-total">
                            <td />
                            <td>{t('portal.close.check.total')}</td>
                            <td>{money(box.total)}</td>
                          </tr>
                        </tbody>
                      </table>
                    ) : (
                      <p className="desk-note">{t('portal.close.check.none')}</p>
                    )
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}
