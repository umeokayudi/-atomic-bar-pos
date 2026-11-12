import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../Auth'
import { useI18n } from '../../lib/i18n'
import { fmtYen } from '../utils'
import { errText } from '../../lib/errText'
import { isConflict, tabsApi } from '../../lib/comandas'
import { fetchCastRoster } from '../../lib/castRoster'
import { transferNote } from '../../lib/openTabsClose'
import { filterRows, openedStamp } from '../../lib/tabsList'
import Icon from '../ui/Icon'

/**
 * Full list of open tabs on the till, opened from the "Tabs · N" button (replaces the sideways strip).
 * Every open tab is listed, ¥0 ones included: name/table, bill, date + time opened and who opened it.
 * Tabs from an earlier night sit first with the "From yesterday — check" badge.
 * Per tab: Open, Close (open it on the pay step; a ¥0 tab is deleted after a confirm), Transfer (hand it to someone).
 */
export default function TabsListSheet({ rows = [], activeKey = '', onOpen, onPay, onDropLocal, onChanged, onNew, onDismiss }) {
  const { t, lang } = useI18n()
  const { perfil } = useAuth()
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [moving, setMoving] = useState(null) // { key, to }
  const [delAsk, setDelAsk] = useState('')
  const [roster, setRoster] = useState(null)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onDismiss?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onDismiss])

  const shown = useMemo(() => filterRows(rows, q), [rows, q])
  const carried = rows.filter(r => r.carried).length
  const sum = rows.reduce((a, r) => a + r.total, 0)
  const names = (roster || []).map(p => p.nome).filter(Boolean)

  async function startTransfer(r) {
    setMoving({ key: r.key, to: '' }); setDelAsk(''); setErr('')
    if (roster === null) setRoster((await fetchCastRoster()) || [])
  }

  async function transfer(r) {
    const to = String(moving?.to || '').trim()
    if (!to || !r.server) return
    setBusy(r.key); setErr('')
    try {
      const me = perfil?.nome || perfil?.email || ''
      await tabsApi.update(supabase, r.id, { responsavel: to, obs: transferNote(r.tab?.obs, { from: r.openedBy, to, by: me }) })
      setMoving(null)
      await onChanged?.()
    } catch (e) {
      setErr(isConflict(e) ? t('tabs.errConflict') : errText(e))
    } finally {
      setBusy('')
    }
  }

  async function remove(r) {
    if (delAsk !== r.key) { setDelAsk(r.key); setMoving(null); return }
    setBusy(r.key); setErr('')
    try {
      if (r.server) {
        await tabsApi.cancel(supabase, r.id, 'empty')
        onDropLocal?.(r.key)
        await onChanged?.()
      } else onDropLocal?.(r.key)
      setDelAsk('')
    } catch (e) {
      setErr(isConflict(e) ? t('tabs.errConflict') : errText(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="pq-sheet" role="dialog" aria-modal="true" aria-label={t('tabsList.title', { n: rows.length })} onClick={e => { if (e.target === e.currentTarget && !busy) onDismiss?.() }}>
      <div className="pq-sheet-card pq-tl">
        <div className="pq-detail-head">
          <h2>{t('tabsList.title', { n: rows.length })}</h2>
          <button type="button" className="pq-detail-x" disabled={!!busy} onClick={onDismiss} aria-label={t('common.close')}><Icon name="close" size={18} /></button>
        </div>
        <p className="pq-tl-sum">
          <b>{fmtYen(sum)}</b> {t('tabsList.onTabs')}
          {carried > 0 && <span className="ui-badge is-warning">{t('openTabs.carriedNote', { n: carried })}</span>}
        </p>

        {rows.length > 6 && (
          <label className="pq-search pq-tl-search">
            <Icon name="search" size={18} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('tabsList.search')} enterKeyHint="search" />
            {q && <button type="button" aria-label={t('posQuick.clear')} onClick={() => setQ('')}><Icon name="close" size={16} /></button>}
          </label>
        )}

        {rows.length === 0 && <p className="pq-empty">{t('openTabs.none')}</p>}

        <ul className="pq-tl-list">
          {shown.map(r => (
            <li key={r.key} className={`pq-tl-row${r.carried ? ' is-carried' : ''}${r.key === activeKey ? ' is-on' : ''}`}>
              <button type="button" className="pq-tl-main" disabled={!!busy} onClick={() => onOpen?.(r.key)}>
                <span className="pq-tl-name">
                  {r.carried && <span className="ui-badge is-warning">{t('openTabs.fromYesterday')}</span>}
                  <b>{r.name}</b>
                  {r.table && <small>{r.table}</small>}
                  {r.paying && <span className="ui-badge is-info">{t('tabs.state.awaiting_payment')}</span>}
                </span>
                <span className="pq-tl-meta">
                  {t('tabsList.opened', { at: openedStamp(r.openedAt, lang) || '—' })}
                  {' · '}
                  {t('openTabs.openedBy', { name: r.openedBy || '—' })}
                  {r.people > 0 && <> · {t('tabs.people', { n: r.people })}</>}
                </span>
                <strong className={`pq-tl-total${r.empty ? ' is-zero' : ''}`}>{fmtYen(r.total)}</strong>
              </button>
              <div className="pq-tl-actions">
                <button type="button" className="ui-btn is-sm is-primary" disabled={!!busy} onClick={() => onOpen?.(r.key)}>{t('tabsList.open')}</button>
                {r.empty
                  ? (delAsk === r.key
                    ? <>
                        <button type="button" className="ui-btn is-sm is-danger" disabled={!!busy} onClick={() => remove(r)}><Icon name="trash" size={14} /> {busy === r.key ? t('common.saving') : t('tabs.deleteEmptyYes')}</button>
                        <button type="button" className="ui-btn is-sm" disabled={!!busy} onClick={() => setDelAsk('')}>{t('common.cancel')}</button>
                      </>
                    : <button type="button" className="ui-btn is-sm" disabled={!!busy} onClick={() => remove(r)}><Icon name="trash" size={14} /> {t('tabsList.closeEmpty')}</button>)
                  : <button type="button" className="ui-btn is-sm" disabled={!!busy} onClick={() => onPay?.(r.key)}>{t('openTabs.close')}</button>}
                {r.server && delAsk !== r.key && (
                  <button type="button" className="ui-btn is-sm" disabled={!!busy} onClick={() => startTransfer(r)}><Icon name="transfer" size={14} /> {t('openTabs.transfer')}</button>
                )}
              </div>
              {moving?.key === r.key && (
                <div className="open-tabs-form pq-tl-form">
                  <label>
                    {t('openTabs.transferTo')}
                    <input list={`pq-tl-people-${r.id}`} value={moving.to} autoFocus placeholder={roster === null ? t('openTabs.loadingPeople') : t('openTabs.pickPerson')} onChange={e => setMoving(m => ({ ...m, to: e.target.value }))} />
                    <datalist id={`pq-tl-people-${r.id}`}>
                      {names.filter(n => n !== r.openedBy).map(n => <option key={n} value={n} />)}
                    </datalist>
                  </label>
                  <div className="open-tabs-form-actions">
                    <button type="button" className="ui-btn is-sm is-primary" disabled={!!busy || !moving.to.trim()} onClick={() => transfer(r)}>{busy === r.key ? t('common.saving') : t('openTabs.transferSave')}</button>
                    <button type="button" className="ui-btn is-sm" onClick={() => setMoving(null)}>{t('common.cancel')}</button>
                  </div>
                  <p className="desk-note">{t('openTabs.transferHint')}</p>
                </div>
              )}
            </li>
          ))}
        </ul>

        {err && <div className="pq-alert" role="alert">{err}</div>}

        <button type="button" className="ui-btn is-lg pq-tl-new" disabled={!!busy} onClick={onNew}><Icon name="plus" size={16} /> {t('posQuick.newTab')}</button>
      </div>
    </div>
  )
}
