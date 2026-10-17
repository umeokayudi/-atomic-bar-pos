/**
 * Reads/writes for customers "on account" (see onAccount.js for the rules).
 * The ledger goes through the bar live store (/api/bar/live-db → api/_barLiveStore.js); with no Postgres
 * table it is kept in the bar's private JSON store. Rows that could not be saved wait in a per-device
 * queue and are replayed (upsert by id, so never twice).
 */

import { LEDGER_TABLE, queueRows } from './onAccount.js'

export const CRM_COLUMNS = 'id,nome,line_id,telefone,vip_member_id,tags,ativo'

export async function loadCrmGuests(supabase, barId) {
  const { data, error } = await supabase.from('bar_guests').select(CRM_COLUMNS).eq('bar_id', barId).eq('ativo', true).order('nome')
  if (error) throw new Error(error.message || 'CRM not available')
  return data || []
}

/** Add someone to the CRM from the till (same insert as the guest book), tagged as a regular. */
export async function addCrmGuest(supabase, barId, nome) {
  const name = String(nome || '').trim()
  if (!name) throw new Error('name required')
  const { data, error } = await supabase.from('bar_guests')
    .insert({ bar_id: barId, nome: name, tags: ['regular'], ativo: true, atualizado_em: new Date().toISOString() })
    .select(CRM_COLUMNS).single()
  if (error || !data) throw new Error(error?.message || 'Could not add the customer')
  return data
}

export async function loadLedger(supabase, barId) {
  const { data, error } = await supabase.from(LEDGER_TABLE).select('*').eq('bar_id', barId).order('criado_em', { ascending: false })
  if (error) throw new Error(error.message || 'ledger not available')
  return data || []
}

export async function saveLedgerRows(supabase, rows = []) {
  if (!rows.length) return []
  const { data, error } = await supabase.from(LEDGER_TABLE).upsert(rows).select('*')
  if (error) throw new Error(error.message || 'ledger not saved')
  return data || rows
}

const queueKey = barId => `pos-onaccount-queue:${barId}`

export function readQueue(barId) {
  try { return JSON.parse(localStorage.getItem(queueKey(barId))) || [] } catch { return [] }
}

function writeQueue(barId, rows) {
  try {
    if (rows.length) localStorage.setItem(queueKey(barId), JSON.stringify(rows))
    else localStorage.removeItem(queueKey(barId))
  } catch { /* private mode */ }
}

/** Save rows now; whatever fails stays queued on this device. Returns { saved, pending }. */
export async function recordLedger(supabase, barId, rows = []) {
  const all = queueRows(readQueue(barId), rows)
  if (!all.length) return { saved: 0, pending: 0 }
  try {
    await saveLedgerRows(supabase, all)
    writeQueue(barId, [])
    return { saved: all.length, pending: 0 }
  } catch {
    writeQueue(barId, all)
    return { saved: 0, pending: all.length }
  }
}

/** Link a closed sale to its CRM customer (best effort, like the classic till). */
export function linkSaleToGuest(supabase, vendaId, guestId) {
  if (!vendaId || !guestId) return Promise.resolve()
  return supabase.from('pos_vendas').update({ guest_id: guestId }).eq('id', vendaId).then(() => {}, () => {})
}
