import { useEffect, useState } from 'react'
import { staffFetch } from './apiAuth'
import { cleanAcessos } from './barAccess'

/**
 * This login's area list from "Users & access" (/api/bar-staff myAccess). The menu and /bar/<tab> routes use it;
 * the API checks the same list on its own. The owner never asks. The last answer is kept per tab session so a
 * reload does not flash menus the login cannot open.
 */
const KEY = 'bar-my-access'
let mem = null
let inflight = null

function readStored(uid) {
  try {
    const raw = sessionStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed && parsed.uid === uid) return parsed
  } catch { /* storage blocked */ }
  return null
}

function store(entry) {
  mem = entry
  try { sessionStorage.setItem(KEY, JSON.stringify(entry)) } catch { /* storage blocked */ }
}

export function forgetMyBarAccess() {
  mem = null
  inflight = null
  try { sessionStorage.removeItem(KEY) } catch { /* storage blocked */ }
}

function fetchMine(uid) {
  if (inflight) return inflight
  inflight = staffFetch('/api/bar-staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'myAccess' }),
  })
    .then(r => r.json().catch(() => ({})).then(j => ({ ok: r.ok, j })))
    .then(({ ok, j }) => {
      if (!ok || j?.error) return mem
      const entry = { uid, acessos: cleanAcessos(j.acessos), disabled: !!j.disabled }
      store(entry)
      return entry
    })
    .catch(() => mem)
    .finally(() => { inflight = null })
  return inflight
}

/** { acessos: string[] | null, disabled, ready } for the signed-in bar login. */
export function useMyBarAccess(perfil) {
  const uid = perfil?.id || ''
  const owner = perfil?.role === 'cliente'
  const [entry, setEntry] = useState(() => (owner ? null : (mem?.uid === uid ? mem : readStored(uid))))

  useEffect(() => {
    if (owner || !uid) return undefined
    let alive = true
    fetchMine(uid).then(e => { if (alive && e) setEntry(e) })
    return () => { alive = false }
  }, [uid, owner])

  if (owner) return { acessos: null, disabled: false, ready: true }
  return { acessos: entry?.acessos ?? null, disabled: !!entry?.disabled, ready: !!entry }
}
