/** Till catalog: build, search and favourites. Pure, unit tested in scripts/redesign.test.mjs. */

export function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

/** drink_menu rows + JBM shots → one list of sellable items with a stable key. Items without a price are left out. */
export function buildCatalog(drinks = [], shots = []) {
  return [
    ...drinks.map(d => ({
      key: `d-${d.id}`, id: d.id, kind: 'drink', nome: d.nome, categoria: d.categoria || 'Other', codigo: d.codigo || '',
      preco_venda: +d.preco_venda || 0, preco_desconto: d.preco_desconto, imagem_url: d.imagem_url || null,
    })),
    ...shots.map(s => ({
      key: `p-${s.produto_id}`, id: s.produto_id, kind: 'shot', nome: s.produtos?.nome || s.nome || 'Shot',
      categoria: s.produtos?.categoria || 'Shots', codigo: s.codigo || '',
      preco_venda: +s.preco_drink || 0, preco_desconto: Math.round((+s.preco_drink || 0) * 0.5), imagem_url: s.produtos?.imagem_url || null,
    })),
  ].filter(item => item.preco_venda > 0)
}

/**
 * Search by code, name or category. Ranking: exact code, code prefix, name prefix, word prefix in name,
 * name contains, category contains. Several words must all match (e.g. "hi ball" or "gin tonic").
 */
export function searchCatalog(catalog = [], query = '') {
  const q = normalize(query)
  if (!q) return []
  const words = q.split(/\s+/).filter(Boolean)
  const scored = []
  for (const item of catalog) {
    const name = normalize(item.nome)
    const cat = normalize(item.categoria)
    const code = normalize(item.codigo)
    let score = 0
    if (code && code === q) score = 100
    else if (code && code.startsWith(q)) score = 80
    else if (name.startsWith(q)) score = 60
    else if (words.every(w => name.split(/[\s\-・/]+/).some(part => part.startsWith(w)))) score = 50
    else if (words.every(w => name.includes(w))) score = 40
    else if (words.every(w => name.includes(w) || cat.includes(w))) score = 20
    if (score) scored.push([score, item])
  }
  return scored.sort((a, b) => b[0] - a[0] || String(a[1].nome).localeCompare(String(b[1].nome))).map(([, item]) => item)
}

export function toggleFavorite(list = [], key) {
  return list.includes(key) ? list.filter(k => k !== key) : [...list, key]
}
