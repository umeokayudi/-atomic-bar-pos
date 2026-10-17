import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useI18n } from '../../lib/i18n'
import { fmtYen } from '../utils'
import { searchCrm } from '../../lib/onAccount'
import { addCrmGuest } from '../../lib/onAccountStore'
import Icon from '../ui/Icon'

/**
 * Pick a recurring customer from the bar's CRM (bar_guests), or add one on the spot.
 * Used for "on account" and for discounts, which both need a CRM customer.
 */
export default function CustomerPicker({ barId, guests = [], onGuestsChange, value = '', onPick, balances = null, error = '' }) {
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const list = useMemo(() => searchCrm(guests, q).slice(0, 40), [guests, q])
  const picked = guests.find(g => g.id === value) || null
  const name = q.trim()
  const exact = name && guests.some(g => String(g.nome).trim().toLowerCase() === name.toLowerCase())

  async function add() {
    if (!name || busy) return
    setBusy(true)
    setErr('')
    try {
      const g = await addCrmGuest(supabase, barId, name)
      onGuestsChange?.([...guests, g].sort((a, b) => String(a.nome).localeCompare(String(b.nome))))
      onPick?.(g)
      setQ('')
    } catch (e) {
      setErr(t('onAccount.errAdd', { error: e.message }))
    } finally {
      setBusy(false)
    }
  }

  if (picked) {
    const owed = balances?.get?.(picked.id) || 0
    return (
      <div className="cust-picked">
        <span className="cust-avatar" aria-hidden="true">{String(picked.nome || '?').slice(0, 1)}</span>
        <div className="cust-name">
          <strong>{picked.nome}</strong>
          <span>{[picked.line_id ? `LINE ${picked.line_id}` : '', picked.vip_member_id ? 'VIP' : '', owed > 0 ? t('onAccount.owes', { amount: fmtYen(owed) }) : ''].filter(Boolean).join(' · ') || t('onAccount.inCrm')}</span>
        </div>
        <button type="button" className="cust-change" onClick={() => onPick?.(null)}>{t('onAccount.change')}</button>
      </div>
    )
  }

  return (
    <div className="cust-picker">
      <label className="cust-search">
        <Icon name="search" size={16} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('onAccount.searchCrm')} aria-label={t('onAccount.searchCrm')}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (list.length === 1) onPick?.(list[0]); else if (!exact) add() } }} />
      </label>
      <div className="cust-list" role="listbox" aria-label={t('onAccount.crmList')}>
        {list.map(g => {
          const owed = balances?.get?.(g.id) || 0
          return (
            <button key={g.id} type="button" role="option" aria-selected="false" className="cust-row" onClick={() => onPick?.(g)}>
              <span className="cust-avatar" aria-hidden="true">{String(g.nome || '?').slice(0, 1)}</span>
              <span className="cust-name">
                <strong>{g.nome}</strong>
                <span>{[g.line_id ? `LINE ${g.line_id}` : g.telefone || '', g.vip_member_id ? 'VIP' : ''].filter(Boolean).join(' · ')}</span>
              </span>
              {owed > 0 && <em>{fmtYen(owed)}</em>}
            </button>
          )
        })}
        {!list.length && <p className="cust-empty">{guests.length ? t('onAccount.noMatch') : t('onAccount.crmEmpty')}</p>}
      </div>
      {name && !exact && (
        <button type="button" className="cust-add" disabled={busy} onClick={add}>
          <Icon name="plus" size={16} /> {t('onAccount.addToCrm', { name })}
        </button>
      )}
      {(err || error) && <div className="cust-err" role="alert">{err || error}</div>}
    </div>
  )
}
