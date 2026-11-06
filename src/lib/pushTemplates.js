/**
 * Push notifications on the owner's phone: the kinds of events, the default texts and how a message is written.
 * Shared by the server (api/_push.js builds the message) and the screen (My account → Notifications shows a preview).
 * Pure helpers, tested in scripts/pushTemplates.test.mjs.
 *
 * A bar's message style (tone, emoji, "congratulations" on money events, its own texts) lives in the private
 * storage file push/style-<bar>.json; each phone keeps its own on/off switch per kind.
 */

/** Every kind of notification. `money` kinds get a "congratulations" when the amount is above zero. */
export const PUSH_TYPES = [
  { id: 'order', group: 'ops', money: false, vars: ['who', 'tab', 'items', 'amount'] },
  { id: 'clock_in', group: 'team', money: false, vars: ['who', 'time'] },
  { id: 'clock_out', group: 'team', money: false, vars: ['who', 'time', 'hours'] },
  { id: 'shift_close', group: 'close', money: true, vars: ['night', 'total', 'tickets', 'diff', 'who'] },
  { id: 'day_close', group: 'close', money: true, vars: ['day', 'total', 'tickets'] },
  { id: 'sale', group: 'money', money: true, vars: ['who', 'tab', 'amount', 'method'] },
  { id: 'invoice_new', group: 'money', money: true, vars: ['amount', 'due', 'period'] },
  { id: 'payment', group: 'money', money: true, vars: ['amount', 'who', 'what'] },
  { id: 'month_close', group: 'money', money: true, vars: ['month', 'total', 'tickets', 'best'] },
]
export const PUSH_TYPE_IDS = PUSH_TYPES.map(t => t.id)
export const typeOf = id => PUSH_TYPES.find(t => t.id === id) || null

export const TONES = ['party', 'neutral', 'short']

/** Default texts. {placeholders} are filled with the event's values; missing ones disappear. */
export const DEFAULT_TEXTS = {
  en: {
    party: {
      order: '{who} sent a new order: {items} item(s) · {amount} · {tab}',
      clock_in: '{who} started work at {time} 👋',
      clock_out: '{who} finished work at {time} · {hours}',
      shift_close: 'Night {night} closed: {total} in {tickets} ticket(s) · cash {diff}',
      day_close: 'Day {day} closed: {total} in {tickets} ticket(s)',
      sale: 'Sale of {amount} · {tab} · {method}',
      invoice_new: 'New invoice: {amount} · due {due}',
      payment: 'Payment of {amount} recorded · {what}',
      month_close: '{month} closed: {total} in {tickets} ticket(s) {best}',
    },
    neutral: {
      order: 'New order from {who}: {items} item(s), {amount} ({tab})',
      clock_in: '{who} clocked in at {time}',
      clock_out: '{who} clocked out at {time} ({hours})',
      shift_close: 'Night {night} closed. Sales {total}, {tickets} ticket(s), cash {diff}',
      day_close: 'Day {day} closed. Sales {total}, {tickets} ticket(s)',
      sale: 'Sale {amount} ({tab}, {method})',
      invoice_new: 'New invoice {amount}, due {due}',
      payment: 'Payment recorded: {amount} ({what})',
      month_close: 'Month {month} closed. Sales {total}, {tickets} ticket(s)',
    },
    short: {
      order: 'Order {amount} · {tab}',
      clock_in: 'In: {who} {time}',
      clock_out: 'Out: {who} {time}',
      shift_close: 'Night closed {total}',
      day_close: 'Day closed {total}',
      sale: 'Sale {amount}',
      invoice_new: 'Invoice {amount}',
      payment: 'Paid {amount}',
      month_close: '{month}: {total}',
    },
    congrats: { party: '🎉 Congratulations!', neutral: 'Well done.', short: '🎉' },
  },
  ja: {
    party: {
      order: '{who}さんから新しい注文：{items}点 · {amount} · {tab}',
      clock_in: '{who}さんが{time}に出勤しました 👋',
      clock_out: '{who}さんが{time}に退勤しました · {hours}',
      shift_close: '{night}の締め：売上{total}・{tickets}件・現金差額{diff}',
      day_close: '{day}の日次締め：売上{total}・{tickets}件',
      sale: '会計 {amount} · {tab} · {method}',
      invoice_new: '新しい請求書：{amount}・支払期限{due}',
      payment: '{amount}の支払いを記録しました · {what}',
      month_close: '{month}の月締め：売上{total}・{tickets}件 {best}',
    },
    neutral: {
      order: '新しい注文（{who}）：{items}点、{amount}（{tab}）',
      clock_in: '{who} 出勤 {time}',
      clock_out: '{who} 退勤 {time}（{hours}）',
      shift_close: '{night} 締め完了。売上{total}、{tickets}件、現金差額{diff}',
      day_close: '{day} 日次締め完了。売上{total}、{tickets}件',
      sale: '会計 {amount}（{tab}、{method}）',
      invoice_new: '新しい請求書 {amount}、期限{due}',
      payment: '支払い記録：{amount}（{what}）',
      month_close: '{month} 月締め。売上{total}、{tickets}件',
    },
    short: {
      order: '注文 {amount} · {tab}',
      clock_in: '出勤 {who} {time}',
      clock_out: '退勤 {who} {time}',
      shift_close: '締め {total}',
      day_close: '日次締め {total}',
      sale: '会計 {amount}',
      invoice_new: '請求書 {amount}',
      payment: '入金 {amount}',
      month_close: '{month}：{total}',
    },
    congrats: { party: '🎉 おめでとうございます！', neutral: 'お疲れさまでした。', short: '🎉' },
  },
}

export const DEFAULT_STYLE = { tone: 'party', emoji: true, congrats: true, texts: {}, congratsText: '' }
export const TEXT_MAX = 200

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{FE0F}\u{200D}]/gu

/** A style from storage or the form: only known keys, short texts, sane tone. */
export function cleanStyle(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}
  const texts = {}
  for (const id of PUSH_TYPE_IDS) {
    const v = String(s.texts?.[id] ?? '').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX)
    if (v) texts[id] = v
  }
  return {
    tone: TONES.includes(s.tone) ? s.tone : DEFAULT_STYLE.tone,
    emoji: s.emoji !== false,
    congrats: s.congrats !== false,
    texts,
    congratsText: String(s.congratsText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
  }
}

/** Default prefs for a phone: every kind on (the owner asked for all of them); each can be turned off. */
export function defaultPrefs() {
  return Object.fromEntries(PUSH_TYPE_IDS.map(id => [id, true]))
}

export function cleanPrefs(raw) {
  const base = defaultPrefs()
  if (!raw || typeof raw !== 'object') return base
  for (const id of PUSH_TYPE_IDS) if (typeof raw[id] === 'boolean') base[id] = raw[id]
  return base
}

export const yen = n => `¥${Math.round(+n || 0).toLocaleString('en-US')}`

/** Event values from the app or the server: known keys only, short strings, money as ¥. */
export function cleanVars(type, raw) {
  const t = typeOf(type)
  const out = {}
  if (!t || !raw || typeof raw !== 'object') return out
  for (const k of t.vars) {
    const v = raw[k]
    if (v == null || v === '') continue
    if (['amount', 'total'].includes(k) && Number.isFinite(+v)) out[k] = yen(v)
    else if (k === 'diff' && Number.isFinite(+v)) out[k] = (+v > 0 ? '+' : +v < 0 ? '−' : '±') + yen(Math.abs(+v))
    else out[k] = String(v).replace(/[\r\n\t]+/g, ' ').slice(0, 60)
  }
  // Raw amount kept apart: decides the "congratulations".
  const money = Number(raw.amount ?? raw.total)
  if (Number.isFinite(money)) out._money = money
  return out
}

export function fill(template, vars = {}) {
  return String(template || '')
    .replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])))
    // Tidy what an empty value leaves behind: "·  ·", "()", trailing separators.
    .replace(/\(\s*\)|（\s*）/g, '')
    .replace(/(\s*[·,、]\s*)+$/g, '')
    .replace(/^\s*[·,、]\s*/g, '')
    .replace(/\s*·\s*(·\s*)+/g, ' · ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * The notification text: title = the bar's name, body = the bar's own text (or the default for its tone),
 * with "congratulations" in front of money events above zero when the bar keeps it on.
 */
export function renderPush({ type, vars = {}, lang = 'en', style, barName = '' }) {
  const st = cleanStyle(style)
  const dict = DEFAULT_TEXTS[lang] || DEFAULT_TEXTS.en
  const t = typeOf(type)
  const template = st.texts[type] || dict[st.tone]?.[type] || DEFAULT_TEXTS.en.party[type] || ''
  let body = fill(template, vars)
  if (t?.money && st.congrats && (vars._money ?? 0) > 0) {
    const cheer = st.congratsText || dict.congrats[st.tone] || ''
    if (cheer) body = `${cheer} ${body}`
  }
  if (!st.emoji) body = body.replace(EMOJI_RE, '').replace(/\s{2,}/g, ' ').trim()
  const title = String(barName || 'JBM').slice(0, 60)
  return { title, body: body.slice(0, 240) }
}

/** Sample values for the preview and the test button. */
export const SAMPLE_VARS = {
  order: { who: 'Ken', tab: 'Table 3', items: 4, amount: 6800 },
  clock_in: { who: 'Ken', time: '19:02' },
  clock_out: { who: 'Ken', time: '03:10', hours: '8h 08m' },
  shift_close: { night: '11/06', total: 182400, tickets: 37, diff: 0, who: 'Ken' },
  day_close: { day: '11/06', total: 54200, tickets: 12 },
  sale: { who: 'Ken', tab: 'Table 3', amount: 12800, method: 'card' },
  invoice_new: { amount: 98000, due: '11/30', period: '10/16–11/15' },
  payment: { amount: 98000, who: 'Atomic', what: 'JBM invoice' },
  month_close: { month: '2026-10', total: 4210000, tickets: 812, best: '· best night 10/31' },
}

/** Clock punch → values for "started / finished work": Tokyo time and, at clock-out, hours since the clock-in. */
export function clockPushVars({ nome, at, inAt }) {
  const hm = iso => new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })
  const out = { who: String(nome || '').trim() || '—', time: at ? hm(at) : '' }
  if (inAt && at) {
    const mins = Math.round((new Date(at) - new Date(inAt)) / 60000)
    if (mins > 0 && mins < 24 * 60) out.hours = `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
  }
  return out
}
