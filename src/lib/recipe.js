/**
 * Drink recipes: a list of ingredient lines kept in drink_menu.receita as plain text
 * ("Jose Cuervo 30ml + Cranberry 180ml + Lime (¥20)"), so no new column is needed.
 *
 * Line kinds:
 *  - 'jbm':   a bottle from the JBM catalogue; cost = bottle price / bottle ml × ml used
 *  - 'own':   a bottle bought elsewhere; "Name 20ml (¥800/1000ml)"
 *  - 'fixed': a fixed cost per drink (lime, garnish, ice); "Name (¥20)"
 */

const num = v => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9぀-ヿ一-鿿]/g, '')

/** The catalogue product a recipe word points to: exact name first, else the one product whose name contains it. */
export function matchProduct(name, produtos = []) {
  const key = norm(name)
  if (!key) return null
  const exact = produtos.find(p => norm(p.nome) === key)
  if (exact) return exact
  if (key.length < 3) return null
  const hits = produtos.filter(p => norm(p.nome).includes(key))
  if (hits.length === 1) return hits[0]
  // Several sizes of the same drink: take the shortest name (the plain one), only if all hits share it as a prefix.
  if (hits.length > 1) {
    const sorted = [...hits].sort((a, b) => norm(a.nome).length - norm(b.nome).length)
    const base = norm(sorted[0].nome)
    if (sorted.every(p => norm(p.nome).startsWith(base))) return sorted[0]
  }
  return null
}

export function lineFromProduct(p, ml = '') {
  return {
    kind: 'jbm', produto_id: p.id, nome: p.nome, ml: ml === '' ? '' : num(ml),
    bottlePrice: num(p.preco_venda), bottleMl: num(p.volume_ml) || '',
  }
}

/** Cost of one line in yen, or null when a price or size is still missing. */
export function lineCost(l) {
  if (!l) return null
  if (l.kind === 'fixed') return l.fixed === '' || l.fixed == null ? null : Math.round(num(l.fixed))
  const ml = num(l.ml), price = num(l.bottlePrice), size = num(l.bottleMl)
  if (!(ml > 0) || !(price > 0) || !(size > 0)) return null
  return Math.round(price / size * ml)
}

/** Total cost; complete=false when any line still has no price. */
export function recipeCost(lines = []) {
  let total = 0, complete = lines.length > 0
  for (const l of lines) {
    const c = lineCost(l)
    if (c == null) complete = false
    else total += c
  }
  return { total, complete }
}

const yen = n => '¥' + Math.round(num(n))

export function serializeRecipe(lines = []) {
  return lines
    .filter(l => String(l.nome || '').trim())
    .map(l => {
      const name = String(l.nome).trim().replace(/\s*\+\s*/g, ' & ')
      if (l.kind === 'fixed') return l.fixed === '' || l.fixed == null ? name : `${name} (${yen(l.fixed)})`
      const ml = num(l.ml) > 0 ? ` ${num(l.ml)}ml` : ''
      if (l.kind === 'own' && num(l.bottlePrice) > 0 && num(l.bottleMl) > 0) {
        return `${name}${ml} (${yen(l.bottlePrice)}/${num(l.bottleMl)}ml)`
      }
      return name + ml
    })
    .join(' + ')
}

/** Text recipe → lines. Words that match a catalogue product become 'jbm' lines with its price. */
export function parseRecipe(text, produtos = []) {
  return String(text || '')
    .split(/\s*\+\s*/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(part => {
      let m = part.match(/^(.*?)\s*\(\s*¥\s*([\d,.]+)\s*\)$/)
      if (m) return { kind: 'fixed', nome: m[1].trim(), fixed: num(m[2]) }
      m = part.match(/^(.*?)\s+([\d.]+)\s*ml(?:\s*\(\s*¥\s*([\d,.]+)\s*\/\s*([\d.]+)\s*ml\s*\))?$/i)
      if (m) {
        const [, nome, ml, price, size] = m
        if (price && size) return { kind: 'own', nome: nome.trim(), ml: num(ml), bottlePrice: num(price), bottleMl: num(size) }
        const p = matchProduct(nome, produtos)
        if (p) return lineFromProduct(p, num(ml))
        return { kind: 'own', nome: nome.trim(), ml: num(ml), bottlePrice: '', bottleMl: '' }
      }
      const p = matchProduct(part, produtos)
      if (p) return lineFromProduct(p)
      return { kind: 'fixed', nome: part, fixed: '' }
    })
}

/** Margin in % (0–100) or null. */
export function marginPct(price, cost) {
  const p = num(price)
  if (!(p > 0)) return null
  return Math.round((p - num(cost)) / p * 100)
}

/** Selling prices that reach the target margins, rounded up to ¥100 (¥50 under ¥1,000). */
export function suggestPrices(cost, targets = [70, 75, 80]) {
  const c = num(cost)
  if (!(c > 0)) return []
  const seen = new Set()
  return targets.map(target => {
    const raw = c / (1 - target / 100)
    const step = raw < 1000 ? 50 : 100
    const price = Math.ceil(raw / step) * step
    return { target, price, margin: marginPct(price, c) }
  }).filter(s => !seen.has(s.price) && seen.add(s.price))
}

export function marginTone(pct) {
  if (pct == null) return 'none'
  if (pct >= 75) return 'good'
  if (pct >= 60) return 'ok'
  return 'low'
}
