/**
 * Push notifications in the browser: turn them on for this phone, the on/off per kind, and the app's events.
 * The server side is /api/bar/push (api/_routePush.js). Everything here fails quietly: a missed push never
 * blocks the till, the close or an invoice.
 */
import { staffFetch } from './apiAuth'

const API = '/api/bar/push'

export function pushSupport() {
  if (typeof window === 'undefined') return { ok: false, reason: 'server' }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    return { ok: false, reason: ios && !standalone ? 'ios_home' : 'browser', ios, standalone }
  }
  return { ok: true, ios, standalone, permission: Notification.permission }
}

async function post(body) {
  const r = await staffFetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

function keyBytes(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

async function registration() {
  return navigator.serviceWorker.register('/sw.js', { scope: '/' })
}

/** This phone's subscription (null when push is off here). */
export async function currentSubscription() {
  if (!pushSupport().ok) return null
  const reg = await navigator.serviceWorker.getRegistration('/')
  return reg ? reg.pushManager.getSubscription() : null
}

/** Asks permission, subscribes this phone and saves it with its on/off per kind. */
export async function enablePush({ prefs, lang } = {}) {
  const sup = pushSupport()
  if (!sup.ok) throw new Error(sup.reason)
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('denied')
  const reg = await registration()
  await navigator.serviceWorker.ready
  const kr = await fetch(`${API}?action=key`)
  const { publicKey, error } = await kr.json()
  if (!publicKey) throw new Error(error || 'No key')
  let sub = await reg.pushManager.getSubscription()
  // A subscription made with another server key cannot receive: start over.
  const want = keyBytes(publicKey)
  const have = sub?.options?.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null
  if (sub && have && (have.length !== want.length || have.some((b, i) => b !== want[i]))) {
    await sub.unsubscribe().catch(() => null)
    sub = null
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want })
  const saved = await saveOnServer(sub, prefs, lang)
  return { sub, saved }
}

/** Saves the phone on the server and returns its row only when the server confirms it (else "on" would lie). */
async function saveOnServer(sub, prefs, lang) {
  const j = await post({ action: 'subscribe', subscription: sub.toJSON(), prefs, lang })
  if (!j?.sub?.id) throw new Error('not_saved')
  return j.sub
}

/**
 * On every app open: when this phone already allowed notifications, subscribe again quietly and save it on the
 * server (a phone the server lost, or a renewed subscription, keeps receiving). Never asks anything.
 */
export async function resyncPush(lang) {
  try {
    const sup = pushSupport()
    if (!sup.ok || Notification.permission !== 'granted') return null
    const { saved } = await enablePush({ lang })
    return saved
  } catch {
    return null
  }
}

const DISMISS_KEY = 'jbm_push_prompt_off'
export function promptDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
}
export function dismissPrompt() {
  try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* private mode */ }
}

export async function savePrefs(prefs, lang) {
  const sub = await currentSubscription()
  if (!sub) throw new Error('off')
  return saveOnServer(sub, prefs, lang)
}

export async function disablePush() {
  const sub = await currentSubscription()
  if (!sub) return
  await post({ action: 'unsubscribe', endpoint: sub.endpoint }).catch(() => null)
  await sub.unsubscribe().catch(() => null)
}

export async function mySubscription() {
  const sub = await currentSubscription()
  if (!sub) return null
  const j = await post({ action: 'mine', endpoint: sub.endpoint }).catch(() => ({ sub: null }))
  return j.sub
}

/** Test on this phone. Delivered to nobody → save the phone on the server again and try once more. */
export async function testPush(type, style, lang) {
  let sub = await currentSubscription()
  if (!sub) throw new Error('off')
  let r = await post({ action: 'test', type, style, endpoint: sub.endpoint })
  if (!r.sent) {
    await enablePush({ lang })
    sub = await currentSubscription()
    r = await post({ action: 'test', type, style, endpoint: sub.endpoint })
  }
  return r
}

export const loadPushStyle = barId => post({ action: 'style', bar_id: barId })
export const savePushStyle = (style, barId) => post({ action: 'saveStyle', style, bar_id: barId })
export const aiPushText = args => post({ action: 'ai', ...args })

/** Tells the server something happened (new order, night close, invoice…). Fire and forget. */
export function notifyPush(type, vars = {}, { key, barId } = {}) {
  try {
    post({ action: 'event', type, vars, key, bar_id: barId }).catch(() => null)
  } catch { /* never in the way */ }
}
