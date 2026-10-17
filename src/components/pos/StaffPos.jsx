import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../Auth'
import { useI18n } from '../../lib/i18n'
import { fetchCastRoster } from '../../lib/castRoster'
import { checkPosSchema } from '../../lib/atomicPos'
import { forgetLiveSelects } from '../../lib/barLiveClient'
import { prevTokyoDateKey, summarizeNight } from '../../lib/nightClose'
import { tokyoNightKey } from '../../lib/tokyo'
import { castPeopleFromAgents, castRoster, mySalesTonight, withMe } from '../../lib/staffPos'
import { tokyoClock } from '../../lib/staffDayReport'
import { fmtYen, Spinner } from '../utils'
import Icon from '../ui/Icon'
import PosQuick from './PosQuick'

const SALE_COLS = 'id,total,refunded,criado_em,data,obs,metodo_pagamento,drink_back_agent_id,criado_por'
const SALE_COLS_SLIM = 'id,total,criado_em,data,obs,metodo_pagamento,drink_back_agent_id,criado_por'

/**
 * Mobile POS for a bar staff member (the shell's POS tab mounts it for bar_staff logins).
 * She rings orders herself; each sale is marked with her by default and she can add or swap the people
 * who worked it. Credit: saleCredit.js (equal split). Who rang it up is stamped by the server, never sent
 * from here. No owner settings: no prices, discount or VIP admin, no on-account ledger, no bar totals.
 */
export default function StaffPos({ bar }) {
  const { t } = useI18n()
  const { user, perfil } = useAuth()
  const me = useMemo(() => {
    const id = perfil?.id || user?.id || ''
    return id ? { id, nome: perfil?.nome || user?.email || '' } : null
  }, [perfil?.id, perfil?.nome, user?.id, user?.email])

  const [ready, setReady] = useState(null)
  const [drinks, setDrinks] = useState([])
  const [shots, setShots] = useState([])
  const [codes, setCodes] = useState([])
  const [agents, setAgents] = useState([])
  const [roster, setRoster] = useState(null) // null = not loaded (team list unavailable → agents + me)
  const [sales, setSales] = useState([])
  const [salesErr, setSalesErr] = useState('')
  const [catalogErr, setCatalogErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [mineOpen, setMineOpen] = useState(false)

  const loadSales = useCallback(async () => {
    forgetLiveSelects('pos_vendas')
    const from = prevTokyoDateKey(tokyoNightKey())
    let r = await supabase.from('pos_vendas').select(SALE_COLS).eq('bar_id', bar.id).gte('data', from).order('criado_em')
    if (r.error && /refunded/.test(r.error.message || '')) {
      r = await supabase.from('pos_vendas').select(SALE_COLS_SLIM).eq('bar_id', bar.id).gte('data', from).order('criado_em')
    }
    if (r.error) setSalesErr(r.error.message || 'error')
    else { setSalesErr(''); setSales(r.data || []) }
  }, [bar.id])

  useEffect(() => {
    let live = true
    ;(async () => {
      setLoading(true)
      const [schema, dR, sR, cR, aR, team] = await Promise.all([
        checkPosSchema(supabase),
        supabase.from('drink_menu').select('*').eq('bar_id', bar.id).order('nome'),
        supabase.from('bar_pricing').select('*, produtos(nome,categoria,preco_venda,volume_ml,custo)').eq('bar_id', bar.id),
        supabase.from('discount_codes').select('*').eq('bar_id', bar.id).eq('ativo', true),
        supabase.from('drink_back_agents').select('*').eq('bar_id', bar.id).eq('ativo', true),
        fetchCastRoster(),
      ])
      if (!live) return
      setReady(schema.ready)
      setDrinks(dR.error ? [] : dR.data || [])
      setShots(sR.error ? [] : sR.data || [])
      setCatalogErr(dR.error?.message || sR.error?.message || '')
      setCodes(cR.data || [])
      setAgents(aR.data || [])
      setRoster(team)
      await loadSales()
      if (live) setLoading(false)
    })()
    return () => { live = false }
  }, [bar.id, loadSales])

  const night = tokyoNightKey()
  const people = useMemo(() => {
    const base = roster || castRoster([], agents)
    return withMe(base.length ? base : castPeopleFromAgents(agents), me)
  }, [roster, agents, me])
  const mine = useMemo(() => (me ? mySalesTonight(sales, me, { nightKey: night, agents }) : null), [sales, me, night, agents])
  const todaySales = useMemo(() => {
    const s = summarizeNight(sales, night)
    return { total: s.drinksTotal, count: s.ticketCount }
  }, [sales, night])

  if (loading) return <Spinner text={t('atomicPos.loading')} />
  if (!me) return null

  return (
    <div className="fade-in pos-shell staff-pos">
      {roster === null && <div className="pq-alert">{t('staffPos.teamErr')}</div>}
      {salesErr && <div className="pq-alert">{t('staffPos.loadErr', { error: salesErr })}</div>}
      {ready === false
        ? <div className="pq-alert">{t('atomicPos.setupHint')}</div>
        : (
          <PosQuick
            bar={bar}
            drinks={drinks}
            shots={shots}
            agents={agents}
            castPeople={people}
            discountCodes={codes}
            todaySales={todaySales}
            catalogError={catalogErr}
            staff={{ me, myTonight: salesErr ? null : mine, onOpenMine: () => setMineOpen(true) }}
            onSale={() => loadSales().catch(() => {})}
          />
        )}

      {mineOpen && <MineSheet t={t} mine={mine} onClose={() => setMineOpen(false)} />}
    </div>
  )
}

/** "My sales tonight": a bottom sheet in the staff app's style (total, one row per ticket, close). */
function MineSheet({ t, mine, onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const rows = [...(mine?.rows || [])].reverse()
  return (
    <div className="sa-sheet-wrap" role="presentation" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sa-sheet staff-pos-mine" role="dialog" aria-modal="true" aria-labelledby="staff-pos-mine-title">
        <div className="sa-sheet-grip" aria-hidden="true" />
        <div className="sa-sheet-head">
          <span className="sa-sheet-icon"><Icon name="result" size={22} /></span>
          <div className="sa-sheet-title">
            <h2 id="staff-pos-mine-title">{t('staffPos.mineTitle')}</h2>
            <p>{t('staffPos.myHint')}</p>
          </div>
          <button type="button" className="sa-icon-btn sa-sheet-x" onClick={onClose} aria-label={t('common.close')}><Icon name="close" size={20} /></button>
        </div>
        <div className="sa-sheet-body">
          <div className="staff-pos-total">
            <span>{t('atomicPos.salesCount', { count: mine?.tickets || 0 })}</span>
            <strong>{fmtYen(mine?.sales || 0)}</strong>
          </div>
          {!rows.length ? (
            <div className="sa-empty">
              <span className="sa-empty-icon"><Icon name="pos" size={24} /></span>
              <strong>{t('staffPos.mineEmpty')}</strong>
            </div>
          ) : (
            <ul className="staff-pos-list">
              {rows.map(r => {
                const n = Math.round(1 / r.share)
                return (
                  <li key={r.sale.id || r.sale.criado_em}>
                    <span className="sa-line-icon"><Icon name={n > 1 ? 'people' : 'pos'} size={18} /></span>
                    <div>
                      <strong>{tokyoClock(r.sale.criado_em) || r.sale.data}</strong>
                      <span>{n > 1 ? t('staffPos.shared', { n }) : t('staffPos.ticketTotal', { amount: fmtYen(r.sale.total) })}{n > 1 ? ` · ${t('staffPos.ticketTotal', { amount: fmtYen(r.sale.total) })}` : ''}</span>
                    </div>
                    <strong className="num">{fmtYen(r.amount)}</strong>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <div className="sa-sheet-foot">
          <button type="button" className="sa-btn" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  )
}
