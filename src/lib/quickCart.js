/** Small cart for staff ordering from their own panel. Same line shape as the till (PosQuick). */
import { resolveItemPrice } from './atomicPos.js'

export function cartAdd(cart = [], item) {
  const hit = cart.find(line => line.key === item.key)
  if (hit) return cart.map(line => (line.key === item.key ? { ...line, qtd: line.qtd + 1 } : line))
  const price = resolveItemPrice(item, 'regular', null)
  return [...cart, {
    key: item.key,
    kind: item.kind,
    drink_menu_id: item.kind === 'drink' ? item.id : null,
    produto_id: item.kind === 'shot' ? item.id : null,
    nome: item.nome,
    categoria: item.categoria,
    qtd: 1,
    ...price,
    preco_unitario: price.preco,
  }]
}

export function cartBump(cart = [], key, delta) {
  return cart.map(line => (line.key === key ? { ...line, qtd: line.qtd + delta } : line)).filter(line => line.qtd > 0)
}

export function cartTotals(cart = []) {
  return cart.reduce((a, line) => ({ items: a.items + line.qtd, total: a.total + line.qtd * (+line.preco_unitario || 0) }), { items: 0, total: 0 })
}
