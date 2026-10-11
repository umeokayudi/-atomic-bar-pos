/** Staff NFC punch cards. Only a hash of the card UID is stored (staff_extras.nfc_uid_hash). */

import { hashSecret } from './_hash.js'
import { runLiveOp } from './_barLiveStore.js'
import { normalizeNfcUid } from '../src/lib/nfcCard.js'

export function nfcUidHash(raw) {
  const uid = normalizeNfcUid(raw)
  return uid ? hashSecret(`nfc:${uid}`) : ''
}

/** Staff ids whose card matches. Callers keep only the ones in their bar. */
export async function staffIdsForNfc(db, raw) {
  const hash = nfcUidHash(raw)
  if (!hash) return []
  const extras = await runLiveOp(db, { table: 'staff_extras', mode: 'select', columns: '*' })
  return (extras.data || []).filter(r => r.nfc_uid_hash === hash).map(r => r.id)
}

/** Staff ids (any bar) that already have a card linked. */
export async function staffIdsWithNfc(db) {
  const extras = await runLiveOp(db, { table: 'staff_extras', mode: 'select', columns: '*' })
  return new Set((extras.data || []).filter(r => r.nfc_uid_hash).map(r => r.id))
}
