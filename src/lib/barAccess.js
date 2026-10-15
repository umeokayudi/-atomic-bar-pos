/**
 * Per-login access for the bar portal ("Users & access").
 *
 * A login may carry `acessos: string[]` (the bar areas it may open). It only ever narrows what the role
 * already allows: the role checks stay as they are. No list (null / missing) keeps today's behaviour, and
 * the owner (role 'cliente') always has everything.
 *
 * Pure: shared by the portal (menu, routes) and by the API (/api/bar-staff, live-db, time-clock, hq-sync).
 */

/** Areas in menu order. */
export const BAR_AREAS = ['home', 'till', 'floor', 'clock', 'close', 'drinks', 'money', 'payroll', 'team', 'clients', 'users']

/** Areas a manager preset leaves out: money, payroll and logins/passwords. */
export const SENSITIVE_AREAS = ['money', 'payroll', 'users']

/** Bar-portal tab id (/bar/<tab>) → area. Tabs not listed (staff self-service: hoje, profile, salary…) are always open. */
export const TAB_AREA = {
  inicio: 'home', ia: 'home',
  pos: 'till',
  mesas: 'floor', espacos: 'floor', vip: 'floor',
  ponto: 'clock',
  fechamento: 'close',
  pedidos: 'drinks', entregas: 'drinks', estoque: 'drinks', precos: 'drinks', fornecedor: 'drinks',
  pagamentos: 'money', custos: 'money', fixo: 'money', variavel: 'money', cartao: 'money', faturas: 'money',
  contador: 'money', imposto: 'money', recibos: 'money', energia: 'money', aluguel: 'money', outro: 'money',
  salarios: 'payroll', drinkback: 'payroll',
  staff: 'team', equipe: 'team', casa: 'team', ordens: 'team', metas: 'team',
  clientes: 'clients', eventos: 'clients', marketing: 'clients', parceiro: 'clients', consultoria: 'clients',
  usuarios: 'users', senha: 'users',
}

/** Staff self-service tabs (/bar/<tab>): no area, so every login of the role may open them. */
export const STAFF_SELF_TABS = ['hoje', 'profile', 'shifts', 'goals', 'result', 'points', 'occurrences', 'rewards', 'salary', 'performance', 'reports', 'settings']

/**
 * Ready-made access sets. `full` clears the list (the role decides, as before).
 * `staffOnly` is the staff app: the self-service tabs (no area) plus their own clock-in; no till, floor, drinks or money.
 */
export const ACCESS_PRESETS = [
  { id: 'staffOnly', areas: ['clock'] },
  { id: 'till', areas: ['till'] },
  { id: 'tillFloor', areas: ['till', 'floor'] },
  { id: 'floorClock', areas: ['floor', 'clock'] },
  { id: 'manager', areas: BAR_AREAS.filter(a => !SENSITIVE_AREAS.includes(a)) },
  { id: 'full', areas: null },
]

/** Keep only known areas, unique, in menu order. Anything that is not an array → null (no limit). */
export function cleanAcessos(list) {
  if (!Array.isArray(list)) return null
  const set = new Set(list.map(a => String(a || '').trim()))
  return BAR_AREAS.filter(a => set.has(a))
}

/** The preset id that matches a list exactly, else 'custom'. */
export function presetFor(acessos) {
  const clean = cleanAcessos(acessos)
  if (clean == null) return 'full'
  const key = clean.join(',')
  const hit = ACCESS_PRESETS.find(p => p.areas && p.areas.join(',') === key)
  return hit ? hit.id : 'custom'
}

export function presetAreas(id) {
  const p = ACCESS_PRESETS.find(x => x.id === id)
  return p ? (p.areas ? [...p.areas] : null) : null
}

export function isOwner(perfil) {
  return perfil?.role === 'cliente'
}

/** True when this login has an explicit list (and is not the owner). */
export function isRestricted(perfil) {
  return !isOwner(perfil) && Array.isArray(perfil?.acessos)
}

/** May this login open `area`? No area, the owner, or no list → yes. */
export function canAccess(perfil, area) {
  if (!area) return true
  if (!perfil) return false
  if (isOwner(perfil)) return true
  const list = cleanAcessos(perfil.acessos)
  if (list == null) return true
  return list.includes(area)
}

/** `spec` is an area or "a|b" (any of them). */
export function canAccessAny(perfil, spec) {
  if (!spec) return true
  return String(spec).split('|').some(a => canAccess(perfil, a))
}

export function areaForTab(tab) {
  return TAB_AREA[tab] || null
}

export function canOpenTab(perfil, tab) {
  return canAccess(perfil, areaForTab(tab))
}

/** Filter the role's grouped menu ([{ items: [{ id }] }]) down to this login's areas. Empty groups go. */
export function filterNavGroups(groups, perfil) {
  return (groups || [])
    .map(g => ({ ...g, items: (g.items || []).filter(n => canOpenTab(perfil, n.id)) }))
    .filter(g => g.items.length)
}

/** First tab this login may open, from `candidates` (default tab first). */
export function firstOpenTab(perfil, candidates, fallback) {
  const hit = (candidates || []).find(id => canOpenTab(perfil, id))
  return hit || fallback
}

const PAY_FIELDS = ['salario_hora', 'salario_mes', 'drink_back', 'comissao_pct', 'transporte']
const AUTO_CLOSE_KEYS = new Set(['action', 'fechou_noite', 'fechou_dia'])
const REORDER_KEYS = new Set(['pedido_modo', 'pedido_qtd', 'pedido_min', 'pedido_em', 'pedido_feito'])

/**
 * Areas an /api/bar-staff request needs. Each entry must pass; "a|b" passes with either.
 * Read-only/GET and the PIN flow need none here (GET strips money/payroll fields instead).
 */
export function staffActionAreas(method, body = {}, opts = {}) {
  const b = body || {}
  const sendsPay = PAY_FIELDS.some(k => b[k] != null)
  if (method === 'PATCH') {
    const need = []
    if (b.acessos !== undefined || b.role != null || b.password != null) need.push('users')
    else need.push('team|users')
    if (sendsPay || b.banco != null || b.condicoes != null || b.contrato_doc != null) need.push('payroll')
    return need
  }
  if (method !== 'POST') return []
  switch (b.action) {
    case 'lockStatus': case 'unlock': case 'setLock': case 'myAccess':
      return []
    case 'uploadStaffFile':
      return b.kind === 'contrato' ? ['team|users', 'payroll'] : ['team|users']
    case 'staffFileUrls':
      return ['team|users']
    case 'pairTablet': case 'saveLocation': case 'linkPerson':
      return ['users']
    case 'saveDaySheet':
      return ['team|clock']
    case 'listRequests': case 'answerRequest': case 'listDayReports':
      return ['team|clock']
    case 'saveEvent':
      return ['clients']
    case 'saveGoals':
      return ['team']
    case 'saveCloseSettings': {
      const keys = Object.keys(b).filter(k => b[k] != null && !AUTO_CLOSE_KEYS.has(k))
      if (!keys.length) return []
      if (keys.every(k => REORDER_KEYS.has(k))) return ['drinks']
      return ['close']
    }
    case 'saveRegistry':
      // Saving over an existing row also needs the stored row's area (a supplier save cannot overwrite a cost).
      return opts.registryKind ? [registryArea(b.kind), registryArea(opts.registryKind)] : [registryArea(b.kind)]
    case 'deleteRegistry':
      // The body's kind is not trusted: the API passes the stored row's kind; without it, money applies.
      return [opts.registryKind ? registryArea(opts.registryKind) : 'money']
    case 'savePerson': case 'deletePerson':
      return sendsPay ? ['team', 'payroll'] : ['team']
    case 'createStaff':
      return sendsPay ? ['users', 'payroll'] : ['users']
    default:
      return []
  }
}

const REGISTRY_AREA = { fornecedor: 'drinks', parceiro: 'clients' }

/** Registry row kind → area: suppliers are drinks, partners are clients, every other kind is money. */
export function registryArea(kind) {
  return REGISTRY_AREA[String(kind || '')] || 'money'
}

/** First required area this login lacks, or null. */
export function missingArea(perfil, needs) {
  for (const spec of needs || []) if (!canAccessAny(perfil, spec)) return String(spec).split('|')[0]
  return null
}

/** Live-store tables a restricted login may only touch with these areas. Others are left to the role checks. */
export const LIVE_TABLE_AREA = {
  bar_registry: 'money',
  bar_overhead: 'money',
  bar_hq_meta: 'money',
  staff_extras: 'team|payroll|users',
  bar_people: 'team|payroll|users',
}

/**
 * Who may manage whose login (area list, on/off, till/floor role). The owner: anyone but an owner. A manager:
 * only till/floor logins, and only with the users area. Nobody manages their own login here.
 */
export function canManageLogin(actor, target) {
  if (!actor || !target) return false
  if (target.role === 'cliente') return false
  if (actor.id && target.id && actor.id === target.id) return false
  if (isOwner(actor)) return true
  if (actor.role !== 'gerente') return false
  if (!['caixa', 'bar_staff'].includes(target.role)) return false
  return canAccess(actor, 'users')
}

/** canManageLogin, and a manager may only hand out areas they have (a limited manager cannot clear a list). */
export function canEditAccessOf(actor, target, nextAcessos) {
  if (!canManageLogin(actor, target)) return false
  if (isOwner(actor)) return true
  const next = cleanAcessos(nextAcessos)
  if (next == null) return !isRestricted(actor)
  return next.every(a => canAccess(actor, a))
}

/** "maria" → "maria.<bar>@staff.jbmtech.app"; an e-mail stays as typed (lower case). Invalid → ''. */
export function loginEmailFor(idOrEmail, barId) {
  const raw = String(idOrEmail || '').trim().toLowerCase()
  if (!raw) return ''
  if (raw.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? raw : ''
  if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(raw)) return ''
  const tag = String(barId || '').replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase() || 'bar'
  return `${raw}.${tag}@staff.jbmtech.app`
}
