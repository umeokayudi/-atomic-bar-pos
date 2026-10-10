/**
 * One sale, one server transaction (public.pos_commit_sale in sql/floor_comandas.sql):
 * sale + lines + stock moves + discount/VIP usage + tab close commit together or not at all,
 * and the same key never creates two sales (double tap, retry after a timeout, two devices).
 *
 * Until that migration is applied the till falls back to the old multi-step commit
 * (atomicPos.commitPosSale), guarded by a per-device key ledger so a double tap still cannot
 * write twice from this device.
 */

import { cartTotal, commitPosSale, lineUnitPrice } from './atomicPos.js'
import { bottlesConsumedFromCart } from './posSupply.js'
import { isMissingRpc, newKey } from './comandas.js'

export const CHARGE_TYPES = ['set', 'nominho', 'service', 'room_min']

export function newSaleKey() {
  return newKey('sale')
}

/** Build the RPC arguments from a till cart (drink lines + charge lines). Pure. */
export function buildSaleArgs({ barId, cart, payMethod = 'Cash', tipo = null, obs = '', agentId = null, spaceId = null,
  vipId = null, codeId = null, commission = null, comandaId = null, pricingByProduto = {} }) {
  const items = (cart || []).map(it => ({
    drink_menu_id: it.drink_menu_id || null,
    produto_id: it.produto_id || null,
    nome: it.nome,
    qtd: +it.qtd || 1,
    preco_unitario: lineUnitPrice(it),
    preco_lista: it.preco_lista ?? lineUnitPrice(it),
    tipo_preco: it.tipo_preco || 'regular',
    desconto_valor: +it.desconto_valor || 0,
  }))
  const total = Math.round(cartTotal(cart))
  const subtotal = Math.round((cart || []).reduce((a, it) => a + (+it.preco_lista || lineUnitPrice(it)) * (+it.qtd || 1), 0))
  const bottles = bottlesConsumedFromCart((cart || []).filter(it => !CHARGE_TYPES.includes(it.tipo_preco)), pricingByProduto)
  return {
    sale: {
      bar_id: barId,
      total,
      subtotal,
      desconto_total: Math.max(0, subtotal - total),
      metodo_pagamento: payMethod,
      tipo: tipo || (vipId ? 'vip' : codeId ? 'desconto' : 'balcao'),
      obs: String(obs || '').trim() || null,
      drink_back_agent_id: agentId || null,
      space_id: spaceId || null,
      vip_member_id: vipId || null,
      discount_code_id: codeId || null,
      comissao_valor: commission == null ? 0 : Math.round(+commission || 0),
      comanda_id: comandaId || null,
    },
    items,
    stock: Object.entries(bottles).map(([produto_id, qtd]) => ({ produto_id, qtd })),
  }
}

const LEDGER = 'pos-sale-keys'
function readLedger() {
  try { return JSON.parse(localStorage.getItem(LEDGER)) || {} } catch { return {} }
}
function writeLedger(map) {
  try {
    const entries = Object.entries(map).slice(-200)
    localStorage.setItem(LEDGER, JSON.stringify(Object.fromEntries(entries)))
  } catch { /* private mode */ }
}

const inFlight = new Map()

/**
 * Commit a sale once. Returns { ok, vendaId, atomic, total } or { ok:false, error, conflict }.
 * Calling twice with the same key returns the first result (in memory, on this device, and on the server).
 */
export function commitSaleAtomic(supabase, opts) {
  const key = opts.key
  if (!key) return Promise.resolve({ ok: false, error: 'sale key required' })
  if (inFlight.has(key)) return inFlight.get(key)
  const run = (async () => {
    const done = readLedger()[key]
    if (done) return { ok: true, vendaId: done, atomic: true, replay: true }
    const args = buildSaleArgs(opts)
    const { data, error } = await supabase.rpc('pos_commit_sale', { p_key: key, p_sale: args.sale, p_items: args.items, p_stock: args.stock })
    if (!error) {
      writeLedger({ ...readLedger(), [key]: data })
      return { ok: true, vendaId: data, atomic: true, total: args.sale.total }
    }
    if (!isMissingRpc(error)) {
      return { ok: false, error: error.message, conflict: error.code === '40001' }
    }
    if (opts.comandaId) return { ok: false, error: 'server tabs need sql/floor_comandas.sql' }
    // Fallback: previous client-side commit (not atomic). Only for the counter cart.
    const legacy = await commitPosSale(supabase, { ...opts.legacy, cart: opts.cart })
    if (legacy.ok) writeLedger({ ...readLedger(), [key]: legacy.venda?.id || 'legacy' })
    return legacy.ok
      ? { ok: true, vendaId: legacy.venda?.id, atomic: false, total: legacy.total, stock: legacy.stock }
      : { ok: false, error: legacy.error, errorKey: legacy.errorKey }
  })()
  inFlight.set(key, run)
  run.finally(() => setTimeout(() => inFlight.delete(key), 0))
  return run
}
