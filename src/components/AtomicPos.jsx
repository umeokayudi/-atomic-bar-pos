import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import PhotoField from './ui/PhotoField'
import { useAuth } from './Auth'
import { fmtYen, fmtDate, Spinner, SectionTitle } from './utils'
import {
  checkPosSchema,
  computeDayMetrics,
  findLowStockProducts,
  buildStockMap,
  generateDiscountCode,
  todayKey,
  isRestockPedido,
} from '../lib/atomicPos'
import { isSupplierProduct } from './utils'
import { tokyoMonthKey, tokyoNightKey } from '../lib/tokyo'
import { useI18n } from '../lib/i18n'
import { buildVoid, canVoid, isVoidRow, isVoided } from '../lib/posVoid'
import { summarizeNight, reconcileNight, nightWindow, closeVariance, saleOnNight, prevTokyoDateKey, lastBusyNight } from '../lib/nightClose'
import PosQuick from './pos/PosQuick'
import { personCredit, staffAliases } from '../lib/saleCredit'
import { fetchCastRoster } from '../lib/castRoster'
import { castRoster } from '../lib/staffPos'
import { forgetLiveSelects } from '../lib/barLiveClient'
import PosPaySettings from './pos/PosPaySettings'
import Icon from './ui/Icon'
import { useUiPrefs } from '../lib/uiPrefs'

const SUB_TAB_IDS = [
  { id: 'dashboard', key: 'tabDashboard', icon: 'dashboard' },
  { id: 'checkout', key: 'tabCheckout', icon: 'pos' },
  { id: 'vip', key: 'tabVip', icon: 'star' },
  { id: 'drinkback', key: 'tabDrinkBack', icon: 'drinkback' },
  { id: 'prices', key: 'tabPrices', icon: 'precos' },
  { id: 'discounts', key: 'tabDiscounts', icon: 'percent' },
]

function SetupBanner({ onRefresh }) {
  const { t } = useI18n()
  const [setup, setSetup] = useState(null)
  useEffect(() => { checkPosSchema(supabase).then(setSetup) }, [])
  if (!setup || setup.ready) return null
  return (
    <div style={{ background: 'var(--amber-bg)', border: '1px solid #fcd34d', borderRadius: 12, padding: 16, marginBottom: 20, fontSize: 13 }}>
      <strong>{t('atomicPos.setupRequired')}</strong>
      <p style={{ margin: '8px 0', color: 'var(--amber)' }}>
        {t('atomicPos.setupHint')}
      </p>
      <button onClick={onRefresh} style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12 }}>{t('atomicPos.checkAgain')}</button>
    </div>
  )
}

function NightCloseBar({ bar, salesHint = [], compact = false }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const nightKey = tokyoNightKey()
  const lastNightKey = prevTokyoDateKey(nightKey)
  const [shift, setShift] = useState(null)
  const [counted, setCounted] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [nightSales, setNightSales] = useState(salesHint || [])
  const [cashMoves, setCashMoves] = useState([])
  const [open, setOpen] = useState(!compact)
  const [pending, setPending] = useState(null)
  const [pendingCount, setPendingCount] = useState('')

  useEffect(() => {
    const bounds = nightWindow(nightKey)
    const salesRich = 'id,total,refunded,card_fee,card_fee_reversed,data,criado_em,metodo_pagamento,obs'
    const cashRich = 'tipo,valor,referencia_tipo,data,operational_day'
    Promise.all([
      supabase.from('pos_shifts').select('*').eq('bar_id', bar.id).eq('night_key', nightKey).maybeSingle(),
      supabase.from('pos_vendas').select(salesRich).eq('bar_id', bar.id).gte('data', `${tokyoMonthKey()}-01`),
      supabase.from('caixa_movimentos').select(cashRich).eq('bar_id', bar.id).gte('data', bounds.from).lte('data', bounds.to),
      supabase.from('pos_shifts').select('*').eq('bar_id', bar.id).eq('status', 'counting').order('night_key', { ascending: false }).limit(1),
    ]).then(async ([sh, sl, cash, waiting]) => {
      setShift(sh.data || null)
      setPending((waiting?.data || []).find(r => r.night_key !== nightKey) || null)
      if (sl.error && /refunded|card_fee/.test(sl.error.message || '')) {
        const plain = await supabase.from('pos_vendas').select('id,total,data,criado_em,metodo_pagamento,obs').eq('bar_id', bar.id).gte('data', `${tokyoMonthKey()}-01`)
        setNightSales(plain.data || salesHint || [])
      } else {
        setNightSales(sl.data || salesHint || [])
      }
      if (cash.error && /operational_day/.test(cash.error.message || '')) {
        const plain = await supabase.from('caixa_movimentos').select('tipo,valor,referencia_tipo,data').eq('bar_id', bar.id).gte('data', bounds.from).lte('data', bounds.to)
        setCashMoves(plain.data || [])
      } else {
        setCashMoves(cash.data || [])
      }
    }).catch(() => setShift(null))
  }, [bar.id, nightKey, lastNightKey, salesHint.length])

  const summary = reconcileNight(nightSales, cashMoves, nightKey)
  const lastNight = summarizeNight(nightSales, lastNightKey)
  const lastBusy = lastBusyNight(nightSales, nightKey)
  const prior = lastNight.ticketCount > 0
    ? { date: lastNightKey, count: lastNight.ticketCount, amount: lastNight.drinksTotal, split: lastNight }
    : lastBusy.total > 0
      ? { date: lastBusy.date, count: lastBusy.ticketCount, amount: lastBusy.total, split: summarizeNight(nightSales, lastBusy.date) }
      : null
  const closed = shift?.status === 'closed'
  const countingNow = shift?.status === 'counting'

  if (compact && !open) {
    return (
      <button type="button" className="pos-close-mini" onClick={() => setOpen(true)}>
        {summary.ticketCount > 0
          ? `${t('atomicPos.nightClose')} · ${summary.ticketCount} · ${fmtYen(summary.drinksTotal)}`
          : prior
            ? t('atomicPos.lastNight', { date: prior.date, count: prior.count, amount: fmtYen(prior.amount) })
            : `${t('atomicPos.nightClose')} · 0 · ${fmtYen(0)}`}
      </button>
    )
  }

  async function closeNight() {
    setBusy(true)
    setMsg('')
    let salesRes = await supabase.from('pos_vendas')
      .select('id,total,refunded,card_fee,card_fee_reversed,data,criado_em,metodo_pagamento,obs')
      .eq('bar_id', bar.id)
      .gte('data', lastNightKey)
    if (salesRes.error && /refunded|card_fee/.test(salesRes.error.message || '')) {
      salesRes = await supabase.from('pos_vendas')
        .select('id,total,data,criado_em,metodo_pagamento,obs')
        .eq('bar_id', bar.id)
        .gte('data', lastNightKey)
    }
    const sum = reconcileNight(salesRes.data || salesHint, cashMoves, nightKey)
    // The drawer must be counted: an empty field used to be saved as "matched", so a shortage never showed.
    if (counted === '' || !Number.isFinite(+counted)) {
      setBusy(false)
      setMsg(t('atomicPos.countRequired'))
      return
    }
    const countedCash = +counted
    const row = {
      bar_id: bar.id,
      night_key: nightKey,
      status: 'closed',
      closed_at: new Date().toISOString(),
      closed_by: user?.id || null,
      ticket_count: sum.ticketCount,
      drinks_total: sum.drinksTotal,
      cash_total: sum.cashTotal,
      card_total: sum.cardTotal,
      other_total: (sum.otherTotal || 0) + (sum.paypayTotal || 0),
      expected_cash: sum.expectedCash,
      counted_cash: countedCash,
      variance: closeVariance(sum.expectedCash, countedCash),
    }
    let error
    if (shift?.id) {
      ;({ error } = await supabase.from('pos_shifts').update(row).eq('id', shift.id))
    } else {
      const ins = await supabase.from('pos_shifts').insert(row).select('*').single()
      error = ins.error
      if (ins.data) setShift(ins.data)
    }
    setBusy(false)
    if (error) {
      setMsg(error.message)
      return
    }
    setShift(s => ({ ...(s || {}), ...row, status: 'closed' }))
    setMsg(`${t('atomicPos.closedOk')} · ${t('atomicPos.varianceLine', { expected: fmtYen(row.expected_cash), counted: fmtYen(row.counted_cash), diff: fmtYen(row.variance) })}`)
  }

  /** Saves the real cash for a night the automatic close shut without a count. */
  async function saveCount(target, value, done) {
    if (value === '' || !Number.isFinite(+value)) { setMsg(t('atomicPos.countRequired')); return }
    setBusy(true)
    const patch = {
      status: 'closed',
      counted_cash: +value,
      variance: closeVariance(target.expected_cash, +value),
      closed_by: user?.id || target.closed_by || null,
    }
    const { error } = await supabase.from('pos_shifts').update(patch).eq('id', target.id)
    setBusy(false)
    if (error) { setMsg(error.message); return }
    done({ ...target, ...patch })
    setMsg(t('atomicPos.countSaved', { diff: fmtYen(patch.variance) }))
  }

  return (
    <div className="pos-close-bar">
      <div className="pos-close-head">
        <span className="pos-ticket-label">{t('atomicPos.nightClose')}</span>
        <span className={`ui-badge ${closed ? 'is-success' : countingNow ? 'is-warning' : 'is-info'}`}>
          {t(closed ? 'atomicPos.closeStateClosed' : countingNow ? 'atomicPos.closeStateCounting' : 'atomicPos.closeStateOpen')}
        </span>
      </div>
      <div className="pos-close-total">
        <strong>{fmtYen(summary.drinksTotal)}</strong>
        <span>{t('atomicPos.nightOpen', { date: nightKey })} · {t('atomicPos.ticketsToday', { count: summary.ticketCount })}</span>
      </div>
      <div className="pos-close-methods">
        <div><span>{t('atomicPos.payCash')}</span><strong>{fmtYen(summary.cashTotal)}</strong></div>
        <div><span>{t('atomicPos.payCard')}</span><strong>{fmtYen(summary.cardTotal)}</strong></div>
        <div><span>{t('atomicPos.payPaypay')}</span><strong>{fmtYen(summary.paypayTotal || 0)}</strong></div>
      </div>
      <details className="pos-close-books">
        <summary>{t('atomicPos.closeDetails')}</summary>
        <dl>
          <dt>{t('atomicPos.booksGross')}</dt><dd>{fmtYen(summary.gross_sales || summary.grossSales || 0)}</dd>
          <dt>{t('atomicPos.booksRefunds')}</dt><dd>{fmtYen(summary.refunds || 0)}</dd>
          <dt>{t('atomicPos.booksNet')}</dt><dd>{fmtYen(summary.net_sales || summary.netSales || summary.drinksTotal || 0)}</dd>
          <dt>{t('atomicPos.booksFees')}</dt><dd>{fmtYen(summary.card_fees || summary.cardFees || 0)}</dd>
          <dt>{t('atomicPos.booksCash')}</dt><dd>{fmtYen(summary.cashNet || 0)}</dd>
        </dl>
      </details>
      {summary.ticketCount === 0 && prior && (
        <div className="pos-close-last">
          {t('atomicPos.lastNight', { date: prior.date, count: prior.count, amount: fmtYen(prior.amount) })}
          <span>{t('atomicPos.paySplit', { cash: fmtYen(prior.split.cashTotal), card: fmtYen(prior.split.cardTotal), paypay: fmtYen(prior.split.paypayTotal || 0) })}</span>
        </div>
      )}
      {pending && (
        <div className="pos-close-actions pos-close-pending">
          <div className="pos-close-msg">{t('atomicPos.countPending', { date: pending.night_key, expected: fmtYen(pending.expected_cash) })}</div>
          <input type="number" min="0" placeholder={t('atomicPos.cashCounted')} value={pendingCount} onChange={e => setPendingCount(e.target.value)} />
          <button type="button" className="btn-primary" disabled={busy || pendingCount === ''} onClick={() => saveCount(pending, pendingCount, () => { setPending(null); setPendingCount('') })}>
            {t('atomicPos.saveCount')}
          </button>
        </div>
      )}
      {closed ? (
        <div className="pos-close-done">
          {t('atomicPos.alreadyClosed')} · {fmtYen(shift.drinks_total || summary.drinksTotal)}
          {shift.counted_cash != null && (
            <div className="pos-close-split">{t('atomicPos.varianceLine', { expected: fmtYen(shift.expected_cash), counted: fmtYen(shift.counted_cash), diff: fmtYen(shift.variance) })}</div>
          )}
        </div>
      ) : countingNow ? (
        <div className="pos-close-actions">
          <div className="pos-close-msg">{t('atomicPos.countPending', { date: shift.night_key, expected: fmtYen(shift.expected_cash) })}</div>
          <input type="number" min="0" placeholder={t('atomicPos.cashCounted')} value={counted} onChange={e => setCounted(e.target.value)} />
          <button type="button" className="btn-primary" disabled={busy || counted === ''} onClick={() => saveCount(shift, counted, setShift)}>
            {t('atomicPos.saveCount')}
          </button>
        </div>
      ) : (
        <div className="pos-close-actions">
          <input
            type="number"
            min="0"
            placeholder={t('atomicPos.cashCounted')}
            value={counted}
            onChange={e => setCounted(e.target.value)}
          />
          <button type="button" className="btn-primary" disabled={busy || counted === ''} title={counted === '' ? t('atomicPos.countRequired') : undefined} onClick={closeNight}>
            {busy ? t('common.saving') : t('atomicPos.closeNight')}
          </button>
        </div>
      )}
      {msg && <div className="pos-close-msg">{msg}</div>}
      {compact && (
        <button type="button" className="pos-close-hide" onClick={() => setOpen(false)}>{t('atomicPos.hideClose')}</button>
      )}
    </div>
  )
}

// ── VIP ───────────────────────────────────────────────────────────────────────
function PosVipTab({ bar, drinks, onUpdate }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [members, setMembers] = useState([])
  const [usages, setUsages] = useState([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('register')
  const [memberForm, setMemberForm] = useState({ nome: '', codigo: '', tier: 'standard', notas: '' })
  const [usageForm, setUsageForm] = useState({ vip_member_id: '', drink_menu_id: '', qtd: 1, obs: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [bar])

  async function load() {
    setLoading(true)
    const [mR, uR] = await Promise.all([
      supabase.from('vip_members').select('*').eq('bar_id', bar.id).order('nome'),
      supabase.from('vip_usages').select('*, vip_members(nome)').eq('bar_id', bar.id).order('criado_em', { ascending: false }).limit(40),
    ])
    setMembers(mR.data || [])
    setUsages(uR.data || [])
    setLoading(false)
  }

  async function saveMember() {
    if (!memberForm.nome) return alert(t('atomicPos.nameRequired'))
    setSaving(true)
    await supabase.from('vip_members').insert({ bar_id: bar.id, ...memberForm, codigo: memberForm.codigo || null })
    setMemberForm({ nome: '', codigo: '', tier: 'standard', notas: '' })
    setSaving(false)
    load()
    onUpdate?.()
  }

  async function registerUsage() {
    if (!usageForm.vip_member_id || !usageForm.drink_menu_id) return alert(t('atomicPos.selectMemberDrink'))
    const drink = drinks.find(d => d.id === usageForm.drink_menu_id)
    if (!drink) return
    setSaving(true)
    const preco = drink.preco_desconto || 500
    await supabase.from('vip_usages').insert({
      bar_id: bar.id,
      vip_member_id: usageForm.vip_member_id,
      drink_menu_id: drink.id,
      nome: drink.nome,
      qtd: +usageForm.qtd || 1,
      preco_aplicado: preco,
      preco_lista: drink.preco_venda,
      tipo: 'vip',
      obs: usageForm.obs,
      criado_por: user?.id,
    })
    setUsageForm({ vip_member_id: '', drink_menu_id: '', qtd: 1, obs: '' })
    setSaving(false)
    load()
  }

  if (loading) return <Spinner text={t('atomicPos.loadingVip')} />

  const monthUsages = usages.filter(u => u.criado_em && tokyoMonthKey(u.criado_em) === tokyoMonthKey())
  const monthTotal = monthUsages.reduce((a, u) => a + (+u.preco_aplicado || 0) * (+u.qtd || 1), 0)

  return (
    <div>
      <div className="pos-mode-row">
        {[['register', t('atomicPos.registerUse')], ['members', t('atomicPos.members')], ['history', t('atomicPos.history')]].map(([id, label]) => (
          <button key={id} onClick={() => setMode(id)} style={{
            padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 600,
            background: mode === id ? 'var(--navy)' : 'var(--bg3)', color: mode === id ? '#fff' : 'var(--text2)', border: 'none',
          }}>{label}</button>
        ))}
      </div>

      <div className="pos-stat3">
        <StatCard label={t('atomicPos.vipMembers')} value={members.filter(m => m.ativo).length} />
        <StatCard label={t('atomicPos.usesThisMonth')} value={monthUsages.length} />
        <StatCard label={t('atomicPos.vipMonthTotal')} value={fmtYen(monthTotal)} />
      </div>

      {mode === 'register' && (
        <div className="card" style={{ maxWidth: 480 }}>
          <SectionTitle>{t('atomicPos.registerVipUse')}</SectionTitle>
          <label className="form-label">{t('atomicPos.member')}</label>
          <select value={usageForm.vip_member_id} onChange={e => setUsageForm({ ...usageForm, vip_member_id: e.target.value })} style={{ width: '100%', marginBottom: 12 }}>
            <option value="">{t('atomicPos.selectPlaceholder')}</option>
            {members.filter(m => m.ativo).map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
          <label className="form-label">{t('atomicPos.drink')}</label>
          <select value={usageForm.drink_menu_id} onChange={e => setUsageForm({ ...usageForm, drink_menu_id: e.target.value })} style={{ width: '100%', marginBottom: 12 }}>
            <option value="">{t('atomicPos.selectPlaceholder')}</option>
            {drinks.map(d => <option key={d.id} value={d.id}>{d.nome} — VIP {fmtYen(d.preco_desconto || 500)}</option>)}
          </select>
          <label className="form-label">{t('atomicPos.quantity')}</label>
          <input type="number" min="1" value={usageForm.qtd} onChange={e => setUsageForm({ ...usageForm, qtd: e.target.value })} style={{ width: '100%', marginBottom: 12 }} />
          <button className="btn-primary" onClick={registerUsage} disabled={saving} style={{ width: '100%', padding: 12 }}>{saving ? '...' : t('atomicPos.registerVipUseBtn')}</button>
        </div>
      )}

      {mode === 'members' && (
        <div className="pos-split">
          <div className="card">
            <SectionTitle>{t('atomicPos.newMember')}</SectionTitle>
            <input placeholder={t('atomicPos.namePlaceholder')} value={memberForm.nome} onChange={e => setMemberForm({ ...memberForm, nome: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
            <input placeholder={t('atomicPos.cardCodeOptional')} value={memberForm.codigo} onChange={e => setMemberForm({ ...memberForm, codigo: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
            <button className="btn-primary" onClick={saveMember} disabled={saving} style={{ width: '100%', padding: 10 }}>{t('atomicPos.addMember')}</button>
          </div>
          <div>
            {members.map(m => (
              <div key={m.id} className="card" style={{ marginBottom: 8, padding: 14 }}>
                <div style={{ fontWeight: 700 }}>{m.nome}</div>
                {m.codigo && <div style={{ fontSize: 12, color: 'var(--text2)' }}>{t('atomicPos.codeLabel', { code: m.codigo })}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'history' && (
        <div>
          {usages.map(u => (
            <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <div>
                <strong>{u.vip_members?.nome || 'VIP'}</strong> — {u.nome} ×{u.qtd}
                <div style={{ fontSize: 11, color: 'var(--text2)' }}>{fmtDate(u.criado_em?.slice(0, 10))}</div>
              </div>
              <div style={{ fontWeight: 700 }}>{fmtYen((u.preco_aplicado || 0) * (u.qtd || 1))}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── PRICES (menu + shots) ─────────────────────────────────────────────────────
const EMPTY_DRINK = { nome: '', categoria: 'Custom', preco_venda: '', custo: '', preco_desconto: '500', imagem_url: '' }
const drinkToForm = d => ({ nome: d.nome, categoria: d.categoria, preco_venda: d.preco_venda, custo: d.custo, preco_desconto: d.preco_desconto || 500, imagem_url: d.imagem_url || '' })

/** Phone: one drink's fields and actions in a bottom sheet (the table does not fit a phone). */
function PosDrinkSheet({ sheet, setSheet, saving, onSave }) {
  const { t } = useI18n()
  const f = sheet.form
  const set = patch => setSheet(s => ({ ...s, form: { ...s.form, ...patch } }))
  const price = +f.preco_venda || 0
  const margin = price > 0 ? Math.round(((price - (+f.custo || 0)) / price) * 100) : null
  return (
    <div className="ord-modal-bg pos-sheet-bg" onClick={() => !saving && setSheet(null)}>
      <div className="ord-modal wide pos-sheet" role="dialog" aria-modal="true" aria-label={sheet.id ? t('atomicPos.editDrink') : t('atomicPos.newDrink')} onClick={e => e.stopPropagation()}>
        <div className="pos-sheet-head">
          <div className="ord-modal-title">{sheet.id ? f.nome || t('atomicPos.editDrink') : t('atomicPos.newDrink')}</div>
          <button type="button" className="pos-sheet-x" onClick={() => setSheet(null)} aria-label={t('common.close')}><Icon name="close" size={18} /></button>
        </div>
        <label className="form-label">{t('atomicPos.namePlaceholder')}</label>
        <input value={f.nome} onChange={e => set({ nome: e.target.value })} />
        <div className="pos-sheet-grid">
          <div>
            <label className="form-label">{t('atomicPos.priceYen')}</label>
            <input type="number" inputMode="numeric" value={f.preco_venda} onChange={e => set({ preco_venda: e.target.value })} />
          </div>
          <div>
            <label className="form-label">{t('atomicPos.costYen')}</label>
            <input type="number" inputMode="numeric" value={f.custo} onChange={e => set({ custo: e.target.value })} />
          </div>
          <div>
            <label className="form-label">{t('atomicPos.vipYen')}</label>
            <input type="number" inputMode="numeric" value={f.preco_desconto} onChange={e => set({ preco_desconto: e.target.value })} />
          </div>
          <div>
            <label className="form-label">{t('atomicPos.colMargin')}</label>
            <div className="pos-sheet-readout">{margin == null ? '—' : `${margin}%`}</div>
          </div>
        </div>
        <PhotoField value={f.imagem_url || ''} onChange={url => set({ imagem_url: url })} scope="menu" name={f.nome} />
        <div className="ord-modal-actions pos-sheet-actions">
          <button type="button" className="ord-ghost" onClick={() => setSheet(null)} disabled={saving}>{t('common.cancel')}</button>
          <button type="button" className="btn-primary" onClick={onSave} disabled={saving || !f.nome || !f.preco_venda}>
            {saving ? t('common.saving') : sheet.id ? t('common.save') : t('common.add')}
          </button>
        </div>
      </div>
    </div>
  )
}

function PosPricesTab({ bar, drinks, onRefresh }) {
  const { t } = useI18n()
  const { device } = useUiPrefs()
  const phone = device === 'phone'
  const [sheet, setSheet] = useState(null)
  const [priceMode, setPriceMode] = useState('menu')
  const [produtos, setProdutos] = useState([])
  const [pricing, setPricing] = useState({})
  const [form, setForm] = useState(EMPTY_DRINK)
  const [shotForm, setShotForm] = useState({ produto_id: '', drinks: '16', preco: '' })
  const [editId, setEditId] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('produtos_public').select('*').eq('ativo', true).order('nome').then(({ data }) => setProdutos(data || []))
    supabase.from('bar_pricing').select('*, produtos(nome,categoria,preco_venda)').eq('bar_id', bar.id).then(({ data }) => {
      const m = {}
      ;(data || []).forEach(p => { m[p.produto_id] = p })
      setPricing(m)
    })
  }, [bar, drinks])

  async function saveDrink(f, id) {
    if (!f.nome || !f.preco_venda) return false
    setSaving(true)
    const custo = +f.custo || 0
    const payload = {
      bar_id: bar.id,
      nome: f.nome,
      categoria: f.categoria,
      preco_venda: +f.preco_venda,
      custo,
      margem: f.preco_venda > 0 ? (+f.preco_venda - custo) / +f.preco_venda : 0,
      preco_desconto: +f.preco_desconto || 500,
      custom: true,
    }
    // Only sent when filled, so saving still works before sql/pos_start.sql adds the column.
    if (f.imagem_url?.trim()) payload.imagem_url = f.imagem_url.trim()
    const { error } = id
      ? await supabase.from('drink_menu').update(payload).eq('id', id)
      : await supabase.from('drink_menu').insert(payload)
    setSaving(false)
    if (error) { alert(error.message); return false }
    onRefresh()
    return true
  }

  async function saveInline() {
    if (await saveDrink(form, editId)) {
      setForm(EMPTY_DRINK)
      setEditId(null)
    }
  }

  async function saveSheet() {
    if (await saveDrink(sheet.form, sheet.id)) setSheet(null)
  }

  async function saveShot() {
    if (!shotForm.produto_id || !shotForm.preco) return
    setSaving(true)
    await supabase.from('bar_pricing').upsert({
      bar_id: bar.id,
      produto_id: shotForm.produto_id,
      drinks_por_garrafa: +shotForm.drinks || 16,
      preco_drink: +shotForm.preco,
    }, { onConflict: 'bar_id,produto_id' })
    setShotForm({ produto_id: '', drinks: '16', preco: '' })
    setSaving(false)
    onRefresh()
  }

  return (
    <div>
      <div className="pos-mode-row">
        {[['menu', t('atomicPos.menuDrinks')], ['shots', t('atomicPos.shotsBottle')], ['payments', t('posCard.tab')]].map(([id, label]) => (
          <button key={id} onClick={() => setPriceMode(id)} style={{
            padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 600,
            background: priceMode === id ? 'var(--navy)' : 'var(--bg3)', color: priceMode === id ? '#fff' : 'var(--text2)', border: 'none',
          }}>{label}</button>
        ))}
      </div>

      {priceMode === 'menu' && !phone && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <SectionTitle>{editId ? t('atomicPos.editDrink') : t('atomicPos.newDrink')}</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 8 }}>
              <input placeholder={t('atomicPos.namePlaceholder')} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} />
              <input placeholder={t('atomicPos.priceYen')} type="number" value={form.preco_venda} onChange={e => setForm({ ...form, preco_venda: e.target.value })} />
              <input placeholder={t('atomicPos.costYen')} type="number" value={form.custo} onChange={e => setForm({ ...form, custo: e.target.value })} />
              <input placeholder={t('atomicPos.vipYen')} type="number" value={form.preco_desconto} onChange={e => setForm({ ...form, preco_desconto: e.target.value })} />
              <button className="btn-primary" onClick={saveInline} disabled={saving}>{editId ? t('common.save') : t('common.add')}</button>
              <div style={{ gridColumn: '1 / -1' }}>
                <PhotoField value={form.imagem_url || ''} onChange={url => setForm(f => ({ ...f, imagem_url: url }))} scope="menu" name={form.nome} />
              </div>
            </div>
          </div>
          <table style={{ width: '100%', fontSize: 13 }}>
            <thead><tr>{[t('atomicPos.colDrink'), t('atomicPos.colPrice'), t('atomicPos.colVip'), t('atomicPos.colMargin'), ''].map(h => <th key={h || 'x'} style={{ textAlign: 'left', padding: 8 }}>{h}</th>)}</tr></thead>
            <tbody>
              {drinks.map(d => (
                <tr key={d.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: 8 }}>{d.nome}</td>
                  <td>{fmtYen(d.preco_venda)}</td>
                  <td style={{ color: 'var(--gold)' }}>{fmtYen(d.preco_desconto || 500)}</td>
                  <td>{Math.round((d.margem || 0) * 100)}%</td>
                  <td><button onClick={() => { setEditId(d.id); setForm(drinkToForm(d)) }} style={{ fontSize: 11 }}>{t('common.edit')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {priceMode === 'menu' && phone && (
        <>
          <button type="button" className="btn-primary pos-new-drink" onClick={() => setSheet({ id: null, form: EMPTY_DRINK })}>
            <Icon name="plus" size={16} /> {t('atomicPos.newDrink')}
          </button>
          <div className="pos-hint">{t('atomicPos.tapDrinkToEdit')}</div>
          <div className="pos-price-list">
            {drinks.map(d => (
              <button type="button" key={d.id} className="pos-price-row" onClick={() => setSheet({ id: d.id, form: drinkToForm(d) })}>
                {d.imagem_url
                  ? <img className="pos-price-thumb" src={d.imagem_url} alt="" loading="lazy" />
                  : <span className="pos-price-thumb is-empty"><Icon name="image" size={16} /></span>}
                <span className="pos-price-main">
                  <span className="pos-price-name">{d.nome}</span>
                  <span className="pos-price-meta">
                    <span className="pos-price-vip">{t('atomicPos.colVip')} {fmtYen(d.preco_desconto || 500)}</span>
                    {' · '}{t('atomicPos.colMargin')} {Math.round((d.margem || 0) * 100)}%
                  </span>
                </span>
                <span className="pos-price-yen">{fmtYen(d.preco_venda)}</span>
                <Icon name="next" size={16} />
              </button>
            ))}
          </div>
          {sheet && <PosDrinkSheet sheet={sheet} setSheet={setSheet} saving={saving} onSave={saveSheet} />}
        </>
      )}

      {priceMode === 'payments' && <PosPaySettings bar={bar} />}

      {priceMode === 'shots' && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="pos-shot-form">
              <select value={shotForm.produto_id} onChange={e => setShotForm({ ...shotForm, produto_id: e.target.value })}>
                <option value="">{t('atomicPos.jbmProduct')}</option>
                {produtos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
              <input placeholder={t('atomicPos.drinksPerBottle')} type="number" value={shotForm.drinks} onChange={e => setShotForm({ ...shotForm, drinks: e.target.value })} />
              <input placeholder={t('atomicPos.pricePerDrink')} type="number" value={shotForm.preco} onChange={e => setShotForm({ ...shotForm, preco: e.target.value })} />
              <button className="btn-primary" onClick={saveShot} disabled={saving}>{t('common.save')}</button>
            </div>
          </div>
          {Object.values(pricing).map(p => (
            <div key={p.produto_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <span>{p.produtos?.nome}</span>
              <span>{p.drinks_por_garrafa} drinks · {fmtYen(p.preco_drink)}/drink</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ── DISCOUNT CODES ────────────────────────────────────────────────────────────
function PosDiscountTab({ bar, drinks, onUpdate }) {
  const { t } = useI18n()
  const [codes, setCodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({
    codigo: generateDiscountCode(),
    descricao: '',
    tipo: 'percent',
    valor: '10',
    max_usos: '',
    valido_ate: '',
    drink_menu_id: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [bar])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('discount_codes').select('*').eq('bar_id', bar.id).order('criado_em', { ascending: false })
    setCodes(data || [])
    setLoading(false)
  }

  async function saveCode() {
    if (!form.codigo || !form.valor) return
    setSaving(true)
    await supabase.from('discount_codes').insert({
      bar_id: bar.id,
      codigo: form.codigo.toUpperCase(),
      descricao: form.descricao,
      tipo: form.tipo,
      valor: +form.valor,
      max_usos: form.max_usos ? +form.max_usos : null,
      valido_ate: form.valido_ate || null,
      drink_menu_id: form.drink_menu_id || null,
      ativo: true,
    })
    setForm({ ...form, codigo: generateDiscountCode(), descricao: '', valor: '10' })
    setSaving(false)
    load()
    onUpdate?.()
  }

  async function toggleCode(id, ativo) {
    await supabase.from('discount_codes').update({ ativo: !ativo }).eq('id', id)
    load()
  }

  if (loading) return <Spinner />

  return (
    <div className="pos-split">
      <div className="card">
        <SectionTitle>{t('atomicPos.createDiscount')}</SectionTitle>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input value={form.codigo} onChange={e => setForm({ ...form, codigo: e.target.value.toUpperCase() })} style={{ flex: 1 }} />
          <button onClick={() => setForm({ ...form, codigo: generateDiscountCode() })} style={{ padding: '8px 12px', fontSize: 11 }}>{t('atomicPos.generate')}</button>
        </div>
        <input placeholder={t('atomicPos.description')} value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
            <option value="percent">{t('atomicPos.percentLabel')}</option>
            <option value="fixed">{t('atomicPos.fixedLabel')}</option>
          </select>
          <input type="number" placeholder={t('atomicPos.valuePlaceholder')} value={form.valor} onChange={e => setForm({ ...form, valor: e.target.value })} />
        </div>
        <select value={form.drink_menu_id} onChange={e => setForm({ ...form, drink_menu_id: e.target.value })} style={{ width: '100%', marginBottom: 8 }}>
          <option value="">{t('atomicPos.allDrinks')}</option>
          {drinks.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
        </select>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          <input type="number" placeholder={t('atomicPos.maxUses')} value={form.max_usos} onChange={e => setForm({ ...form, max_usos: e.target.value })} />
          <input type="date" value={form.valido_ate} onChange={e => setForm({ ...form, valido_ate: e.target.value })} />
        </div>
        <button className="btn-primary" onClick={saveCode} disabled={saving} style={{ width: '100%', padding: 12 }}>{t('atomicPos.createCode')}</button>
      </div>
      <div>
        {codes.map(c => (
          <div key={c.id} className="card" style={{ marginBottom: 8, padding: 14, opacity: c.ativo ? 1 : 0.5 }}>
            <div className="pos-list-row">
              <div className="pos-list-main">
                <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: 1 }}>{c.codigo}</div>
                <div className="pos-list-meta">
                  {c.tipo === 'percent' ? `${c.valor}% off` : fmtYen(c.valor)} · {t('atomicPos.usesLabel')} {c.usos_atual || 0}{c.max_usos ? `/${c.max_usos}` : ''}
                </div>
              </div>
              <button type="button" className="pos-mini-btn" onClick={() => toggleCode(c.id, c.ativo)}>{c.ativo ? t('atomicPos.deactivate') : t('atomicPos.activate')}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12, padding: 14 }}>
      <div style={{ fontSize: 11, color: 'var(--text2)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4, color: color || 'inherit' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function HourlyChart({ data, height = 100 }) {
  const { t } = useI18n()
  const activeHours = data.filter(h => h.total > 0 || h.count > 0)
  if (!activeHours.length) return <div className="hourly-empty">{t('atomicPos.hourlyEmpty')}</div>
  const max = Math.max(...data.map(d => d.total), 1)
  return (
    <div className="hourly-chart" style={{ height: height + 32 }}>
      {data.map((d, i) => {
        const barH = Math.max(2, (d.total / max) * height)
        const hasData = d.total > 0
        return (
          <div key={i} className="hourly-col" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            {hasData && <div className="hourly-val" style={{ fontSize: 9, color: 'var(--text2)', fontWeight: 600 }}>{fmtYen(d.total)}</div>}
            <div style={{
              width: '100%', maxWidth: 28, height: barH, borderRadius: '4px 4px 0 0',
              background: hasData ? 'var(--navy)' : 'var(--bg3)', opacity: hasData ? 1 : 0.3,
            }} title={`${d.label}: ${fmtYen(d.total)} (${d.count} ${t('atomicPos.salesWord')})`} />
            <div className={`hourly-hour${i % 3 ? ' is-minor' : ''}`} style={{ fontSize: 9, color: 'var(--text3)' }}>{d.label.slice(0, 2)}h</div>
          </div>
        )
      })}
    </div>
  )
}

function PosDashboardTab({ bar, todaySales, salesList, onOrder, onVoided }) {
  const { t } = useI18n()
  const [lowStock, setLowStock] = useState([])
  const [agentStats, setAgentStats] = useState([])
  const [openRestock, setOpenRestock] = useState([])
  const [loading, setLoading] = useState(true)

  const metrics = useMemo(() => computeDayMetrics(salesList || []), [salesList])

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [mR, rR, pR, aR, sR, pedR] = await Promise.all([
        supabase.from('estoque_movimentos').select('produto_id,tipo,qtd').eq('bar_id', bar.id),
        supabase.from('estoque_regras').select('produto_id,minimo').eq('bar_id', bar.id),
        supabase.from('produtos_public').select('id,nome,categoria').eq('ativo', true),
        supabase.from('drink_back_agents').select('id,nome,comissao_pct,notas').eq('bar_id', bar.id).eq('ativo', true),
        supabase.from('pos_vendas').select('total,obs,drink_back_agent_id').eq('bar_id', bar.id).eq('data', todayKey()).not('drink_back_agent_id', 'is', null),
        supabase.from('pedidos').select('id,status,obs,total_estimado,pedidos_itens(produto_id,qtd,produtos(nome))').eq('bar_id', bar.id).in('status', ['pendente', 'confirmado']),
      ])

      const stockMap = buildStockMap(mR.data || [])
      const regras = Object.fromEntries((rR.data || []).map(r => [r.produto_id, r.minimo]))
      const prods = (pR.data || []).filter(isSupplierProduct)
      setLowStock(findLowStockProducts(prods, stockMap, regras))

      const agents = aR.data || []
      const sales = sR.data || []
      // Shared tickets count for each person in equal parts (saleCredit.js).
      const aliases = staffAliases(agents)
      const agentMap = {}
      for (const a of agents) {
        const mine = personCredit(sales, { id: a.id, agentId: a.id, nome: a.nome }, { aliases, castOnly: true })
        agentMap[a.id] = { total: mine.sales, count: mine.tickets, comissao: mine.commission }
      }
      setAgentStats(agents.map(a => ({
        ...a,
        vendas: agentMap[a.id]?.count || 0,
        faturamento: agentMap[a.id]?.total || 0,
        comissao: agentMap[a.id]?.comissao || 0,
      })).filter(a => a.vendas > 0).sort((a, b) => b.faturamento - a.faturamento))

      setOpenRestock((pedR.data || []).filter(isRestockPedido))

      setLoading(false)
    }
    load()
  }, [bar, todaySales])

  return (
    <div className="easy-dash pos-easy-dash pos-dash">
      <div className="pos-dash-stats">
        <div className="pos-dash-stat is-main">
          <span>{t('atomicPos.todayAtCounter')}</span>
          <strong>{fmtYen(metrics.total)}</strong>
        </div>
        <div className="pos-dash-stat">
          <span>{t('atomicPos.dashSales')}</span>
          <strong>{metrics.count}</strong>
        </div>
        <div className="pos-dash-stat">
          <span>{t('atomicPos.avgTicket')}</span>
          <strong>{fmtYen(metrics.ticketMedio)}</strong>
        </div>
        <div className="pos-dash-stat">
          <span>{t('atomicPos.busiestHour')}</span>
          <strong>{metrics.peakHour?.total > 0 ? metrics.peakHour.label : '—'}</strong>
        </div>
      </div>

      <div className="pos-dash-grid">
        <div className="pos-dash-main">
          <div className="card pos-dash-card">
            <SectionTitle>{t('atomicPos.hourlyRevenue')}</SectionTitle>
            <HourlyChart data={metrics.hourly} />
          </div>
          <TonightSales bar={bar} salesList={salesList} onVoided={onVoided} />
          {agentStats.length > 0 && (
            <div className="card">
              <SectionTitle>{t('atomicPos.drinkBackToday')}</SectionTitle>
              {agentStats.map(a => (
                <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                  <div>
                    <strong>{a.nome}</strong>
                    <div style={{ fontSize: 11, color: 'var(--text2)' }}>{a.vendas} {t('atomicPos.salesWord')} · {t('atomicPos.commissionShort', { pct: a.comissao_pct })}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700 }}>{fmtYen(a.faturamento)}</div>
                    <div style={{ fontSize: 11, color: 'var(--gold)' }}>{t('atomicPos.commission')} {fmtYen(a.comissao)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="pos-dash-side">
          <NightCloseBar bar={bar} salesHint={salesList} />
          {openRestock.length === 0 && lowStock.length === 0 && (
            <div className="easy-dash-ok">{t('atomicPos.stockOk')}</div>
          )}
          {openRestock.length > 0 && (
            <div style={{
              background: 'var(--navy)', borderRadius: 16, padding: '16px 20px', marginBottom: 12,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
            }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'white', marginBottom: 4 }}>
                  {t('atomicPos.restockPending', { count: openRestock.length })}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)' }}>
                  {t('atomicPos.restockPendingHint')}
                </div>
              </div>
              {onOrder && (
                <button onClick={onOrder} style={{
                  background: 'var(--bg2)', color: 'var(--c-text)', border: 'none', borderRadius: 12,
                  padding: '10px 18px', fontWeight: 700, fontSize: 12, cursor: 'pointer',
                }}>
                  {t('atomicPos.seeJbmOrders')}
                </button>
              )}
            </div>
          )}

          {lowStock.length > 0 && (
            <div style={{
              background: 'linear-gradient(135deg,var(--amber) 0%,#ff6b00 100%)',
              borderRadius: 16, padding: '16px 20px', marginBottom: 12,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
            }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'white', marginBottom: 4 }}>
                  {t('atomicPos.lowStockAlert', { count: lowStock.length })}
                </div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.9)' }}>
                  {lowStock.slice(0, 4).map(p => `${p.nome} (${p.stock}/${p.minimo})`).join(' · ')}
                </div>
              </div>
              {onOrder && (
                <button onClick={onOrder} style={{
                  background: 'var(--bg2)', color: '#ff6b00', border: 'none', borderRadius: 12,
                  padding: '10px 18px', fontWeight: 700, fontSize: 12, cursor: 'pointer',
                }}>
                  {t('atomicPos.reorderJbm')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {loading && <Spinner />}
    </div>
  )
}

/** Tonight's tickets, each with Void for the owner/manager (this tab is never shown to the cashier). */
function TonightSales({ bar, salesList, onVoided }) {
  const { t } = useI18n()
  const { user, perfil } = useAuth()
  const [voiding, setVoiding] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const nightKey = tokyoNightKey()
  const rows = (salesList || []).filter(s => saleOnNight(s, nightKey)).slice().reverse()

  async function confirmVoid() {
    setBusy(true)
    setMsg('')
    try {
      const { voidRow, originalPatch } = buildVoid({ ...voiding, bar_id: voiding.bar_id || bar.id }, {
        reason, byName: perfil?.nome || user?.email, byId: user?.id,
      })
      const ins = await supabase.from('pos_vendas').insert(voidRow)
      if (ins.error) throw ins.error
      await supabase.from('pos_vendas').update(originalPatch).eq('id', voiding.id)
      setVoiding(null)
      setReason('')
      setMsg(t('atomicPos.voidDone'))
      onVoided?.()
    } catch (e) {
      setMsg(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <SectionTitle>{t('atomicPos.salesTonight')}</SectionTitle>
      {!rows.length && <div className="pos-close-split">{t('atomicPos.noSalesTonight')}</div>}
      {rows.map((s, i) => {
        const when = s.criado_em ? new Date(s.criado_em).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }) : ''
        const voidRow = isVoidRow(s)
        return (
          <div key={s.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ width: 48, color: 'var(--text2)' }}>{when}</span>
            <span style={{ flex: 1 }}>
              {s.metodo_pagamento || '—'}
              {voidRow && <span className="pos-close-split"> · {t('atomicPos.voidRowTag')}</span>}
              {isVoided(s) && <span className="pos-close-split"> · {t('atomicPos.voidedTag')}</span>}
            </span>
            <strong style={{ color: voidRow ? 'var(--red)' : undefined, textDecoration: isVoided(s) ? 'line-through' : undefined }}>{fmtYen(s.total)}</strong>
            {canVoid(s) && (
              <button type="button" className="ord-ghost" onClick={() => { setVoiding(s); setReason(''); setMsg('') }}>{t('atomicPos.voidSale')}</button>
            )}
          </div>
        )
      })}
      {voiding && (
        <div className="pos-close-actions" style={{ marginTop: 12 }}>
          <input type="text" placeholder={t('atomicPos.voidReason')} value={reason} onChange={e => setReason(e.target.value)} autoFocus />
          <button type="button" className="btn-primary" disabled={busy || !reason.trim()} onClick={confirmVoid}>
            {busy ? t('common.saving') : t('atomicPos.voidConfirm', { amount: fmtYen(voiding.total) })}
          </button>
          <button type="button" className="ord-ghost" onClick={() => setVoiding(null)} disabled={busy}>{t('common.cancel')}</button>
        </div>
      )}
      {msg && <div className="pos-close-msg">{msg}</div>}
    </div>
  )
}

// ── DRINK BACK ────────────────────────────────────────────────────────────────
function PosDrinkBackTab({ bar, onUpdate }) {
  const { t } = useI18n()
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ nome: '', regiao: '', comissao_pct: '10', notas: '' })
  const [saving, setSaving] = useState(false)
  const [schemaOk, setSchemaOk] = useState(true)

  useEffect(() => { load() }, [bar])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('drink_back_agents').select('*').eq('bar_id', bar.id).order('nome')
    if (error?.code === 'PGRST205') setSchemaOk(false)
    else { setSchemaOk(true); setAgents(data || []) }
    setLoading(false)
  }

  async function saveAgent() {
    if (!form.nome) return alert(t('atomicPos.nameRequired'))
    setSaving(true)
    const { error } = await supabase.from('drink_back_agents').insert({
      bar_id: bar.id,
      nome: form.nome,
      regiao: form.regiao || null,
      comissao_pct: +form.comissao_pct || 10,
      notas: form.notas || null,
      ativo: true,
    })
    if (error) { alert(error.message); setSaving(false); return }
    setForm({ nome: '', regiao: '', comissao_pct: '10', notas: '' })
    setSaving(false)
    load()
    onUpdate?.()
  }

  async function toggleAgent(id, ativo) {
    await supabase.from('drink_back_agents').update({ ativo: !ativo }).eq('id', id)
    load()
  }

  if (loading) return <Spinner />

  if (!schemaOk) {
    return (
      <div style={{ background: 'var(--amber-bg)', border: '1px solid #fcd34d', borderRadius: 12, padding: 16, fontSize: 13 }}>
        <strong>{t('atomicPos.drinkBackSetup')}</strong>
        <p style={{ margin: '8px 0', color: 'var(--amber)' }}>{t('atomicPos.drinkBackSetupHint')}</p>
      </div>
    )
  }

  return (
    <div className="pos-split">
      <div className="card">
        <SectionTitle>{t('atomicPos.newAgent')}</SectionTitle>
        <label className="form-label">{t('atomicPos.agentName')}</label>
        <input placeholder={t('atomicPos.agentName')} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
        <div className="pos-form-pair">
          <div>
            <label className="form-label">{t('atomicPos.region')}</label>
            <input placeholder={t('atomicPos.region')} value={form.regiao} onChange={e => setForm({ ...form, regiao: e.target.value })} style={{ width: '100%' }} />
          </div>
          <div>
            <label className="form-label">{t('atomicPos.commissionPct')}</label>
            <input type="number" inputMode="decimal" placeholder={t('atomicPos.commissionPct')} value={form.comissao_pct} onChange={e => setForm({ ...form, comissao_pct: e.target.value })} style={{ width: '100%' }} />
          </div>
        </div>
        <button className="btn-primary" onClick={saveAgent} disabled={saving} style={{ width: '100%', padding: 12 }}>
          {saving ? t('common.saving') : t('atomicPos.addAgent')}
        </button>
      </div>
      <div>
        {agents.length === 0 ? (
          <div style={{ color: 'var(--text3)', fontSize: 13 }}>{t('atomicPos.noAgents')}</div>
        ) : agents.map(a => (
          <div key={a.id} className="card" style={{ marginBottom: 8, padding: 14, opacity: a.ativo ? 1 : 0.5 }}>
            <div className="pos-list-row">
              <div className="pos-list-main">
                <div style={{ fontWeight: 700 }}>{a.nome}</div>
                <div className="pos-list-meta">
                  {a.regiao || '—'} · {t('atomicPos.commissionShort', { pct: a.comissao_pct })}
                </div>
              </div>
              <button type="button" className="pos-mini-btn" onClick={() => toggleAgent(a.id, a.ativo)}>
                {a.ativo ? t('atomicPos.deactivate') : t('atomicPos.activate')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── MAIN PANEL ────────────────────────────────────────────────────────────────
export default function AtomicPosPanel({ bar, onOrder, access = 'owner' }) {
  const { t } = useI18n()
  const [subTab, setSubTab] = useState(access === 'cashier' ? 'checkout' : 'dashboard')
  const tabs = access === 'cashier' ? SUB_TAB_IDS.filter(t => t.id === 'checkout') : SUB_TAB_IDS
  const [ready, setReady] = useState(null)
  const [drinks, setDrinks] = useState([])
  const [shots, setShots] = useState([])
  const [discountCodes, setDiscountCodes] = useState([])
  const [vipMembers, setVipMembers] = useState([])
  const [drinkBackAgents, setDrinkBackAgents] = useState([])
  const [team, setTeam] = useState(null) // people who can be marked on a sale (staff + agents); null = agents only
  const [todaySales, setTodaySales] = useState({ count: 0, total: 0 })
  const [salesList, setSalesList] = useState([])
  const [posErr, setPosErr] = useState('')
  const [catalogErr, setCatalogErr] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { init() }, [bar])
  useEffect(() => {
    let live = true
    fetchCastRoster().then(people => { if (live) setTeam(people) })
    return () => { live = false }
  }, [bar])
  const castPeople = useMemo(() => (team ? (team.length ? team : castRoster([], drinkBackAgents)) : null), [team, drinkBackAgents])

  async function init({ quiet = false } = {}) {
    // A refresh after a sale keeps the till on screen; only the first load shows the spinner.
    if (!quiet) setLoading(true)
    // The sale was written by an RPC the live-store cache does not see: read tonight's sales fresh.
    forgetLiveSelects('pos_vendas')
    const nightKey = tokyoNightKey()
    const from = prevTokyoDateKey(nightKey)
    const salesSelect = 'id,bar_id,subtotal,desconto_total,tipo,space_id,guest_id,comissao_valor,total,refunded,card_fee,card_fee_reversed,criado_em,data,metodo_pagamento,obs,drink_back_agent_id'
    const [schema, dR, sR, cR, vR, salesFirst, aR] = await Promise.all([
      checkPosSchema(supabase),
      supabase.from('drink_menu').select('*').eq('bar_id', bar.id).order('nome'),
      supabase.from('bar_pricing').select('*, produtos(nome,categoria,preco_venda,volume_ml,custo)').eq('bar_id', bar.id),
      supabase.from('discount_codes').select('*').eq('bar_id', bar.id).eq('ativo', true),
      supabase.from('vip_members').select('*').eq('bar_id', bar.id).eq('ativo', true),
      supabase.from('pos_vendas').select(salesSelect).eq('bar_id', bar.id).gte('data', from).order('criado_em'),
      supabase.from('drink_back_agents').select('*').eq('bar_id', bar.id).eq('ativo', true),
    ])
    let pR = salesFirst
    if (pR.error && /refunded|card_fee/.test(pR.error.message || '')) {
      pR = await supabase.from('pos_vendas').select('id,bar_id,total,criado_em,data,metodo_pagamento,obs,drink_back_agent_id').eq('bar_id', bar.id).gte('data', from).order('criado_em')
    }
    setReady(schema.ready)
    if (dR.error) setPosErr(dR.error.message || t('atomicPos.tillLoadError'))
    else if (sR.error) setPosErr(sR.error.message || t('atomicPos.tillLoadError'))
    setCatalogErr(dR.error?.message || sR.error?.message || '')
    setDrinks(dR.error ? [] : (dR.data || []))
    setShots(sR.error ? [] : (sR.data || []))
    setDiscountCodes(cR.data || [])
    setVipMembers(vR.data || [])
    setDrinkBackAgents(aR.data || [])
    if (pR.error) {
      setPosErr(pR.error.message || t('atomicPos.tillLoadError'))
      setSalesList([])
      setTodaySales({ count: 0, total: 0 })
    } else {
      if (!dR.error && !sR.error) setPosErr('')
      const night = summarizeNight(pR.data || [], nightKey)
      setSalesList((pR.data || []).filter(s => saleOnNight(s, nightKey)))
      setTodaySales({ count: night.ticketCount, total: night.drinksTotal })
    }
    setLoading(false)
  }

  if (loading) return <Spinner text={t('atomicPos.loading')} />

  return (
    <div className={`fade-in pos-shell${access === 'cashier' ? ' pos-kiosk' : ''}`}>
      <SetupBanner onRefresh={init} />

      {access !== 'cashier' && (
      <div className="pos-head">
        <div>
          <div className="pos-head-title">{access === 'cashier' ? t('atomicPos.tillTitle') : t('atomicPos.title')}</div>
          <div className="pos-head-sub">{access === 'cashier' ? t('atomicPos.tillSubtitle') : t('atomicPos.subtitle')}</div>
          <div className="pos-head-bar">{t('atomicPos.thisTill', { name: bar.nome || 'Atomic' })}</div>
          {access === 'cashier' && (
            <div className="pos-head-only">{t('atomicPos.tillOnly')}</div>
          )}
        </div>
        <div className="pos-head-today">
          <div className="pos-head-label">{t('atomicPos.tillTonight')}</div>
          <div className="pos-head-total">{fmtYen(todaySales.total)}</div>
          <div className="pos-head-count">{posErr ? t('atomicPos.tillLoadError') : t('atomicPos.salesCount', { count: todaySales.count })}</div>
        </div>
      </div>
      )}

      {tabs.length > 1 && (
        <div className="pos-subnav">
          {tabs.map(tab => (
            <button key={tab.id} className={`pos-chip${subTab === tab.id ? ' is-on' : ''}`} onClick={() => setSubTab(tab.id)}>
              <Icon name={tab.icon} size={15} /> {t(`atomicPos.${tab.key}`)}
            </button>
          ))}
        </div>
      )}

      {subTab === 'dashboard' && (
        <PosDashboardTab bar={bar} todaySales={todaySales} salesList={salesList} onOrder={onOrder} onVoided={() => init({ quiet: true })} />
      )}

      {!ready && subTab === 'checkout' && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text2)' }}>
          {t('atomicPos.setupHint')}
        </div>
      )}

      {(ready || subTab !== 'checkout') && subTab !== 'dashboard' && (
        <>
          {subTab === 'checkout' && ready && (
            <>
              <PosQuick
                bar={bar}
                drinks={drinks}
                shots={shots}
                agents={drinkBackAgents}
                castPeople={castPeople}
                discountCodes={discountCodes}
                todaySales={todaySales}
                catalogError={catalogErr}
                onSale={() => init({ quiet: true })}
              />
            </>
          )}
          {subTab === 'vip' && <PosVipTab bar={bar} drinks={drinks} onUpdate={init} />}
          {subTab === 'drinkback' && <PosDrinkBackTab bar={bar} onUpdate={init} />}
          {subTab === 'prices' && <PosPricesTab bar={bar} drinks={drinks} onRefresh={init} />}
          {subTab === 'discounts' && <PosDiscountTab bar={bar} drinks={drinks} onUpdate={init} />}
        </>
      )}
    </div>
  )
}
