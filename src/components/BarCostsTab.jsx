import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './Auth'
import { fmtYen, Spinner } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { filterSupplierVendas } from './utils'
import { filterJbmDrinksFaturas } from '../lib/barPortal'
import { monthlyAccountSummary } from '../lib/clientAnalytics'
import { tokyoMonthKey, recentMonthKeys, isMonthKey } from '../lib/tokyo'
import { compactYen, monthChipHint, matchHqSearch, matchInvoiceStatus } from '../lib/hqFilters'
import { payrollFromPunches, monthRange, localHoursPay } from '../lib/timeClock'
import { splitCostBooks } from '../lib/costBooks'
import { costAccessForRole } from '../lib/access'
import { fetchHqSnapshot, saveHqRent } from '../lib/hqSnapshot'
import { useI18n } from '../lib/i18n'
import HqAiDock from './HqAiDock'
import BarOpsGlance from './BarOpsGlance'
import { buildBarOpsGlance } from '../lib/barOpsGlance'
import { birthdayThisMonth, decorateSpaces } from '../lib/barCrm'

const ACTIONS = [
  { id: 'pos', icon: '🧾', labelKey: 'portal.home.goPos', hintKey: 'portal.home.goPosHint' },
  { id: 'pedidos', icon: '🛒', labelKey: 'portal.home.goOrders', hintKey: 'portal.home.goOrdersHint' },
  { id: 'espacos', icon: '🪑', labelKey: 'portal.home.goFloor', hintKey: 'portal.home.goFloorHint' },
  { id: 'clientes', icon: '🥂', labelKey: 'portal.home.goGuests', hintKey: 'portal.home.goGuestsHint' },
  { id: 'ponto', icon: '🕒', labelKey: 'portal.home.goClock', hintKey: 'portal.home.goClockHint' },
  { id: 'custos', icon: '🏛️', labelKey: 'portal.home.goHq', hintKey: 'portal.home.goHqHint' },
  { id: 'equipe', icon: '👥', labelKey: 'nav.portalTeam' },
  { id: 'estoque', icon: '📊', labelKey: 'nav.portalInventory' },
  { id: 'faturas', icon: '💳', labelKey: 'nav.portalInvoices' },
]

function BookCard({ kicker, value, hint, tone = 'navy', active, onClick }) {
  const tones = {
    navy: { bg: 'linear-gradient(135deg, var(--navy) 0%, #002855 100%)', color: 'white', hint: 'rgba(255,255,255,0.75)', border: 'none' },
    light: { bg: 'var(--bg2)', color: 'var(--navy)', hint: 'var(--text2)', border: '1px solid var(--border)' },
    green: { bg: 'var(--bg2)', color: 'var(--green)', hint: 'var(--text2)', border: '1px solid rgba(52,199,89,0.25)' },
    amber: { bg: 'var(--bg2)', color: 'var(--amber)', hint: 'var(--text2)', border: '1px solid rgba(255,159,10,0.28)' },
  }
  const s = tones[tone] || tones.navy
  return (
    <button
      type="button"
      onClick={onClick}
      className={`hq-book${active ? ' is-on' : ''}`}
      style={{ background: s.bg, color: s.color, border: s.border }}
    >
      <div className="easy-dash-kicker">{kicker}</div>
      <div className="easy-dash-value" style={{ marginTop: 8 }}>{value}</div>
      {hint && <div className="easy-dash-hint" style={{ color: s.hint }}>{hint}</div>}
    </button>
  )
}

export function CostBooksHero({ books, access, selected = 'all', onSelect }) {
  const { t } = useI18n()
  const pick = id => onSelect?.(selected === id ? 'all' : id)
  return (
    <div className="hq-books-wrap">
      <div className="hq-books-kicker">{t('portal.costs.neverMix')}</div>
      <div className="hq-books">
        {access.posTill && (
          <BookCard kicker={t('portal.costs.posTill')} value={fmtYen(books.pos.amount)} hint={t('portal.costs.posTillHint')} tone="light" active={selected === 'pos'} onClick={() => pick('pos')} />
        )}
        {access.jbmBill && (
          <BookCard kicker={t('portal.costs.jbmBill')} value={fmtYen(books.jbm.amount)} hint={t('portal.costs.jbmBillHint')} tone="navy" active={selected === 'jbm'} onClick={() => pick('jbm')} />
        )}
        {access.staffWages && (
          <BookCard kicker={t('portal.costs.staffWages')} value={fmtYen(books.staff.amount)} hint={t('portal.costs.staffWagesHint')} tone="green" active={selected === 'staff'} onClick={() => pick('staff')} />
        )}
        {access.rent && books.rent && (
          <BookCard kicker={t('portal.costs.rent')} value={fmtYen(books.rent.amount)} hint={t('portal.costs.rentHint')} tone="amber" active={selected === 'rent'} onClick={() => pick('rent')} />
        )}
      </div>
    </div>
  )
}

export function BarCommandActions({ onTab, ids }) {
  const { t } = useI18n()
  const list = ids ? ACTIONS.filter(a => ids.includes(a.id)) : ACTIONS
  return (
    <div className="hq-actions" style={{ '--hq-cols': list.length }}>
      {list.map(a => (
        <button key={a.id} type="button" className="hq-action" data-hq-action={a.id} onClick={() => onTab?.(a.id)}>
          <span className="hq-action-icon">{a.icon}</span>
          <span>{t(a.labelKey)}</span>
          {a.hintKey && <span className="hq-action-hint">{t(a.hintKey)}</span>}
        </button>
      ))}
    </div>
  )
}

export async function loadCostBooks(barId, monthKey) {
  const mes = isMonthKey(monthKey) ? monthKey : tokyoMonthKey()
  try {
    const hq = await fetchHqSnapshot(mes)
    if (hq?.books) return hq.books
  } catch {
    // fall through
  }
  const range = monthRange(`${mes}-01`)
  const [vR, fR, posR, clockR, teamR, rentR] = await Promise.all([
    supabase.from('vendas').select('*').eq('bar_id', barId),
    supabase.from('faturas').select('*').eq('bar_id', barId),
    supabase.from('pos_vendas').select('total,data').eq('bar_id', barId),
    staffFetch(`/api/time-clock?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`).then(r => r.json()).catch(() => ({ punches: [] })),
    staffFetch('/api/bar-staff').then(r => r.json()).catch(() => ({ staff: [] })),
    supabase.from('bar_overhead').select('kind,month_key,amount').eq('bar_id', barId).eq('kind', 'rent').eq('month_key', mes),
  ])
  const vendas = filterSupplierVendas(vR.data || [])
  const faturas = filterJbmDrinksFaturas(fR.data || [])
  const account = monthlyAccountSummary(vendas, faturas, mes)
  const posMonthTotal = (posR.data || [])
    .filter(s => String(s.data || '').startsWith(mes))
    .reduce((a, s) => a + (+s.total || 0), 0)
  const payroll = payrollFromPunches(clockR.punches || [], teamR.staff || [], range)
  const staffMonthPay = payroll.reduce((a, r) => a + (+r.pay || 0), 0)
  const rentMonth = (rentR.data || []).reduce((a, r) => a + (+r.amount || 0), 0)
  return splitCostBooks({ posMonthTotal, jbmMonthBill: account.contaMes, staffMonthPay, rentMonth })
}

function HoursCalculator() {
  const { t } = useI18n()
  const [hours, setHours] = useState('8')
  const [lateHours, setLateHours] = useState('2')
  const [rate, setRate] = useState('1500')
  const result = localHoursPay({ hours, lateHours, rate })
  return (
    <div className="hq-panel">
      <div className="hq-panel-title">{t('portal.hq.calcTitle')}</div>
      <div className="hq-panel-hint">{t('portal.hq.hoursHint')}</div>
      <div className="hq-calc-grid">
        <label>{t('portal.hq.calcHours')}<input type="number" min="0" step="0.25" value={hours} onChange={e => setHours(e.target.value)} /></label>
        <label>{t('portal.hq.calcLate')}<input type="number" min="0" step="0.25" value={lateHours} onChange={e => setLateHours(e.target.value)} /></label>
        <label>{t('portal.hq.calcRate')}<input type="number" min="0" step="50" value={rate} onChange={e => setRate(e.target.value)} /></label>
      </div>
      <div className="hq-calc-pay">{t('portal.hq.calcPay')}: {fmtYen(result.pay)}</div>
    </div>
  )
}

export default function BarCostsTab({ bar, onTab }) {
  const { perfil } = useAuth()
  const { t, lang } = useI18n()
  const access = costAccessForRole(perfil?.role)
  const [month, setMonth] = useState(tokyoMonthKey())
  const [book, setBook] = useState('all')
  const [jbmView, setJbmView] = useState('notes')
  const [invoiceStatus, setInvoiceStatus] = useState('pending')
  const [query, setQuery] = useState('')
  const [staffFilter, setStaffFilter] = useState('all')
  const [hq, setHq] = useState(null)
  const [books, setBooks] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [rentAmount, setRentAmount] = useState('')
  const [rentNote, setRentNote] = useState('')
  const [rentMsg, setRentMsg] = useState('')
  const [floorGlance, setFloorGlance] = useState(null)
  const [localOps, setLocalOps] = useState({ invoices: [], openOrders: 0 })

  async function load(force = false, mes = month) {
    setErr('')
    try {
      const snap = force
        ? await staffFetch('/api/bar/hq-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ month: mes }),
        }).then(async r => {
          const j = await r.json()
          if (!r.ok) throw new Error(j.error || 'Sync failed')
          return j
        })
        : await fetchHqSnapshot(mes)
      setHq(snap)
      setBooks(snap.books)
      setRentAmount(String(snap.rent?.amount ?? ''))
      setRentNote(snap.rent?.note || '')
    } catch (e) {
      try {
        const fallback = await loadCostBooks(bar.id, mes)
        setBooks(fallback)
        setErr(e.message)
      } catch (e2) {
        setErr(e2.message)
      }
    }
  }

  useEffect(() => {
    let cancelled = false
    load(false, month).catch(e => { if (!cancelled) setErr(e.message) })
    return () => { cancelled = true }
  }, [bar.id, month])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('bar_spaces').select('id,ativo,ordem,tipo,zona').eq('bar_id', bar.id).eq('ativo', true),
      supabase.from('bar_visits').select('id,space_id,status,guest_id').eq('bar_id', bar.id).in('status', ['seated', 'reserved']),
      supabase.from('bar_guests').select('id,nome,aniversario,ativo').eq('bar_id', bar.id).eq('ativo', true),
      supabase.from('faturas').select('*').eq('bar_id', bar.id),
      supabase.from('pedidos').select('id,status').eq('bar_id', bar.id),
    ]).then(([spR, viR, guR, fR, pR]) => {
      if (cancelled) return
      if (!spR.error) {
        const floor = decorateSpaces(spR.data || [], viR.data || [])
        setFloorGlance({
          seated: floor.filter(s => s.occupied).length,
          reserved: floor.filter(s => s.reserved).length,
          free: floor.filter(s => !s.occupied && !s.reserved).length,
          birthdays: birthdayThisMonth(guR.data || []).length,
        })
      }
      setLocalOps({
        invoices: filterJbmDrinksFaturas(fR.error ? [] : (fR.data || [])),
        openOrders: (pR.error ? [] : (pR.data || [])).filter(p => p.status === 'pendente' || p.status === 'confirmado').length,
      })
    }).catch(() => { if (!cancelled) setFloorGlance(null) })
    return () => { cancelled = true }
  }, [bar.id])

  async function syncNow() {
    setBusy(true)
    await load(true, month)
    setBusy(false)
  }

  async function copyLastRent() {
    const last = hq?.rent?.last
    if (!last) return
    setRentAmount(String(last.amount))
    setRentNote(last.note || '')
    setRentMsg('')
    setBusy(true)
    try {
      const snap = await saveHqRent({ amount: last.amount, note: last.note, month_key: month })
      setHq(snap)
      setBooks(snap.books)
      setRentMsg(t('common.success'))
    } catch (e) {
      setRentMsg(e.message)
    }
    setBusy(false)
  }

  async function saveRent() {
    setRentMsg('')
    setBusy(true)
    try {
      const snap = await saveHqRent({ amount: rentAmount, note: rentNote, month_key: month })
      setHq(snap)
      setBooks(snap.books)
      setRentMsg(t('common.success'))
    } catch (e) {
      setRentMsg(e.message)
    }
    setBusy(false)
  }

  const payroll = (hq?.payroll || []).filter(r => staffFilter === 'all' || r.staff_id === staffFilter)
  const months = (hq?.months?.length ? hq.months.map(m => m.key) : recentMonthKeys(6))
  const monthMeta = key => (hq?.months || []).find(m => m.key === key) || { key, pos: 0, jbm: 0, pedidos: 0 }
  const monthLabel = d => {
    const [y, m] = String(d).split('-')
    const names = t('months.short') || []
    return `${names[+m - 1] || m} ${y}`
  }
  const show = id => book === 'all' || book === id
  const loading = !books && !err
  const emptyBook = book !== 'all'
    && !(books?.[book]?.amount)
    && !(book === 'jbm' && (hq?.jbm?.totalPendente || hq?.jbm?.pedidosMes || hq?.jbm?.entregasMes))
    && !(book === 'pos' && hq?.pos?.salesCount)
    && !(book === 'staff' && (hq?.hoursTotal || hq?.payroll?.length))
  const q = query.trim()
  const notes = (hq?.jbm?.notesMes || []).filter(r => matchHqSearch(r, q))
  const orders = (hq?.jbm?.pedidosRecentes || []).filter(r => matchHqSearch(r, q))
  const invoices = (hq?.jbm?.faturasResumo || []).filter(f => matchInvoiceStatus(f, invoiceStatus, month) && matchHqSearch(f, q))
  const tickets = (hq?.pos?.tickets || []).filter(r => matchHqSearch(r, q))

  return (
    <div className="fade-in portal-page hq-dash">
      <div className="hq-top">
        <div>
          <div className="hq-title">{t('portal.costs.title')}</div>
          <div className="hq-sub">{t('portal.costs.subtitle')}</div>
        </div>
        <button type="button" onClick={syncNow} disabled={busy} className="btn-primary hq-sync">
          {busy ? t('common.wait') : `🔄 ${t('portal.hq.syncNow')}`}
        </button>
      </div>
      {err && <div style={{ color: 'var(--red)', marginBottom: 12 }}>{err}</div>}

      <BarOpsGlance
        glance={buildBarOpsGlance({
          hq,
          books,
          floor: floorGlance,
          openOrders: localOps.openOrders,
          invoices: localOps.invoices,
          ready: !!(hq || books),
        })}
        onTab={onTab}
      />

      <div className="hq-filters">
        <div className="hq-filter-group">
          <span className="hq-filter-label">{t('portal.hq.filterMonth')}</span>
          {months.map(m => {
            const meta = monthMeta(m)
            const hint = monthChipHint(meta)
            return (
              <button key={m} type="button" className={`hq-chip hq-chip-stack${month === m ? ' is-on' : ''}`} onClick={() => setMonth(m)}>
                <span>{monthLabel(m)}</span>
                <span className="hq-chip-amt">
                  {hint.kind === 'jbm' ? compactYen(hint.amount)
                    : hint.kind === 'pos' ? compactYen(hint.amount)
                    : hint.kind === 'orders' ? t('portal.hq.ordersCount', { count: hint.pedidos })
                    : '—'}
                </span>
              </button>
            )
          })}
        </div>
        <div className="hq-filter-group">
          <span className="hq-filter-label">{t('portal.hq.filterBook')}</span>
          {[
            ['all', t('portal.hq.bookAll'), true],
            ['pos', t('portal.costs.posTill'), access.posTill],
            ['jbm', t('portal.costs.jbmBill'), access.jbmBill],
            ['staff', t('portal.costs.staffWages'), access.staffWages],
            ['rent', t('portal.costs.rent'), access.rent],
          ].filter(row => row[2]).map(([id, label]) => (
            <button key={id} type="button" className={`hq-chip${book === id ? ' is-on' : ''}`} onClick={() => setBook(id)}>{label}</button>
          ))}
        </div>
        {(book === 'all' || book === 'jbm') && (
          <div className="hq-filter-group">
            <span className="hq-filter-label">{t('portal.hq.filterJbmView')}</span>
            {[
              ['notes', t('portal.hq.viewNotes')],
              ['invoices', t('portal.hq.viewInvoices')],
              ['orders', t('portal.hq.viewOrders')],
            ].map(([id, label]) => (
              <button key={id} type="button" className={`hq-chip${jbmView === id ? ' is-on' : ''}`} onClick={() => { setBook('jbm'); setJbmView(id) }}>{label}</button>
            ))}
            {jbmView === 'invoices' && ['pending', 'month', 'overdue', 'all'].map(id => (
              <button key={id} type="button" className={`hq-chip${invoiceStatus === id ? ' is-on' : ''}`} onClick={() => setInvoiceStatus(id)}>
                {id === 'all' ? t('portal.hq.statusAll') : id === 'pending' ? t('portal.hq.statusPending') : id === 'month' ? t('portal.hq.statusMonth') : t('portal.hq.statusOverdue')}
              </button>
            ))}
          </div>
        )}
        <div className="hq-filter-group">
          <input
            className="hq-search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('portal.hq.search')}
          />
        </div>
        <div className="hq-panel-hint" style={{ margin: '4px 0 0' }}>{t('portal.hq.monthHint')}</div>
      </div>

      <div className="hq-actions-label">{t('portal.hq.actionsTitle')}</div>
      <BarCommandActions onTab={onTab} />

      {hq?.sources && (
        <div className="hq-sources">
          <span className={`hq-src${hq.sources.pos?.ok ? ' ok' : ' bad'}`}>● {t('portal.hq.sourcePos')} · {t('portal.hq.ticketsCount', { count: hq.sources.pos?.sales || 0 })}</span>
          <span className={`hq-src${hq.sources.jbm?.ok ? ' ok' : ' bad'}`}>● {t('portal.hq.sourceJbm')} · {t('portal.hq.notesCount', { count: hq.sources.jbm?.vendasMes || 0 })} / {t('portal.hq.ordersCount', { count: hq.sources.jbm?.pedidosMes || 0 })}</span>
          <span className={`hq-src${hq.sources.clock?.ok ? ' ok' : ' bad'}`}>● {t('portal.hq.sourceClock')} · {hq.hoursTotal || 0}h</span>
          <span className={`hq-src${hq.sources.rent?.ok ? ' ok' : ' bad'}`}>● {t('portal.hq.sourceRent')}</span>
          {hq.sources.inventory && (
            <span className={`hq-src${hq.sources.inventory?.ok ? ' ok' : ' bad'}`}>● {t('portal.hq.sourceStock')} · {t('portal.hq.lowCount', { count: hq.sources.inventory?.low || 0 })}</span>
          )}
          {hq.syncedAt && <span className="hq-src muted">{t('portal.hq.synced', { time: new Date(hq.syncedAt).toLocaleString(lang === 'ja' ? 'ja-JP' : 'en-US') })}</span>}
        </div>
      )}

      {loading && <Spinner text={t('portal.costs.loading')} />}
      {books && <CostBooksHero books={books} access={access} selected={book} onSelect={setBook} />}

      {books && emptyBook && (
        <div className="hq-empty" style={{ marginBottom: 12 }}>{t('portal.hq.emptyMonth')}</div>
      )}

      <div className="hq-layout">
        <div>
          {show('staff') && (
            <div className="hq-panel">
              <div className="hq-panel-row">
                <div>
                  <div className="hq-panel-title">{t('portal.hq.hoursTitle')}</div>
                  <div className="hq-panel-hint">{t('portal.hq.hoursHint')}</div>
                </div>
                <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)}>
                  <option value="all">{t('portal.hq.staffAll')}</option>
                  {(hq?.payroll || []).map(r => <option key={r.staff_id} value={r.staff_id}>{r.nome}</option>)}
                </select>
              </div>
              {!payroll.length ? (
                <div className="hq-empty">{t('portal.hq.noPunches')}</div>
              ) : (
                <div className="table-scroll">
                  <table style={{ width: '100%', fontSize: 13 }}>
                    <thead>
                      <tr>{[t('clock.colName'), t('clock.colHours'), t('portal.hq.colLate'), t('clock.colPay')].map(h => <th key={h} style={{ textAlign: 'left', padding: 8 }}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {payroll.map(r => (
                        <tr key={r.staff_id} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: 8, fontWeight: 700 }}>{r.nome}<div style={{ fontSize: 11, color: 'var(--text2)' }}>{r.cargo} · {fmtYen(r.salario_hora)}/h</div></td>
                          <td>{Number(r.hours || 0).toFixed(2)}h</td>
                          <td>{Number(r.lateHours || 0).toFixed(2)}h</td>
                          <td style={{ fontWeight: 800 }}>{fmtYen(r.pay)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {show('staff') && <HoursCalculator />}
          {show('rent') && access.rent && (
            <div className="hq-panel">
              <div className="hq-panel-title">{t('portal.hq.rentTitle')}</div>
              <div className="hq-panel-hint">{t('portal.costs.rentHint')}</div>
              {!hq?.rent?.amount && hq?.rent?.last && (
                <div className="hq-empty">
                  {t('portal.hq.rentMissing', { month: monthLabel(month) })} {t('portal.hq.rentLast', { month: monthLabel(hq.rent.last.month_key), amount: fmtYen(hq.rent.last.amount) })}
                </div>
              )}
              <div className="hq-rent-row">
                <label>{t('portal.hq.rentAmount')}<input type="number" min="0" step="1000" value={rentAmount} onChange={e => setRentAmount(e.target.value)} /></label>
                <label>{t('common.notes')}<input value={rentNote} onChange={e => setRentNote(e.target.value)} /></label>
                <button type="button" className="btn-primary" disabled={busy} onClick={saveRent}>{t('portal.hq.rentSave')}</button>
              </div>
              {hq?.rent?.last && !hq?.rent?.amount && (
                <button type="button" className="hq-chip" style={{ marginTop: 10 }} disabled={busy} onClick={copyLastRent}>{t('portal.hq.rentCopy')}</button>
              )}
              {rentMsg && <div style={{ marginTop: 10, fontSize: 12, color: rentMsg === t('common.success') ? 'var(--green)' : 'var(--red)' }}>{rentMsg}</div>}
            </div>
          )}
          {show('jbm') && hq?.jbm && (
            <div className="hq-panel">
              <div className="hq-panel-title">{t('portal.hq.sourceJbm')} · {monthLabel(month)}</div>
              <div className="hq-kpis">
                <div><b>{fmtYen(hq.jbm.comprasMes)}</b><span>{t('portal.hq.viewNotes')}</span></div>
                <div><b>{fmtYen(hq.jbm.totalPendente)}</b><span>{t('portal.hq.openAr')}</span></div>
                <div><b>{hq.jbm.pedidosMes || 0}</b><span>{t('portal.hq.viewOrders')}</span></div>
              </div>
              {hq.jbm.gap?.kind === 'orders-other-date' && (
                <div className="hq-gap">{t('portal.hq.ordersOtherDate', { count: hq.jbm.gap.orderCount, month: monthLabel(month), amount: fmtYen(hq.jbm.gap.orderAmount), bill: fmtYen(hq.jbm.comprasMes) })}</div>
              )}
              <div className="hq-panel-hint">{t('portal.hq.openInvoicesHint')}</div>
              {!!hq.jbm.estoqueBaixo?.length && (
                <div className="hq-empty">{t('portal.hq.lowStock')}: {hq.jbm.estoqueBaixo.map(e => `${e.nome || e.id} ${e.qtd}/${e.minimo}`).join(' · ')}</div>
              )}
              {jbmView === 'notes' && (
                notes.length ? (
                  <div className="table-scroll">
                    <table style={{ width: '100%', fontSize: 13 }}>
                      <thead><tr><th>{t('portal.hq.colDate')}</th><th>{t('portal.hq.colNote')}</th><th></th></tr></thead>
                      <tbody>
                        {notes.map(n => (
                          <tr key={n.id} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={{ padding: 8 }}>{n.data}</td>
                            <td>{n.obs || '—'}</td>
                            <td style={{ fontWeight: 800 }}>{fmtYen(n.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="hq-empty">{t('portal.hq.emptyNotes')}</div>
              )}
              {jbmView === 'orders' && (
                orders.length ? (
                  <div className="table-scroll">
                    <table style={{ width: '100%', fontSize: 13 }}>
                      <thead><tr><th>{t('portal.hq.colDate')}</th><th>{t('portal.hq.colNote')}</th><th></th></tr></thead>
                      <tbody>
                        {orders.map(n => (
                          <tr key={n.id || n.criado + n.total} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={{ padding: 8 }}>{n.criado}</td>
                            <td>{n.status} · {n.obs || '—'}</td>
                            <td style={{ fontWeight: 800 }}>{fmtYen(n.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="hq-empty">{t('portal.hq.emptyOrders')}</div>
              )}
              {jbmView === 'invoices' && (
                invoices.length ? (
                  <div className="table-scroll">
                    <table style={{ width: '100%', fontSize: 13 }}>
                      <thead><tr><th>{t('portal.hq.colDate')}</th><th>{t('portal.hq.colNote')}</th><th></th></tr></thead>
                      <tbody>
                        {invoices.map((n, i) => (
                          <tr key={n.vencimento + i} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={{ padding: 8 }}>{n.vencimento}<div style={{ fontSize: 11, color: 'var(--text2)' }}>{n.periodo}</div></td>
                            <td>{n.status}{n.inMonth ? ` · ${t('portal.hq.inThisMonth')}` : ` · ${t('portal.hq.otherMonth')}`}</td>
                            <td style={{ fontWeight: 800 }}>{fmtYen(n.remain ?? n.total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <div className="hq-empty">{invoiceStatus === 'month' ? t('portal.hq.emptyInvoicesMonth') : t('portal.hq.openInvoicesHint')}</div>
              )}
              <button type="button" className="hq-chip" style={{ marginTop: 10 }} onClick={() => onTab?.(jbmView === 'orders' ? 'pedidos' : 'faturas')}>{jbmView === 'orders' ? t('portal.hq.linkOrders') : t('portal.hq.linkJbm')}</button>
            </div>
          )}
          {show('pos') && hq?.pos && (
            <div className="hq-panel">
              <div className="hq-panel-title">{t('portal.costs.posTill')} · {monthLabel(month)}</div>
              <div className="hq-kpis">
                <div><b>{fmtYen(hq.pos.till)}</b><span>{t('portal.hq.filterMonth')}</span></div>
                <div><b>{hq.pos.salesCount || 0}</b><span>{t('atomicPos.tabCheckout')}</span></div>
              </div>
              {tickets.length ? (
                <div className="table-scroll">
                  <table style={{ width: '100%', fontSize: 13 }}>
                    <thead><tr><th>{t('portal.hq.colDate')}</th><th>{t('portal.hq.colNote')}</th><th></th></tr></thead>
                    <tbody>
                      {tickets.map((n, i) => (
                        <tr key={(n.data || '') + i} style={{ borderTop: '1px solid var(--border)' }}>
                          <td style={{ padding: 8 }}>{n.data}</td>
                          <td>{n.obs || '—'}</td>
                          <td style={{ fontWeight: 800 }}>{fmtYen(n.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="hq-empty">{t('portal.hq.emptyTickets')}</div>}
              <button type="button" className="hq-chip" style={{ marginTop: 10 }} onClick={() => onTab?.('pos')}>{t('portal.hq.linkPos')}</button>
            </div>
          )}
        </div>
        <HqAiDock snapshot={hq} />
      </div>
    </div>
  )
}
