/**
 * Shared till rules for the fixed POS and the phone POS.
 * Prices of drinks still come from drink_menu and bar_pricing.
 * The close still goes through pos_close_ticket.
 * Service, tax and card surcharge are extra lines on top of that drink subtotal.
 * They are not the processor fee (card_fee / 3.78%), and they are not JBM tax accounting.
 */

export const AI_STRATEGIES = [
  'bestsellers',
  'profit',
  'customer',
  'quality',
  'new',
  'promote',
  'slow',
  'premium',
]

export const SERVICE_POINTS = ['dine-in', 'takeaway', 'delivery']

export function defaultPosConfig() {
  const ai_weights = {}
  for (const key of AI_STRATEGIES) ai_weights[key] = 0
  return {
    service_enabled: false,
    service_type: 'percentage',
    service_value: 0,
    service_dine_in: true,
    service_takeaway: false,
    service_delivery: false,
    tax_enabled: false,
    tax_rate: 0,
    card_surcharge_enabled: false,
    card_credit_pct: 0,
    card_debit_pct: 0,
    card_other_pct: 0,
    ai_enabled: false,
    ai_weights,
    favorites: [],
    featured: [],
  }
}

export function canConfigurePos(role) {
  return role === 'cliente' || role === 'gerente' || role === 'admin' || role === 'jbm'
}

export function favoriteKey(product) {
  if (!product?.id) return ''
  return `${product.kind || 'drink'}:${product.id}`
}

export function priceOf(product) {
  const raw = product?.preco_venda ?? product?.preco_drink
  const price = Number(raw)
  return Number.isFinite(price) ? Math.round(price) : NaN
}

/** Empty string means the product can be sold. */
export function productProblem(product) {
  if (!product?.id) return 'missing'
  if (product.ativo === false || product.disponivel === false) return 'inactive'
  const price = priceOf(product)
  if (!Number.isFinite(price) || price <= 0) return 'no-price'
  return ''
}

function fold(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '')
}

export function productCodes(product) {
  const nested = product?.produtos || {}
  return [product?.sku, product?.codigo, product?.code, product?.barcode, product?.ean, nested.sku, nested.codigo, nested.code, nested.barcode, nested.ean]
    .map(value => String(value || '').trim())
    .filter(Boolean)
}

export function productNames(product) {
  const nested = product?.produtos || {}
  return [product?.nome, product?.nome_ja, product?.nome_en, product?.name_ja, product?.name_en, nested.nome, nested.nome_ja, nested.nome_en]
    .map(value => String(value || '').trim())
    .filter(Boolean)
}

function fuzzyName(name, query) {
  if (query.length < 3) return false
  const text = fold(name)
  if (!text) return false
  if (text.includes(query)) return true
  let hit = 0
  for (const ch of text) {
    if (ch === query[hit]) hit += 1
    if (hit === query.length) return true
  }
  return hit >= query.length - 1 && query.length >= 4
}

/** One box. Name, Japanese name, English name, SKU and barcode together. */
export function searchProducts(catalog = [], query = '') {
  const needle = fold(query)
  if (!needle) return []
  const hits = []
  for (const product of catalog) {
    const codes = productCodes(product).map(fold)
    const names = productNames(product)
    const exactCode = codes.some(code => code === needle)
    const codeHit = exactCode || codes.some(code => code.includes(needle))
    const nameHit = names.some(name => fold(name).includes(needle) || fuzzyName(name, needle))
    if (!codeHit && !nameHit) continue
    hits.push({ product, rank: exactCode ? 0 : codeHit ? 1 : 2 })
  }
  hits.sort((a, b) => a.rank - b.rank || String(productNames(a.product)[0] || '').localeCompare(String(productNames(b.product)[0] || '')))
  return hits.map(row => row.product)
}

export function favoriteProducts(catalog = [], keys = []) {
  const byKey = new Map(catalog.map(product => [favoriteKey(product), product]))
  return (keys || []).map(key => byKey.get(key)).filter(Boolean)
}

export function configFromRow(row) {
  const base = defaultPosConfig()
  if (!row) return base
  const weights = { ...base.ai_weights }
  const incoming = row.ai_weights && typeof row.ai_weights === 'object' ? row.ai_weights : {}
  for (const key of AI_STRATEGIES) {
    const value = Number(incoming[key])
    weights[key] = Number.isFinite(value) && value > 0 ? value : 0
  }
  return {
    ...base,
    service_enabled: row.service_enabled === true,
    service_type: row.service_type === 'fixed' ? 'fixed' : 'percentage',
    service_value: Math.max(0, Number(row.service_value) || 0),
    service_dine_in: row.service_dine_in !== false,
    service_takeaway: row.service_takeaway === true,
    service_delivery: row.service_delivery === true,
    tax_enabled: row.tax_enabled === true,
    tax_rate: Math.max(0, Number(row.tax_rate) || 0),
    card_surcharge_enabled: row.card_surcharge_enabled === true,
    card_credit_pct: Math.max(0, Number(row.card_credit_pct) || 0),
    card_debit_pct: Math.max(0, Number(row.card_debit_pct) || 0),
    card_other_pct: Math.max(0, Number(row.card_other_pct) || 0),
    ai_enabled: row.ai_enabled === true,
    ai_weights: weights,
    favorites: Array.isArray(row.favorites) ? row.favorites.map(String) : [],
    featured: Array.isArray(row.featured) ? row.featured.map(String) : [],
  }
}

export function configToRow(barId, config) {
  const next = configFromRow(config)
  return { bar_id: barId, ...next }
}

/** Weights are shares. Zero stays zero. The rest is scaled to 1. */
export function normalizeWeights(weights = {}) {
  const clean = {}
  let sum = 0
  for (const key of AI_STRATEGIES) {
    const value = Math.max(0, Number(weights[key]) || 0)
    clean[key] = value
    sum += value
  }
  if (sum <= 0) return clean
  for (const key of AI_STRATEGIES) clean[key] = clean[key] / sum
  return clean
}

function surchargePct(method, config) {
  if (method === 'credit') return config.card_credit_pct
  if (method === 'card') return config.card_debit_pct
  if (method === 'other') return config.card_other_pct
  return 0
}

function serviceApplies(config, servicePoint) {
  if (servicePoint === 'takeaway') return config.service_takeaway
  if (servicePoint === 'delivery') return config.service_delivery
  return config.service_dine_in
}

/**
 * Service is on the drink subtotal.
 * Tax is on the drink subtotal, not on service and not on the surcharge.
 * Card surcharge is once, on subtotal + service + tax.
 * Cash never gets a card surcharge.
 */
export function quoteSale({ subtotal = 0, method = 'cash', config = {}, servicePoint = 'dine-in' } = {}) {
  const base = Math.round(Number(subtotal) || 0)
  if (base < 0) return { ok: false, error: 'bad-total', subtotal: base, service: 0, tax: 0, surcharge: 0, total: 0 }
  const cfg = configFromRow(config)
  let service = 0
  if (cfg.service_enabled && serviceApplies(cfg, servicePoint)) {
    service = cfg.service_type === 'fixed'
      ? Math.round(cfg.service_value)
      : Math.round(base * (cfg.service_value / 100))
  }
  const tax = cfg.tax_enabled ? Math.round(base * (cfg.tax_rate / 100)) : 0
  let surcharge = 0
  if (cfg.card_surcharge_enabled) {
    const pct = Math.max(0, surchargePct(method, cfg))
    surcharge = Math.round((base + service + tax) * (pct / 100))
  }
  const total = base + service + tax + surcharge
  return { ok: true, subtotal: base, service, tax, surcharge, total, method }
}

export function paymentProblem({ method, lineCount = 0, quote, charging = false } = {}) {
  if (charging) return 'busy'
  if (!lineCount) return 'empty'
  if (!method) return 'no-method'
  if (!quote?.ok) return 'bad-total'
  if (quote.total !== quote.subtotal + quote.service + quote.tax + quote.surcharge) return 'bad-total'
  if (quote.service < 0 || quote.tax < 0 || quote.surcharge < 0) return 'bad-total'
  return ''
}

export function recommendationReason(signals = []) {
  if (signals.includes('featured')) return 'Featured by your manager.'
  if (signals.includes('bestsellers')) return 'Recommended because it sells often at this bar.'
  if (signals.includes('profit')) return 'Recommended because this bar prioritizes high-margin products.'
  if (signals.includes('customer')) return 'Recommended because it matches this guest.'
  if (signals.includes('new')) return 'Recommended because it is new on this menu.'
  if (signals.includes('slow')) return 'Recommended because this bar wants to move it.'
  if (signals.includes('premium') || signals.includes('quality')) return 'Recommended because this bar prioritizes a premium drink.'
  return ''
}

/**
 * Recommend only products that are already on this bar's menu.
 * No sales history means no "best seller" claim.
 */
export function recommendProducts({ catalog = [], config = {}, cartKeys = [], sales = {}, guestText = '', now = Date.now() } = {}) {
  const cfg = configFromRow(config)
  if (!cfg.ai_enabled) return []
  const weights = normalizeWeights(cfg.ai_weights)
  const featured = new Set(cfg.featured || [])
  const inCart = new Set(cartKeys)
  const sellable = (catalog || []).filter(product => !productProblem(product) && !inCart.has(favoriteKey(product)))
  const prices = sellable.map(priceOf).filter(price => price > 0)
  const maxPrice = Math.max(1, ...prices, 1)
  const hasSales = sales && Object.keys(sales).length > 0
  const guest = fold(guestText)
  const rows = []
  for (const product of sellable) {
    const key = favoriteKey(product)
    const signals = []
    let score = 0
    if (featured.has(key) && weights.promote > 0) {
      score += weights.promote
      signals.push('featured')
    }
    const sold = Number(sales[key]) || 0
    if (weights.bestsellers > 0 && hasSales && sold > 0) {
      score += weights.bestsellers * Math.min(1, sold / 10)
      signals.push('bestsellers')
    }
    if (weights.slow > 0 && hasSales && sold === 0) {
      score += weights.slow * 0.5
      signals.push('slow')
    }
    const price = priceOf(product)
    const cost = Number(product.custo ?? product.produtos?.custo)
    if (weights.profit > 0 && Number.isFinite(cost) && price > cost) {
      score += weights.profit * Math.min(1, (price - cost) / price)
      signals.push('profit')
    }
    if (weights.premium > 0 && price / maxPrice >= 0.7) {
      score += weights.premium * (price / maxPrice)
      signals.push('premium')
    }
    if (weights.quality > 0 && price / maxPrice >= 0.5) {
      score += weights.quality * 0.5
      signals.push('quality')
    }
    const created = Date.parse(product.criado_em || product.created_at || '')
    if (weights.new > 0 && Number.isFinite(created) && now - created < 1000 * 60 * 60 * 24 * 30) {
      score += weights.new
      signals.push('new')
    }
    if (weights.customer > 0 && guest && productNames(product).concat(product.categoria || '').some(part => fold(part) && guest.includes(fold(part)))) {
      score += weights.customer
      signals.push('customer')
    }
    if (score > 0 && signals.length) rows.push({ product, score, signals, reason: recommendationReason(signals) })
  }
  rows.sort((a, b) => b.score - a.score || String(productNames(a.product)[0] || '').localeCompare(String(productNames(b.product)[0] || '')))
  return rows.slice(0, 4)
}

/** Future analytics can append these. Nothing is sent anywhere yet. */
export function posEvent(name, detail = {}) {
  return { name, at: Date.now(), ...detail }
}
