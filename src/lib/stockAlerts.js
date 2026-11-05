/**
 * ONE low-stock number. The bar's Stock screen, the bar Dashboard tile, the HQ snapshot and the AI all build
 * the list here, from the same inputs (stock moves + JBM delivery notes + till pours + per-bar minimums),
 * and count the same rows. Archived and test products (e.g. TESTE-MUSE) never appear in it.
 */
import { attentionFirst, coalesceStockMoves, decorateStockList, deliveryNoteMoves, posPourMoves } from './barStock.js'
import { fetchAllStockMovements } from './posSupply.js'
import { filterSupplierVendas } from './supplierVenda.js'
import { isArchivedOrTest } from './catalog.js'

// Same lists as src/components/utils.jsx (kept here so the server can use them).
const SUPPLIER_CATEGORIES = ['Water', 'Soda', 'Juice', 'Energy Drink', 'Beer', 'Sake', 'Shochu', 'Vodka', 'Gin', 'Tequila', 'Whisky', 'Japanese Whisky', 'Spirits', 'Champagne', 'Wine', 'Others']

export function isStockProduct(p) {
  if (!p || isArchivedOrTest(p)) return false
  return SUPPLIER_CATEGORIES.includes(p.categoria)
}

/** Everything the stock list needs for one bar, read with any Supabase client (user or server). */
export async function loadBarStockInputs(db, barId) {
  const [movimentos, pR, rR, vR, pourR, priceR] = await Promise.all([
    fetchAllStockMovements(db, barId, '*').catch(() => []),
    db.from('produtos_public').select('*').eq('ativo', true).order('categoria').order('nome'),
    db.from('estoque_regras').select('*').eq('bar_id', barId),
    db.from('vendas').select('*, vendas_itens(*, produtos(id,nome))').eq('bar_id', barId).order('data', { ascending: false }),
    db.from('pos_vendas_itens').select('produto_id,nome,qtd,pos_venda_id'),
    db.from('bar_pricing').select('produto_id,drinks_por_garrafa').eq('bar_id', barId),
  ])
  const pricing = {}
  for (const r of priceR?.data || []) pricing[r.produto_id] = { drinks_por_garrafa: +r.drinks_por_garrafa || 0 }
  const regras = {}
  for (const r of rR?.data || []) regras[r.produto_id] = r.minimo
  return {
    produtos: (pR?.data || []).filter(isStockProduct),
    movimentos: movimentos || [],
    regras,
    notes: filterSupplierVendas(vR?.data || []),
    pours: pourR?.data || [],
    pricing,
    ok: !rR?.error,
  }
}

export function buildStockList({ produtos = [], movimentos = [], regras = {}, notes = [], pours = [], pricing = {} } = {}) {
  const moves = coalesceStockMoves(movimentos, deliveryNoteMoves(notes), posPourMoves(pours, pricing))
  return { moves, list: decorateStockList((produtos || []).filter(isStockProduct), moves, regras) }
}

/** Products that need attention (out, under minimum, or counted and empty), most urgent first. */
export function stockAlerts(list = []) {
  return attentionFirst((list || []).filter(p => p.hasCount && p.attention && !isArchivedOrTest(p)))
}

/** Compact rows for the dashboard tile, the HQ snapshot and the AI. */
export function stockAlertRows(list = []) {
  return stockAlerts(list).map(p => ({ id: p.id, nome: p.nome, qtd: p.stock, minimo: p.minimo }))
}

export async function loadBarStockAlerts(db, barId) {
  const inputs = await loadBarStockInputs(db, barId)
  const { list } = buildStockList(inputs)
  return { rows: stockAlertRows(list), ok: inputs.ok }
}
