/**
 * Web push to the owner's phone (the home-screen app). No SQL and no Vercel setting needed:
 *  - push/vapid.json   the server's key pair, made on first use (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env win if set)
 *  - push/subs.json    one row per phone: endpoint + keys, login, bar, language and on/off per kind
 *  - push/style-<bar>.json  the bar's message style (tone, emoji, congratulations, own texts)
 * all in the private storage bucket, read and written only with the service role.
 */
import webpush from 'web-push'
import { deflateSync } from 'node:zlib'
import { runLiveOp, LIVE_BUCKET } from './_barLiveStore.js'
import { brandColorOf, cleanLogo } from '../src/lib/barBrand.js'
import { cleanPrefs, cleanStyle, cleanVars, renderPush, typeOf } from '../src/lib/pushTemplates.js'

const DIR = 'push/'
const SUBJECT = 'https://jbmtech.vercel.app'
const mem = new Map()

async function readJson(admin, path, fallback) {
  const hit = mem.get(path)
  if (hit && Date.now() - hit.at < 15_000) return hit.value
  try {
    const { data, error } = await admin.storage.from(LIVE_BUCKET).download(DIR + path)
    if (error || !data) return hit?.value ?? fallback
    const value = JSON.parse(await data.text())
    mem.set(path, { at: Date.now(), value })
    return value
  } catch {
    return hit?.value ?? fallback
  }
}

async function writeJson(admin, path, value) {
  mem.set(path, { at: Date.now(), value })
  const { error } = await admin.storage.from(LIVE_BUCKET).upload(DIR + path, Buffer.from(JSON.stringify(value)), {
    upsert: true, contentType: 'application/json', cacheControl: '0',
  })
  if (error) throw new Error(error.message)
}

export async function vapidKeys(admin) {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
  }
  mem.delete('vapid.json')
  const saved = await readJson(admin, 'vapid.json', null)
  if (saved?.publicKey && saved?.privateKey) return saved
  const keys = webpush.generateVAPIDKeys()
  await writeJson(admin, 'vapid.json', { ...keys, created_at: new Date().toISOString() })
  return keys
}

// ---------- phones ----------

async function loadSubs(admin, fresh = false) {
  if (fresh) mem.delete('subs.json')
  const v = await readJson(admin, 'subs.json', { rows: [] })
  return Array.isArray(v?.rows) ? v.rows : []
}
const saveSubs = (admin, rows) => writeJson(admin, 'subs.json', { rows, updated_at: new Date().toISOString() })

function cleanSubscription(raw) {
  const endpoint = String(raw?.endpoint || '')
  const p256dh = String(raw?.keys?.p256dh || '')
  const auth = String(raw?.keys?.auth || '')
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !p256dh || !auth) return null
  return { endpoint, keys: { p256dh: p256dh.slice(0, 200), auth: auth.slice(0, 100) } }
}

export async function saveSubscription(admin, actor, { subscription, prefs, lang }) {
  const sub = cleanSubscription(subscription)
  if (!sub) throw Object.assign(new Error('Invalid subscription'), { status: 400 })
  const rows = await loadSubs(admin, true)
  const old = rows.find(r => r.endpoint === sub.endpoint)
  const row = {
    ...sub,
    id: old?.id || globalThis.crypto.randomUUID(),
    user_id: actor.user?.id || actor.perfil?.id || null,
    nome: actor.perfil?.nome || actor.perfil?.email || '',
    role: actor.perfil?.role || '',
    bar_id: actor.perfil?.role === 'admin' ? null : (actor.perfil?.bar_id || null),
    lang: lang === 'ja' ? 'ja' : 'en',
    prefs: cleanPrefs(prefs ?? old?.prefs),
    created_at: old?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  await saveSubs(admin, [...rows.filter(r => r.endpoint !== sub.endpoint), row])
  return publicRow(row)
}

export async function removeSubscription(admin, endpoint) {
  const rows = await loadSubs(admin, true)
  const next = rows.filter(r => r.endpoint !== endpoint)
  if (next.length !== rows.length) await saveSubs(admin, next)
  return rows.length - next.length
}

export async function findSubscription(admin, endpoint) {
  const rows = await loadSubs(admin, true)
  const row = rows.find(r => r.endpoint === endpoint)
  return row ? publicRow(row) : null
}

const publicRow = r => ({ id: r.id, prefs: r.prefs, lang: r.lang, bar_id: r.bar_id, role: r.role, nome: r.nome })

// ---------- bar look + style ----------

export async function loadStyle(admin, barId) {
  return cleanStyle(await readJson(admin, `style-${barId || 'hq'}.json`, null))
}
export async function saveStyle(admin, barId, style) {
  const clean = cleanStyle(style)
  await writeJson(admin, `style-${barId || 'hq'}.json`, clean)
  return clean
}

export async function loadBarLook(admin, barId) {
  if (!barId) return { name: 'JBM', color: '#13201d', logo: '' }
  let bar = null
  try {
    const { data } = await admin.from('bars').select('*').eq('id', barId).maybeSingle()
    bar = data || null
  } catch { bar = null }
  let marca = null
  try {
    const r = await runLiveOp(admin, { table: 'bar_brand', mode: 'select', columns: '*', filters: [{ op: 'eq', k: 'id', v: barId }], wantSingle: 'maybe' })
    marca = r?.data || null
  } catch { marca = null }
  const full = { ...(bar || { id: barId }), marca }
  return {
    name: String(bar?.nome || 'JBM').trim(),
    color: brandColorOf(full) || '#13201d',
    logo: cleanLogo(marca?.logo) || cleanLogo(bar?.logo_url || bar?.logo),
  }
}

/** A short version tag so a new logo or colour gets a new icon address (phones cache icons). */
function lookTag(look) {
  let h = 0
  const s = `${look.color}|${look.logo.length}|${look.logo.slice(-64)}`
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

// ---------- icon: the bar's logo, or a circle in the bar's colour ----------

function crc32(buf) {
  let c, crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** 192 px PNG: a disc in the bar's colour with a thin white ring, transparent corners. */
export function colorDiscPng(hex, size = 192) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')) || [0, '13201d']
  const [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16))
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const c = (size - 1) / 2
  const R = size / 2 - 1
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c)
      const o = y * (size * 4 + 1) + 1 + x * 4
      const alpha = Math.max(0, Math.min(1, R - d + 0.5))
      const ring = d > R * 0.8 && d < R * 0.86
      raw[o] = ring ? 255 : r
      raw[o + 1] = ring ? 255 : g
      raw[o + 2] = ring ? 255 : b
      raw[o + 3] = Math.round(alpha * 255)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}

export async function barIcon(admin, barId) {
  const look = await loadBarLook(admin, barId)
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(look.logo || '')
  if (m) return { type: m[1], body: Buffer.from(m[2], 'base64') }
  if (/^https:\/\//.test(look.logo)) return { redirect: look.logo }
  return { type: 'image/png', body: colorDiscPng(look.color) }
}

// ---------- sending ----------

const recent = new Map()
function seen(key) {
  if (!key) return false
  const now = Date.now()
  for (const [k, at] of recent) if (now - at > 10 * 60_000) recent.delete(k)
  if (recent.has(key)) return true
  recent.set(key, now)
  return false
}

function recipients(rows, barId, type, onlyEndpoint) {
  if (onlyEndpoint) return rows.filter(r => r.endpoint === onlyEndpoint)
  return rows.filter(r => r.prefs?.[type] !== false && (r.role === 'admin' || (barId && r.bar_id === barId)))
}

/**
 * Sends one event to every phone that wants it: the bar's owner/manager phones and JBM admin phones.
 * Never throws: a failed push must not break the punch, the order or the close that caused it.
 */
export async function sendPushEvent(admin, { barId, type, vars, key, onlyEndpoint, styleOverride, timeoutMs = 4000, agent }) {
  try {
    if (!admin || !typeOf(type)) return { sent: 0, skipped: 'type' }
    if (seen(key ? `${barId}:${type}:${key}` : '')) return { sent: 0, skipped: 'duplicate' }
    const rows = await loadSubs(admin)
    const targets = recipients(rows, barId, type, onlyEndpoint)
    if (!targets.length) return { sent: 0 }
    const [keys, look, style] = await Promise.all([vapidKeys(admin), loadBarLook(admin, barId), styleOverride ? cleanStyle(styleOverride) : loadStyle(admin, barId)])
    const clean = cleanVars(type, vars)
    const icon = `/api/bar/push?action=icon&bar=${encodeURIComponent(barId || '')}&v=${lookTag(look)}`
    const gone = []
    let sent = 0
    await Promise.all(targets.map(async sub => {
      const msg = renderPush({ type, vars: clean, lang: sub.lang, style, barName: look.name })
      const payload = JSON.stringify({
        title: msg.title,
        body: msg.body,
        icon,
        badge: '/icons/badge-96.png',
        color: look.color,
        tag: `${type}-${barId || 'hq'}-${key || Date.now()}`,
        url: urlFor(type),
        type,
      })
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, {
          TTL: 24 * 3600,
          urgency: 'high',
          timeout: timeoutMs,
          ...(agent ? { agent } : {}),
          vapidDetails: { subject: SUBJECT, publicKey: keys.publicKey, privateKey: keys.privateKey },
        })
        sent++
      } catch (e) {
        if (e?.statusCode === 404 || e?.statusCode === 410) gone.push(sub.endpoint)
      }
    }))
    if (gone.length) {
      const fresh = await loadSubs(admin, true)
      await saveSubs(admin, fresh.filter(r => !gone.includes(r.endpoint))).catch(() => null)
    }
    return { sent, removed: gone.length }
  } catch (e) {
    return { sent: 0, error: e.message }
  }
}

/** Where a tap on the notification opens. */
export function urlFor(type) {
  // A new order opens the Bar queue (the drinks to make); a sale opens the till.
  if (type === 'order') return '/bar/bar'
  if (type === 'sale') return '/bar/pos'
  if (type === 'clock_in' || type === 'clock_out') return '/bar/ponto'
  if (type === 'shift_close' || type === 'day_close') return '/bar/fechamento'
  if (type === 'invoice_new' || type === 'payment') return '/bar/faturas'
  return '/'
}

/** Waits at most `ms` so a slow push service never holds the response that triggered it. */
export function pushSoon(promise, ms = 3500) {
  return Promise.race([promise, new Promise(r => setTimeout(() => r({ sent: 0, skipped: 'timeout' }), ms))])
}
