/** Bar-ops KPIs for HQ and Home. Never add the four books into one number. */

import { tokyoDateKey, tokyoNightKey } from './tokyo.js'
import { faturaRemaining } from './barPortal.js'
import { lastBusyNight, prevTokyoDateKey, saleOnNight } from './nightClose.js'

/** POS tonight uses nightlife 06:00–05:59, not civil midnight. */
export function posTodayFromTickets(tickets = [], nightKey = tokyoNightKey()) {
  return (tickets || []).filter(s => saleOnNight(s, nightKey)).reduce((a, s) => a + (+s.total || 0), 0)
}

export function posTodayCount(tickets = [], nightKey = tokyoNightKey()) {
  return (tickets || []).filter(s => saleOnNight(s, nightKey)).length
}

export function posLastNightFromTickets(tickets = [], nightKey = tokyoNightKey()) {
  return posTodayFromTickets(tickets, prevTokyoDateKey(nightKey))
}

function invoiceGlance(invoices = [], today) {
  const pending = (invoices || []).filter(f => f.status !== 'pago' && faturaRemaining(f) > 0)
  const overdue = pending.filter(f => {
    const venc = String(f.data_vencimento || f.periodo_fim || '').slice(0, 10)
    return venc && venc < today
  })
  return {
    openAr: pending.reduce((a, f) => a + faturaRemaining(f), 0),
    overdue: overdue.length,
    pendingInvoices: pending.length,
  }
}

export function buildBarOpsGlance({
  hq = null,
  books = null,
  floor = null,
  openOrders = 0,
  posTickets = null,
  posMonthFallback = null,
  account = null,
  invoices = null,
  today = tokyoDateKey(),
  nightKey = tokyoNightKey(),
  ready = true,
} = {}) {
  const ledgers = hq?.books || books || {}
  const jbm = hq?.jbm || {}
  const tickets = posTickets || hq?.pos?.tickets || []
  const posToday = posTodayFromTickets(tickets, nightKey)
  const tonightCount = posTodayCount(tickets, nightKey)
  const lastNightKey = prevTokyoDateKey(nightKey)
  const posLastNight = posTodayFromTickets(tickets, lastNightKey)
  const lastNightCount = posTodayCount(tickets, lastNightKey)
  const busy = lastBusyNight(tickets, nightKey)
  const monthKey = String(today || '').slice(0, 7)
  const monthTicketCount = hq?.pos?.salesCount
    || tickets.filter(s => String(s.data || '').startsWith(monthKey)).length
    || 0
  const fromInvoices = invoiceGlance(invoices, today)
  const hasJbm = jbm && (jbm.totalPendente != null || jbm.faturasPendentes != null || jbm.faturasAtraso != null)
  return {
    ready,
    mixed: false,
    posToday,
    tonightCount,
    posLastNight,
    lastNightCount,
    lastNightKey,
    lastSession: busy.total,
    lastSessionDate: busy.date,
    lastSessionCount: busy.ticketCount,
    posMonth: Math.round(+ledgers.pos?.amount || posMonthFallback || 0),
    posTickets: monthTicketCount,
    jbmBill: Math.round(+ledgers.jbm?.amount || account?.contaMes || 0),
    jbmNotes: jbm.entregasMes || account?.deliveries || 0,
    openAr: Math.round(hasJbm ? +jbm.totalPendente || 0 : fromInvoices.openAr),
    overdue: hasJbm ? (jbm.faturasAtraso || 0) : fromInvoices.overdue,
    pendingInvoices: hasJbm ? (jbm.faturasPendentes || 0) : fromInvoices.pendingInvoices,
    openOrders: +openOrders || 0,
    seated: floor?.seated || 0,
    reserved: floor?.reserved || 0,
    free: floor?.free || 0,
    birthdays: floor?.birthdays || 0,
    hours: hq?.hoursTotal || 0,
    wages: Math.round(+ledgers.staff?.amount || 0),
    rent: Math.round(+ledgers.rent?.amount || 0),
    lowStock: (jbm.estoqueBaixo || []).length || hq?.sources?.inventory?.low || 0,
  }
}

/** Home / HQ KPI bands — 6 + 4 + 3 = 13, each row fills the frame. */
export const OPS_KPI_ROWS = [
  ['posToday', 'posMonth', 'jbm', 'ar', 'pending', 'overdue'],
  ['orders', 'floor', 'stock', 'birthdays'],
  ['hours', 'wages', 'rent'],
]

export function opsGlanceItems(g, t, fmtYen) {
  const floorText = t('portal.home.seatedFree', {
    seated: g.seated,
    reserved: g.reserved,
    free: g.free,
  })
  return [
    {
      id: 'posToday',
      tab: 'pos',
      kicker: t('portal.home.kpiPosToday'),
      value: fmtYen(g.posToday),
      hint: g.posToday > 0
        ? t('portal.home.kpiTickets', { count: g.tonightCount })
        : g.posLastNight > 0
          ? t('portal.home.kpiLastNight', { amount: fmtYen(g.posLastNight) })
          : g.lastSession > 0
            ? t('portal.home.kpiLastSession', { date: g.lastSessionDate, amount: fmtYen(g.lastSession) })
            : g.posMonth > 0
              ? t('portal.home.kpiMonthStill', { amount: fmtYen(g.posMonth) })
              : t('portal.home.kpiTickets', { count: g.tonightCount }),
    },
    {
      id: 'posMonth',
      tab: 'pos',
      kicker: t('portal.home.kpiPosMonth'),
      value: fmtYen(g.posMonth),
      hint: t('portal.home.kpiTickets', { count: g.posTickets }),
    },
    {
      id: 'jbm',
      tab: 'faturas',
      kicker: t('portal.home.kpiJbm'),
      value: fmtYen(g.jbmBill),
      hint: t('portal.home.kpiNotes', { count: g.jbmNotes }),
    },
    { id: 'ar', tab: 'faturas', kicker: t('portal.home.kpiAr'), value: fmtYen(g.openAr), hint: t('portal.home.kpiArHint'), warn: g.openAr > 0 },
    { id: 'pending', tab: 'faturas', kicker: t('portal.home.kpiPending'), value: String(g.pendingInvoices), hint: t('portal.home.kpiArHint'), warn: g.pendingInvoices > 0 },
    { id: 'overdue', tab: 'faturas', kicker: t('portal.home.kpiOverdue'), value: String(g.overdue), hint: t('portal.home.kpiArHint'), warn: g.overdue > 0 },
    { id: 'orders', tab: 'pedidos', kicker: t('portal.home.kpiOrders'), value: String(g.openOrders), warn: g.openOrders > 0 },
    { id: 'floor', tab: 'espacos', kicker: t('portal.home.kpiFloor'), value: `${g.seated}`, hint: floorText },
    { id: 'hours', tab: 'ponto', kicker: t('portal.home.kpiHours'), value: `${g.hours}h` },
    { id: 'wages', tab: 'ponto', kicker: t('portal.home.kpiWages'), value: fmtYen(g.wages) },
    { id: 'rent', tab: 'custos', kicker: t('portal.home.kpiRent'), value: fmtYen(g.rent) },
    { id: 'stock', tab: 'estoque', kicker: t('portal.home.kpiStock'), value: String(g.lowStock), warn: g.lowStock > 0 },
    { id: 'birthdays', tab: 'clientes', kicker: t('portal.home.kpiBirthdays'), value: String(g.birthdays) },
  ]
}
