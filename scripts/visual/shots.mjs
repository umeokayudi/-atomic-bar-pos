/**
 * Visual and layout check of the redesign with fictional data (no network, no real Supabase).
 *   npm run build && node scripts/visual/shots.mjs [outDir]
 * Serves dist/ with `vite preview`, mocks Supabase REST/RPC/auth and /api, signs in with a fake session,
 * and for each width × theme × page: takes a screenshot, fails on page errors and on horizontal page scroll.
 */
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { ADMIN, MANAGER, STAFF, TABLES, BAR_STAFF, PUNCHES } from './fixtures.mjs'
import {
  monthDashboardStats, buildDashboardAlertas, entregasDetalheForMonth, buildDashboardCalendar,
} from '../../api/_dashboardMonth.js'

const OUT = process.argv[2] || 'visual-out'
const PORT = 4179
const SHELL = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(',').map(Number) : [360, 390, 768, 1024, 1280, 1440]
const THEMES = Object.fromEntries(Object.entries({ light: 'modern', dark: 'classic' }).filter(([k]) => !process.env.THEMES || process.env.THEMES.split(',').includes(k)))
const PAGES = [
  { who: ADMIN, path: '/hq/dashboard', name: 'hq-dashboard' },
  { who: ADMIN, path: '/hq/dashboard', name: 'hq-dashboard-rail', rail: true },
  { who: ADMIN, path: '/hq/dashboard', name: 'hq-dashboard-edit', click: /^Customize$/ },
  { who: ADMIN, path: '/hq/crm', name: 'hq-crm' },
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
  { who: MANAGER, path: '/bar/estoque', name: 'bar-stock' },
  { who: MANAGER, path: '/bar/custos', name: 'bar-costs' },
  { who: MANAGER, path: '/bar/faturas', name: 'bar-invoices' },
  { who: MANAGER, path: '/bar/pagamentos', name: 'bar-payments' },
  { who: MANAGER, path: '/bar/salarios', name: 'bar-salaries' },
  { who: MANAGER, path: '/bar/staff', name: 'bar-staff' },
  { who: MANAGER, path: '/bar/metas', name: 'bar-goals' },
  { who: MANAGER, path: '/bar/ponto', name: 'bar-clock' },
  { who: MANAGER, path: '/bar/fechamento', name: 'bar-close' },
  { who: MANAGER, path: '/bar/ia', name: 'bar-ai' },
  { who: MANAGER, path: '/bar/aluguel', name: 'bar-rent' },
  { who: MANAGER, path: '/bar/mesas', name: 'bar-floor' },
  { who: MANAGER, path: '/bar/mesas', name: 'bar-floor-edit', edit: true },
  { who: MANAGER, path: '/bar/mesas', name: 'bar-floor-3d', radio: /^3D$/ },
  { who: MANAGER, path: '/bar/mesas', name: 'bar-floor-planonly', missing: ['pos_comandas'] },
  { who: MANAGER, path: '/bar/mesas', name: 'bar-floor-planonly-edit', missing: ['pos_comandas'], edit: true },
  { who: MANAGER, path: '/bar/mesas', name: 'bar-floor-edit-3d', edit: true, click: /3D preview/ },
  { who: MANAGER, path: '/bar/pos', name: 'bar-pos' },
  { who: MANAGER, path: '/bar/pos', name: 'bar-pos-counter', click: /Counter/ },
  { who: MANAGER, path: '/bar/vip', name: 'bar-vip' },
  { who: MANAGER, path: '/bar/ordens', name: 'bar-orders' },
  { who: STAFF, path: '/bar/hoje', name: 'staff-today' },
  { who: STAFF, path: '/bar/goals', name: 'staff-goals' },
  { who: MANAGER, path: '/bar/inicio', name: 'bar-home' },
  { who: MANAGER, path: '/bar/inicio', name: 'bar-home-rail', rail: true },
]
const ONLY = process.env.PAGES ? process.env.PAGES.split(',') : null

function filterRows(rows, params) {
  let out = rows
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue
    const v = decodeURIComponent(raw)
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

async function mock(page, who, missing = []) {
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
    if (req.method() === 'GET' && path === '/api/bar-staff') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BAR_STAFF) })
    }
    if (req.method() === 'GET' && (path === '/api/time-clock' || path === '/api/bar/time-clock')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ punches: PUNCHES, adicional_noturno: true }) })
    }
    if (req.method() === 'GET' && path === '/api/bar/hq-sync') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hqSnapshot()) })
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
          const ctx = await browser.newContext({ viewport: { width, height: width < 700 ? 780 : 900 }, deviceScaleFactor: 1, hasTouch: width < 1024, colorScheme: themeName })
          const page = await ctx.newPage()
          const errors = []
          page.on('pageerror', e => errors.push(String(e.message || e)))
          page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|WebSocket|realtime|503/i.test(m.text())) errors.push(m.text()) })
          await mock(page, pg.who, pg.missing)
          const session = { access_token: fakeJwt(pg.who), token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, refresh_token: 'r', user: { id: pg.who.id, email: pg.who.email, aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {} } }
          await page.addInitScript(rail => { if (rail) localStorage.setItem('jbm_sidebar_collapsed', '1') }, !!pg.rail)
          await page.addInitScript(([s, th]) => {
            sessionStorage.setItem('bebidas_tab_id', 'pw')
            sessionStorage.setItem('sb-ojirgkqtqvugqktyuhem-auth-pw', JSON.stringify(s))
            localStorage.setItem('jbm_drinks_theme', th)
            localStorage.setItem('jbm_drinks_lang', 'en')
          }, [session, themeValue])
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
            await page.getByRole('button', { name: pg.click }).first().click({ timeout: 5000 }).catch(e => errors.push(`click: ${e.message}`))
            await page.waitForTimeout(800)
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
