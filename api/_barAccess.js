/**
 * Server side of "Users & access": reads a login's area list and active flag (staff_extras live table,
 * keyed by perfis id or lane-login id) and answers area checks. The owner ('cliente') is never limited.
 */

import { runLiveOp } from './_barLiveStore.js'
import { canAccessAny, cleanAcessos, missingArea } from '../src/lib/barAccess.js'

const LIMITED_ROLES = new Set(['gerente', 'caixa', 'bar_staff'])

/** { acessos: string[] | null, disabled: boolean } for a resolved bar actor. Owners and non-bar roles: no limits. */
export async function loadActorAccess(db, perfil) {
  if (!perfil || !LIMITED_ROLES.has(perfil.role) || !perfil.id || !db) return { acessos: null, disabled: false }
  let extra = null
  try {
    const hit = await runLiveOp(db, {
      table: 'staff_extras',
      mode: 'select',
      columns: '*',
      filters: [{ op: 'eq', k: 'id', v: perfil.id }],
      wantSingle: 'maybe',
    })
    extra = hit?.data || null
  } catch {
    extra = null
  }
  const acessos = cleanAcessos(extra?.acessos)
  const disabled = perfil.ativo === false || extra?.ativo === false
  return { acessos, disabled }
}

/** Attach the access fields to the actor's perfil (in place) and return the actor. */
export async function withActorAccess(db, actor) {
  if (!actor?.perfil) return actor
  const access = await loadActorAccess(db, actor.perfil)
  actor.perfil.acessos = access.acessos
  actor.disabled = access.disabled
  return actor
}

/** Send 403 when the actor lacks one of the needed areas. Returns true when it answered. */
export function denyMissingArea(res, perfil, needs) {
  const missing = missingArea(perfil, needs)
  if (!missing) return false
  res.status(403).json({ error: 'This login has no access to this area', area: missing, code: 'area' })
  return true
}

export { canAccessAny }
