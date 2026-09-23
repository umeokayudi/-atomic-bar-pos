/** POS night ticket extras packed into pos_vendas.obs — never JBM vendas/faturas. */

import { orderDetailsFromObs, withOrderCast } from './orderMeta.js'

const LINE = {
  night: /^Night:\s*(.+)$/im,
  svc: /^Svc:\s*([\d.]+)$/im,
  nom: /^Nom:\s*([\d.]+)$/im,
  set: /^Set:\s*(\d+)@([\d.]+)$/im,
  room: /^RoomMin:\s*([\d.]+)$/im,
  keep: /^Keep:\s*([^:]+):([\d.]+)$/im,
  pay: /^Pay:\s*(.+)$/im,
}

export const DEFAULT_POS_SETTINGS = {
  service_pct: 10,
  room_min: 10000,
  set_minutes: 60,
  set_price: 0,
}

export function readTicketMeta(obs) {
  const text = String(obs || '')
  const night = text.match(LINE.night)?.[1]?.trim() || ''
  const svc = text.match(LINE.svc)
  const nom = text.match(LINE.nom)
  const set = text.match(LINE.set)
  const room = text.match(LINE.room)
  const keep = text.match(LINE.keep)
  return {
    nightKey: night,
    servicePct: svc ? +svc[1] : null,
    nominho: nom ? +nom[1] : 0,
    setMinutes: set ? +set[1] : 0,
    setPrice: set ? +set[2] : 0,
    roomMin: room ? +room[1] : 0,
    keepId: keep ? keep[1].trim() : '',
    keepPourPct: keep ? +keep[2] : 0,
    payNote: text.match(LINE.pay)?.[1]?.trim() || '',
    details: orderDetailsFromObs(text),
  }
}

export function packTicketObs({
  details = '',
  castName = '',
  castId = '',
  nightKey = '',
  servicePct = null,
  nominho = 0,
  setMinutes = 0,
  setPrice = 0,
  roomMin = 0,
  keepId = '',
  keepPourPct = 0,
  payNote = '',
} = {}) {
  const head = []
  const castLine = withOrderCast('', { name: castName, id: castId })
  if (castLine) head.push(castLine)
  if (nightKey) head.push(`Night: ${nightKey}`)
  if (payNote) head.push(String(payNote).startsWith('Pay:') ? payNote : `Pay: ${payNote}`)
  if (servicePct != null && servicePct !== '') head.push(`Svc: ${servicePct}`)
  if (+nominho > 0) head.push(`Nom: ${Math.round(+nominho)}`)
  if (+setMinutes > 0 || +setPrice > 0) head.push(`Set: ${Math.round(+setMinutes || 0)}@${Math.round(+setPrice || 0)}`)
  if (+roomMin > 0) head.push(`RoomMin: ${Math.round(+roomMin)}`)
  if (keepId && +keepPourPct > 0) head.push(`Keep: ${keepId}:${Math.round(+keepPourPct)}`)
  const body = orderDetailsFromObs(details)
  return [...head, body].filter(Boolean).join('\n')
}

/** Extra ticket lines (set / 指名 / サービス / 個室 min). Drinks stay on the cart. */
export function ticketChargeLines({
  drinksTotal = 0,
  servicePct = 0,
  nominho = 0,
  setMinutes = 0,
  setPrice = 0,
  roomMin = 0,
  spaceType = '',
} = {}) {
  const lines = []
  if (+setPrice > 0) {
    lines.push({
      key: 'set',
      kind: 'set',
      nome: setMinutes > 0 ? `セット ${Math.round(+setMinutes)}m` : 'セット',
      qtd: 1,
      preco: Math.round(+setPrice),
      preco_unitario: Math.round(+setPrice),
      preco_lista: Math.round(+setPrice),
      tipo_preco: 'set',
      desconto_valor: 0,
      drink_menu_id: null,
      produto_id: null,
    })
  }
  if (+nominho > 0) {
    lines.push({
      key: 'nominho',
      kind: 'nominho',
      nome: '指名',
      qtd: 1,
      preco: Math.round(+nominho),
      preco_unitario: Math.round(+nominho),
      preco_lista: Math.round(+nominho),
      tipo_preco: 'nominho',
      desconto_valor: 0,
      drink_menu_id: null,
      produto_id: null,
    })
  }
  const afterSet = Math.round(+drinksTotal || 0) + lines.reduce((a, l) => a + l.preco * (l.qtd || 1), 0)
  const svc = Math.round(afterSet * (Math.max(0, +servicePct || 0) / 100))
  if (svc > 0) {
    lines.push({
      key: 'service',
      kind: 'service',
      nome: `サービス料 ${servicePct}%`,
      qtd: 1,
      preco: svc,
      preco_unitario: svc,
      preco_lista: svc,
      tipo_preco: 'service',
      desconto_valor: 0,
      drink_menu_id: null,
      produto_id: null,
    })
  }
  const afterSvc = afterSet + svc
  if (spaceType === 'vip_room' && +roomMin > 0 && afterSvc < +roomMin) {
    const gap = Math.round(+roomMin - afterSvc)
    lines.push({
      key: 'room_min',
      kind: 'room_min',
      nome: '個室チャージ',
      qtd: 1,
      preco: gap,
      preco_unitario: gap,
      preco_lista: gap,
      tipo_preco: 'room_min',
      desconto_valor: 0,
      drink_menu_id: null,
      produto_id: null,
    })
  }
  const extraTotal = lines.reduce((a, l) => a + l.preco * (l.qtd || 1), 0)
  return { lines, extraTotal, total: Math.round(+drinksTotal || 0) + extraTotal }
}

/** Walk-up till is face price. Service % only on CAST / table / guest / set / 指名 — not just opening extras. */
export function effectiveServicePct({ servicePct = 0, tableTicket = false } = {}) {
  if (tableTicket) return Math.max(0, +servicePct || 0)
  return 0
}

export function settingsFromRow(row) {
  return {
    service_pct: row?.service_pct != null ? +row.service_pct : DEFAULT_POS_SETTINGS.service_pct,
    room_min: row?.room_min != null ? +row.room_min : DEFAULT_POS_SETTINGS.room_min,
    set_minutes: row?.set_minutes != null ? +row.set_minutes : DEFAULT_POS_SETTINGS.set_minutes,
    set_price: row?.set_price != null ? +row.set_price : DEFAULT_POS_SETTINGS.set_price,
  }
}
