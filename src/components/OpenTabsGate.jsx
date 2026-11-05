import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import { useI18n } from '../lib/i18n'
import { fmtYen } from './utils'
import { errText } from '../lib/errText'
import { isMissingRelation, loadOpenTabs, tabMoney, tabsApi } from '../lib/comandas'
import { fetchCastRoster } from '../lib/castRoster'
import { prevTokyoDateKey } from '../lib/nightClose'
import {
  ageParts, closeCleared, exceptionError, exceptionTabs, isCarriedTab, isEmptyTab, openMinutes, tabsBlockingNight, transferNote,
} from '../lib/openTabsClose'
import { listCloseExceptions, openTabInTill, recordCloseException } from '../lib/openTabsApi'

function stamp(iso) {
  return iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
}

/**
 * Open tabs at the day close. Lists every tab still open for `night` (or earlier) with table/customer, who has it,
 * how long it has been open and the bill; each one can be closed (in the till), handed to someone else, or cancelled
 * when it was opened by mistake. The close itself stays locked (`onState({ cleared:false })`) until no tab is open or
 * the owner's PIN and a written reason record an exception. Shown only at the close: nothing warns during the night.
 */
export default function OpenTabsGate({ bar, night, onState, onOpenTill, compact = false }) {
  const { t } = useI18n()
  const { perfil } = useAuth()
  const [tabs, setTabs] = useState(null) // null = loading
  const [exceptions, setExceptions] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState('')
  const [roster, setRoster] = useState(null)
  const [moving, setMoving] = useState(null) // { id, to }
  const [cancelling, setCancelling] = useState(null) // { id, reason }
  const [askPin, setAskPin] = useState(false)
  const [pin, setPin] = useState('')
  const [reason, setReason] = useState('')
  const [pinMsg, setPinMsg] = useState('')

  const load = useCallback(async () => {
    setErr('')
    try {
      const list = await loadOpenTabs(supabase, bar.id)
      setTabs(list)
    } catch (e) {
      // Bars without server tabs (sql/floor_comandas.sql not applied) have nothing to check here.
      if (isMissingRelation(e)) setTabs([])
      else { setTabs([]); setErr(errText(e)) }
    }
    listCloseExceptions(prevTokyoDateKey(prevTokyoDateKey(night))).then(setExceptions).catch(() => setExceptions([]))
  }, [bar.id, night])

  useEffect(() => { load() }, [load])

  const blocking = useMemo(() => tabsBlockingNight(tabs || [], night), [tabs, night])
  const cleared = tabs !== null && closeCleared(blocking, exceptions, night)
  const nightExceptions = exceptions.filter(e => e.night_key === night)

  useEffect(() => {
    onState?.({ loading: tabs === null, blocking: blocking.length, cleared })
  }, [tabs, blocking.length, cleared]) // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => Object.fromEntries(blocking.map(x => [x.id, tabMoney(x, x.items, x.payments, {}).total])), [blocking])

  async function openRoster(tab) {
    setMoving({ id: tab.id, to: '' })
    setCancelling(null)
    if (roster === null) setRoster((await fetchCastRoster()) || [])
  }

  async function transfer(tab) {
    const to = String(moving?.to || '').trim()
    if (!to) return
    setBusy(tab.id); setErr('')
    try {
      const me = perfil?.nome || perfil?.email || ''
      const obs = transferNote(tab.obs, { from: tab.responsavel_nome, to, by: me })
      await tabsApi.update(supabase, tab.id, { responsavel: to, obs })
      setMoving(null)
      await load()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy('')
    }
  }

  async function cancel(tab) {
    const why = String(cancelling?.reason || '').trim()
    if (why.length < 3) { setErr(t('openTabs.cancelReason')); return }
    setBusy(tab.id); setErr('')
    try {
      await tabsApi.cancel(supabase, tab.id, why)
      setCancelling(null)
      await load()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy('')
    }
  }

  function goTill(tab) {
    openTabInTill(bar.id, tab.id)
    onOpenTill?.(tab)
  }

  async function authorize() {
    const bad = exceptionError({ pin, reason, tabs: blocking })
    if (bad) { setPinMsg(t(`openTabs.err.${bad}`)); return }
    setBusy('pin'); setPinMsg('')
    try {
      const row = await recordCloseException({ night, pin, reason: reason.trim(), tabs: exceptionTabs(blocking, totals) })
      setExceptions(list => [row, ...list])
      setAskPin(false); setPin(''); setReason('')
    } catch (e) {
      setPinMsg(e.code === 'bad_pin'
        ? t('openTabs.err.wrongPin', { left: e.left ?? 0 })
        : e.code === 'no_pin' ? t('openTabs.err.noPin') : errText(e))
    } finally {
      setBusy('')
    }
  }

  if (tabs === null) return <p className="desk-note">{t('openTabs.loading')}</p>
  if (!blocking.length) {
    return compact ? null : <p className="open-tabs-ok"><span className="ui-badge is-success">{t('openTabs.none')}</span></p>
  }

  const roles = (roster || []).map(p => p.nome).filter(Boolean)
  return (
    <section className={`open-tabs-gate ${cleared ? 'is-cleared' : 'is-blocked'}${compact ? ' is-compact' : ''}`} role={cleared ? undefined : 'alert'}>
      <div className="open-tabs-head">
        <strong>{t('openTabs.title', { n: blocking.length })}</strong>
        <span className={`ui-badge ${cleared ? 'is-info' : 'is-warning'}`}>{t(cleared ? 'openTabs.leftOpen' : 'openTabs.mustCheck')}</span>
      </div>
      <p className="open-tabs-lead">{t(cleared ? 'openTabs.leadCleared' : 'openTabs.lead')}</p>

      <ul className="open-tabs-list">
        {blocking.map(x => {
          const age = ageParts(openMinutes(x))
          const empty = isEmptyTab(x)
          return (
            <li key={x.id} className="open-tabs-row">
              <div className="open-tabs-info">
                <span className="open-tabs-name">
                  {x.nome}{x.mesa_nome && x.mesa_nome !== x.nome ? ` · ${x.mesa_nome}` : ''}
                  {isCarriedTab(x, night) && <span className="ui-badge is-warning">{t('openTabs.fromYesterday')}</span>}
                </span>
                <span className="open-tabs-meta">
                  {t('openTabs.openedBy', { name: x.responsavel_nome || '—' })}
                  {' · '}
                  {age.h ? t('openTabs.ageH', { h: age.h, m: age.m }) : t('openTabs.ageM', { m: age.m })}
                  {' · '}
                  {empty ? t('openTabs.empty') : fmtYen(totals[x.id] || 0)}
                </span>
              </div>
              <div className="open-tabs-actions">
                <button type="button" className="ui-btn is-sm is-primary" disabled={!!busy} onClick={() => goTill(x)}>{t('openTabs.close')}</button>
                <button type="button" className="ui-btn is-sm" disabled={!!busy} onClick={() => openRoster(x)}>{t('openTabs.transfer')}</button>
                {empty && <button type="button" className="ui-btn is-sm" disabled={!!busy} onClick={() => { setCancelling({ id: x.id, reason: '' }); setMoving(null) }}>{t('openTabs.cancel')}</button>}
              </div>
              {moving?.id === x.id && (
                <div className="open-tabs-form">
                  <label>
                    {t('openTabs.transferTo')}
                    <input list={`open-tabs-people-${x.id}`} value={moving.to} placeholder={roster === null ? t('openTabs.loadingPeople') : t('openTabs.pickPerson')} onChange={e => setMoving(m => ({ ...m, to: e.target.value }))} />
                    <datalist id={`open-tabs-people-${x.id}`}>
                      {roles.filter(n => n !== x.responsavel_nome).map(n => <option key={n} value={n} />)}
                    </datalist>
                  </label>
                  <div className="open-tabs-form-actions">
                    <button type="button" className="ui-btn is-sm is-primary" disabled={!!busy || !moving.to.trim()} onClick={() => transfer(x)}>{busy === x.id ? t('common.saving') : t('openTabs.transferSave')}</button>
                    <button type="button" className="ui-btn is-sm" onClick={() => setMoving(null)}>{t('common.cancel')}</button>
                  </div>
                  <p className="desk-note">{t('openTabs.transferHint')}</p>
                </div>
              )}
              {cancelling?.id === x.id && (
                <div className="open-tabs-form">
                  <label>
                    {t('openTabs.cancelWhy')}
                    <input value={cancelling.reason} placeholder={t('openTabs.cancelPh')} onChange={e => setCancelling(c => ({ ...c, reason: e.target.value }))} />
                  </label>
                  <div className="open-tabs-form-actions">
                    <button type="button" className="ui-btn is-sm is-danger" disabled={!!busy} onClick={() => cancel(x)}>{busy === x.id ? t('common.saving') : t('openTabs.cancelSave')}</button>
                    <button type="button" className="ui-btn is-sm" onClick={() => setCancelling(null)}>{t('common.cancel')}</button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {err && <p className="desk-note">{err}</p>}

      {nightExceptions.map(e => (
        <p key={e.id} className="open-tabs-exception">
          {t('openTabs.exceptionLine', { at: stamp(e.criado_em), by: e.asked_by_nome || '—', n: (e.tabs || []).length, reason: e.reason })}
        </p>
      ))}

      {!cleared && (
        askPin ? (
          <div className="open-tabs-pin">
            <p className="desk-note">{t('openTabs.pinLead')}</p>
            <label>
              {t('openTabs.reason')}
              <textarea rows={2} value={reason} placeholder={t('openTabs.reasonPh')} onChange={e => setReason(e.target.value)} />
            </label>
            <label>
              {t('openTabs.pin')}
              <input type="password" inputMode="numeric" autoComplete="off" maxLength={8} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))} />
            </label>
            <div className="open-tabs-form-actions">
              <button type="button" className="ui-btn is-sm is-primary" disabled={busy === 'pin'} onClick={authorize}>{busy === 'pin' ? t('common.saving') : t('openTabs.authorize')}</button>
              <button type="button" className="ui-btn is-sm" onClick={() => { setAskPin(false); setPinMsg('') }}>{t('common.cancel')}</button>
            </div>
            {pinMsg && <p className="desk-note">{pinMsg}</p>}
          </div>
        ) : (
          <button type="button" className="ui-btn is-sm open-tabs-anyway" onClick={() => setAskPin(true)}>{t('openTabs.anyway')}</button>
        )
      )}
    </section>
  )
}
