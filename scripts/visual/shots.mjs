/**
 * Visual and layout check of the redesign with fictional data (no network, no real Supabase).
 *   npm run build && node scripts/visual/shots.mjs [outDir]
 * Serves dist/ with `vite preview`, mocks Supabase REST/RPC/auth and /api, signs in with a fake session,
 * and for each width × theme × page: takes a screenshot, fails on page errors and on horizontal page scroll.
 */
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { ADMIN, MANAGER, OWNER, CASHIER, STAFF, TABLES, BAR_STAFF, PUNCHES } from './fixtures.mjs'
import { castRoster } from '../../src/lib/staffPos.js'
import { earningsByDay, earningsRange, myGoalStatus, myNightSummary } from '../../src/lib/staffNight.js'
import { tokyoNightKey, tokyoMonthKey } from '../../src/lib/tokyo.js'
import { barListRow } from '../../src/lib/barFinanceHq.js'
import { DEFAULT_RULES, addDays, nextWeekOf, scheduleWindow, submissionStatus } from '../../src/lib/staffSchedule.js'
import {
  monthDashboardStats, buildDashboardAlertas, entregasDetalheForMonth, buildDashboardCalendar,
} from '../../api/_dashboardMonth.js'

const OUT = process.argv[2] || 'visual-out'
const PORT = Number(process.env.PORT || 4179)
const SHELL = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [360, 390, 768, 1024, 1280, 1440]
const THEMES = Object.fromEntries(Object.entries({ light: 'modern', dark: 'classic' }).filter(([k]) => !process.env.THEMES || process.env.THEMES.split(',').includes(k)))
const PAGES = [
  { who: ADMIN, path: '/hq/dashboard', name: 'hq-dashboard' },
  { who: ADMIN, path: '/hq/dashboard', name: 'hq-dashboard-rail', rail: true },
  { who: ADMIN, path: '/hq/dashboard', name: 'hq-dashboard-edit', click: /^Customize$/ },
  { who: ADMIN, path: '/hq/crm', name: 'hq-crm' },
  { who: ADMIN, path: '/hq/barFinance', name: 'hq-bar-finance' },
  { who: ADMIN, path: `/hq/barFinance?bar=${TABLES.bars[0].id}`, name: 'hq-bar-finance-bar' },
  { who: ADMIN, path: '/hq/marketing', name: 'hq-marketing' },
  { who: ADMIN, path: '/hq/consultoria', name: 'hq-consulting' },
  { who: ADMIN, path: '/hq/ai', name: 'hq-ai-center' },
  { who: ADMIN, path: '/hq/ai', name: 'hq-ai-attach', click: /^Attach$/ },
  { who: ADMIN, path: '/hq/cashflow', name: 'hq-cashflow', ask: true },
  { who: ADMIN, path: '/hq/faturas', name: 'hq-invoices' },
  { who: ADMIN, path: '/hq/relatorio', name: 'hq-report' },
  { who: ADMIN, path: '/hq/purchases', name: 'hq-purchases' },
  { who: ADMIN, path: '/hq/suppliers', name: 'hq-suppliers' },
  { who: ADMIN, path: '/hq/payroll', name: 'hq-payroll' },
  { who: ADMIN, path: '/hq/products', name: 'hq-products' },
  { who: ADMIN, path: '/hq/procurement', name: 'hq-procurement' },
  { who: ADMIN, path: '/hq/sales', name: 'hq-sales' },
  { who: ADMIN, path: '/hq/bars', name: 'hq-bars' },
  { who: MANAGER, path: '/bar/estoque', name: 'bar-settings-pop', taps: ['.ui-prefs-toggle'] },
  { who: MANAGER, path: '/bar/estoque', name: 'bar-stock' },
  { who: MANAGER, path: '/bar/custos', name: 'bar-costs' },
  { who: MANAGER, path: '/bar/faturas', name: 'bar-invoices' },
  { who: MANAGER, path: '/bar/pagamentos', name: 'bar-payments' },
  { who: MANAGER, path: '/bar/salarios', name: 'bar-salaries' },
  { who: MANAGER, path: '/bar/staff', name: 'bar-staff' },
  { who: MANAGER, path: '/bar/usuarios', name: 'bar-users' },
  { who: MANAGER, path: '/bar/usuarios', name: 'bar-users-edit', click: /^Edit$/ },
  { who: MANAGER, path: '/bar/usuarios', name: 'bar-users-edit-access', click: /^Edit$/, then: /Access$/ },
  { who: MANAGER, path: '/bar/usuarios', name: 'bar-users-new', click: /New login/, taps: ['.bu-person'] },
  { who: MANAGER, path: '/bar/usuarios', name: 'bar-users-new-access', click: /New login/, taps: ['.bu-person'], then: /^Next/ },
  { who: MANAGER, path: '/bar/usuarios', name: 'bar-users-new-signin', click: /New login/, taps: ['.bu-person'], then: [/^Next/, /^Next/] },
  { who: MANAGER, path: '/bar/staff', name: 'bar-staff-new', click: /^Add employee$/ },
  { who: MANAGER, path: '/bar/metas', name: 'bar-goals' },
  { who: MANAGER, path: '/bar/ponto', name: 'bar-clock' },
  { who: MANAGER, path: '/bar/fechamento', name: 'bar-close' },
  { who: MANAGER, path: '/bar/ia', name: 'bar-ai' },
  { who: MANAGER, path: '/bar/aluguel', name: 'bar-rent' },
  { who: MANAGER, path: '/bar/mesas', name: 'bar-floor' },
  { who: MANAGER, path: '/bar/mesas', name: 'bar-floor-edit', edit: true },
  { who: MANAGER, path: '/bar/mesas', name: 'bar-floor-plan', radio: /^Plan$/ },
  { who: MANAGER, path: '/bar/mesas', name: 'bar-floor-3d', radio: /^3D$/ },
  { who: MANAGER, path: '/bar/mesas', name: 'bar-floor-3d-pick', radio: /^3D$/, taps: ['.f3-row'] },
  { who: MANAGER, path: '/bar/mesas', name: 'bar-floor-3d-pov', radio: /^3D$/, click: /^Walk in$/ },
  { who: MANAGER, path: '/bar/mesas', name: 'bar-floor-planonly', missing: ['pos_comandas'] },
  { who: MANAGER, path: '/bar/mesas', name: 'bar-floor-planonly-edit', missing: ['pos_comandas'], edit: true },
  { who: MANAGER, path: '/bar/mesas', name: 'bar-floor-edit-3d', edit: true, click: /3D preview/ },
  { who: MANAGER, path: '/bar/pos', name: 'bar-pos' },
  { who: MANAGER, path: '/bar/pos', name: 'bar-pos-counter', click: /Counter/ },
  { who: MANAGER, path: '/bar/pos', name: 'bar-pos-dashboard', click: /^Dashboard$/ },
  { who: MANAGER, path: '/bar/pos', name: 'bar-pos-void', click: /^Dashboard$/, then: /^Void$/ },
  { who: MANAGER, path: '/bar/pos', name: 'bar-pos-order', click: /Counter/, taps: ['.pq-tile-hit', '.pq-tile-hit', '.pq-cartbar'], tapsBelow: 901 },
  { who: MANAGER, path: '/bar/pos', name: 'bar-pos-lines', click: /Counter/, taps: ['.pq-tile-hit', '.pq-grid .pq-tile:nth-child(2) .pq-tile-hit', '.pq-grid .pq-tile:nth-child(3) .pq-tile-hit', '.pq-grid .pq-tile:nth-child(4) .pq-tile-hit', '.pq-cartbar'] },
  { who: MANAGER, path: '/bar/pos', name: 'bar-pos-pay', click: /Counter/, taps: ['.pq-tile-hit', '.pq-grid .pq-tile:nth-child(2) .pq-tile-hit', '.pq-cartbar', '.pq-charge'] },
  { who: MANAGER, path: '/bar/pos', name: 'bar-pos-tab-crm', click: /Counter/, taps: ['.pq-cartbar', '.pq-tab.is-add'] },
  { who: CASHIER, path: '/bar/pos', name: 'till-kiosk' },
  { who: CASHIER, path: '/bar/pos', name: 'till-kiosk-pay', taps: ['.pq-tile-hit', '.pq-grid .pq-tile:nth-child(2) .pq-tile-hit', '.pq-grid .pq-tile:nth-child(3) .pq-tile-hit', '.pq-cartbar', '.pq-charge'] },
  { who: CASHIER, path: '/bar/pos', name: 'till-kiosk-done', taps: ['.pq-tile-hit', '.pq-cartbar', '.pq-charge', '.pq-charge'] },
  { who: MANAGER, path: '/bar/pos', name: 'bar-pos-done', click: /Counter/, taps: ['.pq-tile-hit', '.pq-cartbar', '.pq-charge', '.pq-charge'] },
  { who: MANAGER, path: '/bar/pos', name: 'bar-pos-vip', chip: /VIP/ },
  { who: MANAGER, path: '/bar/pos', name: 'bar-pos-drinkback', chip: /Drink Back/ },
  { who: MANAGER, path: '/bar/pos', name: 'bar-pos-prices', chip: /Prices/ },
  { who: MANAGER, path: '/bar/pos', name: 'bar-pos-prices-drink', chip: /Prices/, then: /^Highball/, phoneOnly: true },
  { who: MANAGER, path: '/bar/pos', name: 'bar-pos-discounts', chip: /Discounts/ },
  { who: MANAGER, path: '/bar/vip', name: 'bar-vip' },
  { who: MANAGER, path: '/bar/pedidos', name: 'bar-supply' },
  { who: MANAGER, path: '/bar/pagamentos', name: 'bar-locked-money', vault: true },
  { who: MANAGER, path: '/bar/senha', name: 'bar-vault-settings', vault: 'owner' },
  { who: MANAGER, path: '/bar/senha', name: 'bar-vault-settings-off', vault: null },
  { who: MANAGER, path: '/bar/fixo', name: 'bar-fixed-costs' },
  { who: MANAGER, path: '/bar/variavel', name: 'bar-variable-costs', click: /^Add$/ },
  { who: MANAGER, path: '/bar/cartao', name: 'bar-card-machines' },
  { who: MANAGER, path: '/bar/energia', name: 'bar-power-old-link' },
  { who: MANAGER, path: '/bar/pedidos', name: 'bar-supply-way', click: /On the way/ },
  { who: MANAGER, path: '/bar/entregas', name: 'bar-supply-received' },
  { who: MANAGER, path: '/bar/pedidos', name: 'bar-supply-own', click: /Own orders/ },
  { who: MANAGER, path: '/bar/pedidos', name: 'bar-supply-own-new', click: [/Own orders/, /New own order/] },
  { who: STAFF, path: '/bar/pedidos', name: 'staff-supply' },
  { who: MANAGER, path: '/bar/ordens', name: 'bar-orders' },
  { who: STAFF, path: '/bar/hoje', name: 'staff-today' },
  { who: STAFF, path: '/bar/hoje', name: 'staff-today-only', acessos: ['clock'] },
  { who: STAFF, path: '/bar/goals', name: 'staff-goals' },
  { who: STAFF, path: '/bar/pos', name: 'staff-pos' },
  { who: STAFF, path: '/bar/pos', name: 'staff-pos-only', acessos: ['clock'] },
  { who: STAFF, path: '/bar/hoje', name: 'staff-logo-tap', acessos: ['clock'], taps: ['.sa-top-bar'] },
  { who: STAFF, path: '/bar/ponto', name: 'staff-logo-tap-clock', acessos: ['clock'], taps: ['.sa-top-bar'] },
  { who: STAFF, path: '/bar/hoje', name: 'staff-bell-only', acessos: ['clock'], gate: true, taps: ['.sa-bell'] },
  { who: STAFF, path: '/bar/pos', name: 'staff-pos-gate', gate: true, acessos: ['clock'] },
  { who: STAFF, path: '/bar/pos', name: 'staff-pos-order', taps: ['.pq-tile-hit', '.pq-tile-hit', '.pq-cartbar', '.pq-charge'], tapsBelow: 901 },
  { who: STAFF, path: '/bar/pos', name: 'staff-pos-cast', phoneOnly: true, taps: ['.pq-tile-hit', '.pq-cartbar', '.pq-charge', '.pq-castrow-chips button:nth-child(2)'] },
  { who: STAFF, path: '/bar/pos', name: 'staff-pos-cast-wide', wideOnly: true, taps: ['.pq-tile-hit', '.pq-charge', '.pq-castrow-chips button:nth-child(2)'] },
  { who: STAFF, path: '/bar/pos', name: 'staff-pos-mine', taps: ['.pq-glance.is-mine .is-btn'] },
  { who: STAFF, path: '/bar/performance', name: 'staff-app-performance' },
  { who: STAFF, path: '/bar/performance', name: 'staff-results-day', taps: ['.sa-cal-cell.has-pay'] },
  { who: STAFF, path: '/bar/ponto', name: 'staff-app-clock' },
  { who: STAFF, path: '/bar/ponto', name: 'staff-app-clock-out', taps: ['.sa-clock-cta'], geo: true },
  { who: STAFF, path: '/bar/ponto', name: 'staff-app-clock-nogps', taps: ['.sa-clock-cta'] },
  { who: STAFF, path: '/bar/hoje', name: 'staff-app-more', taps: ['.sa-tabs button:last-child'] },
  { who: STAFF, path: '/bar/shifts', name: 'staff-app-shifts' },
  { who: STAFF, path: '/bar/salary', name: 'staff-app-earnings' },
  { who: STAFF, path: '/bar/salary', name: 'staff-pay-hub' },
  { who: STAFF, path: '/bar/salary', name: 'staff-pay-day', taps: ['.sa-cal-cell.has-pay'] },
  { who: STAFF, path: '/bar/schedule', name: 'staff-schedule' },
  { who: STAFF, path: '/bar/hoje', name: 'staff-home-schedule' },
  { who: STAFF, path: '/bar/hoje', name: 'staff-schedule-gate', gate: true },
  { who: STAFF, path: '/bar/salary', name: 'staff-gate-sheet', gate: true },
  { who: STAFF, path: '/bar/schedule', name: 'staff-schedule-next', gate: true },
  { who: STAFF, path: '/bar/schedule', name: 'staff-schedule-time', gate: true, taps: ['.sa-night.is-problem'] },
  { who: STAFF, path: '/bar/schedule', name: 'staff-schedule-sent', gate: true, taps: ['.sa-night.is-problem', '.sa-presets button', '.sa-timesheet .sa-btn.is-primary', '.sa-savebar .sa-btn.is-primary'] },
  { who: STAFF, path: '/bar/hoje', name: 'staff-bell', taps: ['.sa-bell'] },
  { who: STAFF, path: '/bar/hoje', name: 'staff-bell-gate', gate: true, taps: ['.sa-bell'] },
  { who: MANAGER, path: '/bar/ponto', name: 'owner-schedule-board' },
  { who: MANAGER, path: '/bar/ponto', name: 'owner-fine-sheet', taps: ['.osb-fine-btn'] },
  { who: MANAGER, path: '/bar/salarios', name: 'owner-salary-fines' },
  { who: STAFF, path: '/bar/reports', name: 'staff-app-reports' },
  { who: STAFF, path: '/bar/profile', name: 'staff-app-profile' },
  { who: STAFF, path: '/bar/settings', name: 'staff-app-settings' },
  { who: STAFF, path: '/', name: 'login', loggedOut: true },
  { who: STAFF, path: '/bar/ponto', name: 'staff-app-hours' },
  { who: STAFF, path: '/bar/ponto', name: 'staff-app-hours-pick', taps: ['.sa-hchart-bars button.has-h'] },
  { who: STAFF, path: '/bar/profile', name: 'staff-app-account', taps: ['.sa-line .sa-link'] },
  { who: STAFF, path: '/bar/schedule', name: 'staff-schedule-dayshift', taps: ['.sa-night:not(.is-locked)', '.sa-shiftseg button'] },
  { who: MANAGER, path: '/bar/inicio', name: 'bar-home' },
  { who: MANAGER, path: '/bar/inicio', name: 'bar-home-rail', rail: true },
  { who: OWNER, path: '/bar/inicio', name: 'bar-home-owner' },
  { who: OWNER, path: '/bar/conta', name: 'bar-account' },
  { who: OWNER, path: '/bar/conta', name: 'bar-account-password', taps: ['.my-account-line:nth-of-type(3) .ui-btn'] },
  { who: OWNER, path: '/bar/conta', name: 'bar-logo-home', taps: ['button.bar-identity.is-link'] },
]
let CURRENT = {}
const ONLY = process.env.PAGES ? process.env.PAGES.split(',') : null

const VENUE = { configured: true, lat: 35.6595, lng: 139.7005, radius_m: 150 }

/** Staff self-service and owner inbox actions of /api/bar-staff, from the fixtures with the real helpers. */
const SELF_MOCK = {
  meDay: who => {
    const me = { id: who.id, nome: who.nome }
    const night = tokyoNightKey()
    const summary = myNightSummary({ sales: TABLES.pos_vendas, items: TABLES.pos_vendas_itens || [], me, night, agents: TABLES.drink_back_agents })
    const goals = { pessoas: [{ id: who.id, noite: 60000, semana: 300000 }] }
    return { night, mission: 'Greet every guest by name and offer the bottle set before 22:00.', role: 'Bartender · bar top', barGoal: 400000, goal: myGoalStatus({ goals, meId: who.id, mySales: summary.sales }), summary, nightPremium: true }
  },
  meProfile: who => ({ id: who.id, nome: who.nome, cargo: 'Bartender', email: who.email, telefone: '090-1234-5678', foto_url: '' }),
  meRequests: () => ({ requests: [
    { id: 'rq1', tipo: 'stock', texto: 'Lime is almost out — 4 left.', status: 'done', criado_em: new Date(Date.now() - 86400000).toISOString(), answer: 'Ordered, arrives tomorrow.', answered_by: 'Gerente Demo' },
    { id: 'rq2', tipo: 'request', texto: 'Can I swap Saturday with Ken?', status: 'open', criado_em: new Date(Date.now() - 3600000).toISOString() },
  ] }),
  meEarnings: (who, body = {}) => {
    const { from, to } = body.from ? body : earningsRange('week')
    const out = earningsByDay({ punches: PUNCHES, sales: TABLES.pos_vendas, me: { id: who.id, nome: who.nome }, rate: 1600, nightPremium: true, from, to, agents: TABLES.drink_back_agents })
    // A few fictional past nights so the pay calendar and day list are not empty.
    const today = tokyoNightKey()
    for (const [back, hours, comm] of [[2, 5, 1200], [3, 6, 2400], [6, 4.5, 800], [9, 6, 3000]]) {
      const row = out.days.find(d => d.day === addDays(today, -back))
      if (row) { row.hours = hours; row.hoursPay = Math.round(hours * 1600); row.commission = comm; row.tickets = 3; row.sales = comm * 10 }
    }
    out.totals = out.days.reduce((a, r) => ({ hours: a.hours + r.hours, hoursPay: a.hoursPay + r.hoursPay, sales: a.sales + r.sales, commission: a.commission + r.commission, tickets: a.tickets + r.tickets }), { hours: 0, hoursPay: 0, sales: 0, commission: 0, tickets: 0 })
    const fineDay = addDays(today, -6)
    const fines = fineDay >= from && fineDay <= to ? [{ id: 'f1', day: fineDay, type: 'late', amount: 1000, note: 'Late by 25 min', status: 'active', created_by_nome: 'Gerente Demo' }] : []
    const attendance = {}
    if (fineDay >= from && fineDay <= to) attendance[fineDay] = { status: 'late', lateMinutes: 25, start: '20:00' }
    const absentDay = addDays(today, -4)
    if (absentDay >= from && absentDay <= to) attendance[absentDay] = { status: 'absent', lateMinutes: 0, start: '20:00' }
    return { from, to, rate: 1600, monthly: 0, nightPremium: true, ...out, fines, finesTotal: fines.reduce((a, f) => a + f.amount, 0), attendance }
  },
  meAvailability: () => {
    const today = tokyoNightKey()
    const win = scheduleWindow(today)
    const days = {}
    const confirmed = {}
    for (const n of [0, 1, 2, 5, 8, 9]) days[addDays(today, n)] = { start: n === 5 ? '21:00' : '20:00', end: '02:00' }
    confirmed[today] = { in: true, start: '20:00', end: '02:00' }
    confirmed[addDays(today, 1)] = { in: true, start: '20:00', end: '01:00' }
    confirmed[addDays(today, 2)] = { in: false }
    const editable = []
    for (let d = today; d <= win.to; d = addDays(d, 1)) editable.push(d)
    const nw = nextWeekOf(today)
    if (CURRENT.gate) for (let d = nw.from; d <= nw.to; d = addDays(d, 1)) delete days[d]
    if (CURRENT.gate) days[addDays(nw.from, 1)] = { start: '20:00' }
    const weeks = CURRENT.gate ? {} : { [nw.from]: { submitted_at: new Date().toISOString() } }
    const status = submissionStatus({ row: { days, weeks }, rules: DEFAULT_RULES, today })
    return { ...win, openHour: 20, days, weeks, confirmed, editable, rules: DEFAULT_RULES, status, tolerance: 10, updated_at: new Date().toISOString() }
  },
  meSaveAvailability: (who, body = {}) => {
    const today = tokyoNightKey()
    const nw = nextWeekOf(today)
    const days = body.days || {}
    const weeks = body.submitWeek ? { [body.submitWeek]: { submitted_at: new Date().toISOString() } } : {}
    return { ok: true, days, weeks, locked: [], status: submissionStatus({ row: { days, weeks }, rules: DEFAULT_RULES, today }), week: nw }
  },
  mePayouts: () => {
    const now = tokyoNightKey().slice(0, 7)
    const [y, m] = now.split('-').map(Number)
    const key = back => { const d = new Date(Date.UTC(y, m - 1 - back, 1)); return d.toISOString().slice(0, 7) }
    return { payouts: [[1, 182000, 3000, 10000], [2, 171500, 0, 0], [3, 196000, 2000, 20000], [4, 158000, 0, 5000], [5, 188500, 1000, 0]].map(([back, gross, fines, adv]) => ({
      id: `po${back}`, month: key(back), gross, fines, advances: adv, deductions: 0, net: gross - fines - adv, paid_at: `${key(back - 1)}-25T10:00:00+09:00`, status: 'paid',
    })) }
  },
  scheduleBoard: () => {
    const today = tokyoNightKey()
    const win = scheduleWindow(today)
    const ago = (day, h, min) => new Date(Date.parse(`${day}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+09:00`)).toISOString()
    const yest = addDays(today, -1)
    const mark = list => Object.fromEntries(list.map(([d, s]) => [d, { start: s, end: '02:00' }]))
    const nw = nextWeekOf(today)
    return {
      from: win.from, to: win.to, openHour: 20, rules: DEFAULT_RULES, nextWeek: nw,
      settings: { absent: 5000, late: 1000, lateEvery: 15, tolerance: 10 },
      availability: [
        { staff_id: 'st1', staff_nome: 'Aiko Tanaka', days: mark([[yest, '20:00'], [today, '20:00'], [addDays(today, 1), '20:00'], [addDays(today, 2), '21:00'], [nw.from, '20:00'], [addDays(nw.from, 3), '21:00']]), weeks: { [nw.from]: { submitted_at: new Date().toISOString() } } },
        { staff_id: 'st2', staff_nome: 'Ken Mori', days: mark([[yest, '20:00'], [today, '21:00'], [addDays(today, 2), '20:00']]) },
        { staff_id: 'pp1', staff_nome: 'Mika Hayashi', days: mark([[yest, '20:30'], [addDays(today, 1), '20:00']]) },
      ],
      schedules: [{ day: yest, people: [{ id: 'st1', nome: 'Aiko Tanaka', start: '20:00' }, { id: 'st2', nome: 'Ken Mori', start: '20:00' }, { id: 'pp1', nome: 'Mika Hayashi', start: '20:30' }] }],
      fines: [],
      punches: [
        { id: 'y1', staff_id: 'st1', tipo: 'in', punched_at: ago(yest, 19, 55) },
        { id: 'y2', staff_id: 'st2', tipo: 'in', punched_at: ago(yest, 20, 28) },
        ...PUNCHES,
      ],
    }
  },
  listFines: () => ({ fines: [
    { id: 'f1', staff_id: 'st2', staff_nome: 'Ken Mori', day: addDays(tokyoNightKey(), -6), type: 'late', amount: 1000, note: 'Late by 25 min', status: 'active', created_by_nome: 'Gerente Demo', created_at: new Date(Date.now() - 5 * 86400000).toISOString() },
    { id: 'f2', staff_id: 'st1', staff_nome: 'Aiko Tanaka', day: addDays(tokyoNightKey(), -9), type: 'absent', amount: 5000, note: '', status: 'cancelled', created_by_nome: 'Gerente Demo', created_at: new Date(Date.now() - 8 * 86400000).toISOString(), cancelled_by_nome: 'Owner Demo', cancelled_at: new Date(Date.now() - 7 * 86400000).toISOString(), cancel_note: 'Was sick' },
  ] }),
  listPayouts: () => ({ payouts: [] }),
  listRequests: () => ({ requests: [
    { id: 'rq2', staff_id: 'st1', staff_nome: 'Aiko Tanaka', tipo: 'request', texto: 'Can I swap Saturday with Ken?', status: 'open', criado_em: new Date(Date.now() - 3600000).toISOString() },
    { id: 'rq3', staff_id: 'st2', staff_nome: 'Ken Mori', tipo: 'problem', texto: 'Ice machine is leaking under the counter.', status: 'seen', criado_em: new Date(Date.now() - 7200000).toISOString() },
  ] }),
  listDayReports: () => ({ reports: [
    { id: 'dr1', staff_id: 'st2', staff_nome: 'Ken Mori', night_key: tokyoNightKey(), out_at: new Date(Date.now() - 1200000).toISOString(), role: 'Floor', mission: 'Greet every guest by name.', goal: { target: 50000, missed: true }, summary: { sales: 38000, commission: 0, drinkBackCount: 2 }, notes: 'Busy at 23:00, table 4 waited.', improve: 'Ask the bar for help earlier when two tables order at once.', ai_report: 'Ken worked 3h on the floor and sold ¥38,000 (goal ¥50,000). He noted a rush at 23:00 and plans to ask for help earlier.' },
  ] }),
}

function filterRows(rows, params) {
  let out = rows
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue
    let v = raw
    try { v = decodeURIComponent(raw) } catch { /* already decoded (e.g. like.staff%) */ }
    const neg = v.startsWith('not.')
    const expr = neg ? v.slice(4) : v
    const [op, ...rest] = expr.split('.')
    const arg = rest.join('.')
    const test = r => {
      const val = r[k]
      if (op === 'eq') return String(val) === arg
      if (op === 'neq') return String(val) !== arg
      if (op === 'is') return arg === 'null' ? val == null : String(val) === arg
      if (op === 'in') return arg.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/"/g, '')).includes(String(val))
      if (op === 'gte') return val == null || String(val) >= arg
      if (op === 'lte') return val == null || String(val) <= arg
      if (op === 'gt') return val == null || String(val) > arg
      if (op === 'lt') return val == null || String(val) < arg
      return true
    }
    out = out.filter(r => (neg ? !test(r) : test(r)))
  }
  return out
}

/** /api/bar/hq-sync (lite): tonight's till tickets spread over the evening, plus the same night last week. */
function hqSnapshot() {
  const tickets = []
  const now = new Date()
  const stamp = (daysAgo, hour, min) => {
    const d = new Date(now.getTime() - daysAgo * 86400000)
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(d)
    return `${ymd}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00+09:00`
  }
  const plan = [[19, 2], [20, 4], [21, 7], [22, 9], [23, 6], [0, 3]]
  for (const [daysAgo, scale] of [[0, 1], [7, 0.8]]) {
    plan.forEach(([hour, n]) => {
      for (let k = 0; k < Math.round(n * scale); k++) {
        const back = hour < 6 ? daysAgo - 1 : daysAgo
        const at = stamp(back, hour, (k * 11) % 60)
        tickets.push({ id: `t${daysAgo}-${hour}-${k}`, data: at.slice(0, 10), criado_em: at, total: 3800 + ((hour + k) % 5) * 1200, obs: '', metodo_pagamento: k % 3 ? 'Card' : 'Cash' })
      }
    })
  }
  return { books: {}, pos: { salesCount: tickets.length, till: tickets.reduce((a, x) => a + x.total, 0), tickets, history: tickets }, payroll: [], jbm: {} }
}

/** /api/dashboard computed from the fixtures with the same helpers the real endpoint uses. */
function dashboardPayload() {
  const now = new Date()
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const ctx = { vendas: TABLES.vendas || [], compras: TABLES.compras || [], faturas: TABLES.faturas || [], pedidos: TABLES.pedidos || [], bars: TABLES.bars }
  const byMonth = {}
  const chart = months.map(m => {
    const s = monthDashboardStats(m, ctx)
    byMonth[m] = { ...s, entregasDetalhe: entregasDetalheForMonth(m, ctx) }
    return { month: m, receita: s.receita, faturamento: s.faturamento, compras: s.compras, lucro: s.lucroProjetado }
  })
  return {
    months: [...months].reverse(), chart, byMonth,
    calendar: buildDashboardCalendar({ ...ctx, pagamentos: [], fornecedores: [] }),
    pedidosPendentes: 0,
    alertas: buildDashboardAlertas({ faturas: ctx.faturas, compras: ctx.compras, fornecedores: [] }),
  }
}

function fakeJwt(user) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, role: 'authenticated', email: user.email, exp: Math.floor(Date.now() / 1000) + 86400 })}.sig`
}

async function mock(page, who, missing = [], vault = null, acessos = null) {
  const user = { id: who.id, email: who.email, aud: 'authenticated', role: 'authenticated', user_metadata: { nome: who.nome }, app_metadata: {} }
  await page.route(/supabase\.co\/auth\/v1\//, route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(route.request().url().includes('/user') ? user : { access_token: fakeJwt(who), token_type: 'bearer', expires_in: 86400, refresh_token: 'r', user }) })
  })
  await page.route(/supabase\.co\/rest\/v1\/rpc\//, route => {
    const fn = route.request().url().split('/rpc/')[1].split('?')[0]
    const body = fn === 'pos_commit_sale' ? '"00000000-0000-4000-8000-00000000f111"' : fn.startsWith('floor_save') ? '{"versao":4}' : '{}'
    route.fulfill({ status: 200, contentType: 'application/json', body })
  })
  await page.route(/supabase\.co\/rest\/v1\//, route => {
    const req = route.request()
    const url = new URL(req.url())
    const table = url.pathname.split('/rest/v1/')[1]
    if (missing.includes(table)) {
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` }) })
    }
    const rows = table in TABLES ? filterRows(TABLES[table], url.searchParams) : []
    const single = /vnd\.pgrst\.object/.test(req.headers().accept || '')
    if (req.method() !== 'GET' && req.method() !== 'HEAD') {
      return route.fulfill({ status: 201, contentType: 'application/json', body: single ? JSON.stringify({ id: 'new-row' }) : '[]' })
    }
    if (single) {
      return rows[0]
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows[0]) })
        : route.fulfill({ status: 406, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST116', message: 'no rows' }) })
    }
    const limit = +url.searchParams.get('limit') || rows.length
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': `0-${rows.length}/${rows.length}` }, body: JSON.stringify(rows.slice(0, limit)) })
  })
  await page.route(/\/api\//, async route => {
    const req = route.request()
    if (req.url().includes('/api/bar/live-db')) {
      let spec = {}
      try { spec = JSON.parse(req.postData() || '{}') } catch { /* empty */ }
      const rows = TABLES[spec.table] || []
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: spec.wantSingle ? rows[0] || null : rows }) })
    }
    const path = new URL(req.url()).pathname
    if (req.method() === 'POST' && path === '/api/bar-staff' && (req.postDataJSON() || {}).action === 'lockStatus') {
      const on = vault ? { enabled: true, hasPin: true, areas: ['money', 'payroll'], minutes: 15 } : { enabled: false, hasPin: false, areas: [], minutes: 15 }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...on, unlockedUntil: 0, canEdit: who.role !== 'gerente' || vault === 'owner' }) })
    }
    if (req.method() === 'POST' && path === '/api/bar-staff' && (req.postDataJSON() || {}).action === 'castRoster') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ people: castRoster(BAR_STAFF.staff, TABLES.drink_back_agents) }) })
    }
    const action = req.method() === 'POST' && path === '/api/bar-staff' ? (req.postDataJSON() || {}).action : ''
    if (action && SELF_MOCK[action]) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SELF_MOCK[action](who, req.postDataJSON() || {})) })
    }
    if (req.method() === 'POST' && path === '/api/bar-staff' && (req.postDataJSON() || {}).action === 'myAccess') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role: who.role, acessos, disabled: false }) })
    }
    if (req.method() === 'GET' && path === '/api/bar-staff') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BAR_STAFF) })
    }
    if (req.method() === 'GET' && (path === '/api/time-clock' || path === '/api/bar/time-clock')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ punches: PUNCHES, adicional_noturno: true, venue: VENUE }) })
    }
    if (req.method() === 'GET' && path === '/api/bar/hq-sync') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hqSnapshot()) })
    }
    if (req.method() === 'GET' && path === '/api/bar/bar-finance') {
      const month = tokyoMonthKey()
      const one = bar => {
        const hq = { ...hqSnapshot(), mes: month, books: { pos: { amount: 0 }, jbm: { amount: 84000 }, staff: { amount: 152000 }, rent: { amount: 0 } }, payroll: [{ staff_id: 's1', nome: 'Yuki', hours: 62, pay: 93000 }, { staff_id: 's2', nome: 'Ken', hours: 40, pay: 59000 }], jbm: { comprasMes: 84000, totalPendente: 42000, faturasAtraso: 1, openInvoices: [] } }
        return { bar, month, hq, registry: BAR_STAFF.registry || [], goals: BAR_STAFF.goals || {}, wagesByMonth: {} }
      }
      const barId = new URL(req.url()).searchParams.get('bar_id')
      const body = barId
        ? one(TABLES.bars.find(b => b.id === barId) || TABLES.bars[0])
        : { month, bars: TABLES.bars.map((b, i) => (i ? { ...barListRow(b, { hq: { pos: { history: [] }, jbm: {} } }, month) } : barListRow(b, one(b), month))) }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    }
    if (path === '/api/dashboard') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dashboardPayload()) })
    }
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'offline in visual check' }) })
  })
  await page.route(/fonts\.(googleapis|gstatic)\.com/, route => route.fulfill({ status: 200, body: '' }))
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
  await new Promise(r => setTimeout(r, 2500))
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || (existsSync(SHELL) ? SHELL : undefined) })
  const report = []
  try {
    for (const [themeName, themeValue] of Object.entries(THEMES)) {
      for (const width of WIDTHS) {
        for (const pg of PAGES) {
          if (ONLY && !ONLY.includes(pg.name)) continue
          if (pg.phoneOnly && width >= 700) continue
          if (pg.wideOnly && width < 901) continue
          const ctx = await browser.newContext({ viewport: { width, height: width < 700 ? 780 : 900 }, deviceScaleFactor: 1, hasTouch: width < 1024, colorScheme: themeName, ...(pg.geo ? { permissions: ['geolocation'], geolocation: { latitude: VENUE.lat, longitude: VENUE.lng, accuracy: 20 } } : {}) })
          const page = await ctx.newPage()
          const errors = []
          page.on('pageerror', e => errors.push(String(e.message || e)))
          page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|WebSocket|realtime|503/i.test(m.text())) errors.push(m.text()) })
          CURRENT = pg
          await mock(page, pg.who, pg.missing, pg.vault, pg.acessos)
          const session = { access_token: fakeJwt(pg.who), token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: 'r', user: { id: pg.who.id, email: pg.who.email, aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {} } }
          await page.addInitScript(rail => { if (rail) localStorage.setItem('jbm_sidebar_collapsed', '1') }, !!pg.rail)
          await page.addInitScript(([s, th]) => {
            sessionStorage.setItem('bebidas_tab_id', 'pw')
            if (s) sessionStorage.setItem('sb-ojirgkqtqvugqktyuhem-auth-pw', JSON.stringify(s))
            localStorage.setItem('jbm_drinks_theme', th)
            localStorage.setItem('jbm_drinks_lang', 'en')
          }, [pg.loggedOut ? null : session, themeValue])
          await page.goto(`http://localhost:${PORT}${pg.path}`, { waitUntil: 'networkidle' }).catch(() => {})
          await page.waitForTimeout(900)
          if (pg.edit) {
            await page.getByRole('radio', { name: /Edit layout/i }).click().catch(e => errors.push(`edit toggle: ${e.message}`))
            await page.waitForTimeout(600)
            await page.locator('.fe-table').first().click().catch(() => {})
            await page.waitForTimeout(300)
          }
          if (pg.radio) {
            await page.getByRole('radio', { name: pg.radio }).first().click({ timeout: 5000 }).catch(e => errors.push(`radio: ${e.message}`))
            await page.waitForTimeout(800)
          }
          if (pg.click) {
            for (const name of [].concat(pg.click)) {
              await page.getByRole('button', { name }).first().click({ timeout: 5000 }).catch(e => errors.push(`click: ${e.message}`))
              await page.waitForTimeout(800)
            }
          }
          for (const sel of (pg.tapsBelow && width >= pg.tapsBelow ? [] : pg.taps || [])) {
            // The phone order bar does not exist on wide screens, where the order panel is always open.
            if (sel === '.pq-cartbar' && !(await page.locator(`${sel}:visible`).count())) continue
            await page.locator(`${sel}:visible`).first().click({ timeout: 5000 }).catch(e => errors.push(`tap ${sel}: ${e.message}`))
            await page.waitForTimeout(300)
          }
          if (pg.chip) {
            await page.locator('.pos-subnav .pos-chip', { hasText: pg.chip }).first().click({ timeout: 5000 }).catch(e => errors.push(`chip: ${e.message}`))
            await page.waitForTimeout(800)
          }
          for (const name of [].concat(pg.then || [])) {
            await page.getByRole('button', { name }).first().click({ timeout: 5000 }).catch(e => errors.push(`then: ${e.message}`))
            await page.waitForTimeout(500)
          }
          if (pg.ask) {
            await page.locator('.ui-ask-ai:visible').first().click({ timeout: 5000 }).catch(e => errors.push(`ask ai: ${e.message}`))
            await page.waitForTimeout(400)
          }
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
          const culprits = overflow > 1 ? await page.evaluate(() => {
            const W = window.innerWidth
            const out = []
            for (const el of document.querySelectorAll('body *')) {
              const r = el.getBoundingClientRect()
              if (r.right > W + 1 && r.width > 0) {
                const parentOver = el.parentElement && el.parentElement.getBoundingClientRect().right > W + 1
                if (!parentOver) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')} right=${Math.round(r.right)} w=${Math.round(r.width)}`)
              }
            }
            return out.slice(0, 6)
          }) : []
          const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
          const file = `${OUT}/${pg.name}-${width}-${themeName}.png`
          await page.screenshot({ path: file, fullPage: !!process.env.FULL })
          report.push({ page: pg.name, width, theme: themeName, appliedTheme: theme, overflowPx: overflow, culprits, errors })
          const flag = overflow > 1 || errors.length ? '✗' : '✓'
          console.log(`${flag} ${pg.name} ${width} ${themeName}${overflow > 1 ? ` overflow ${overflow}px [${culprits.join('; ')}]` : ''}${errors.length ? ` errors: ${errors.slice(0, 2).join(' | ').slice(0, 300)}` : ''}`)
          await ctx.close()
        }
      }
    }
  } finally {
    await browser.close()
    server.kill()
  }
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2))
  const bad = report.filter(r => r.overflowPx > 1 || r.errors.length)
  console.log(`\n${report.length - bad.length}/${report.length} clean`)
  process.exitCode = bad.length ? 1 : 0
}

main()
