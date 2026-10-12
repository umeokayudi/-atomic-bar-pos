import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useI18n } from '../../lib/i18n'
import { forgetLiveSelects } from '../../lib/barLiveClient'
import { formatVisitDuration } from '../../lib/barCrm'
import { billingEvent, readRoomMeta, roomClock, roomCost, roomHourLine, vipSettings } from '../../lib/vipBilling'
import { fmtYen } from '../utils'
import Icon from '../ui/Icon'

const POLL_MS = 30000
const SNOOZE_MS = 5 * 60000
const STALE_MS = 16 * 3600000

/**
 * VIP rooms on the till: who is in each room and how long, and — before each time block runs out —
 * one sheet asking "charge more hours or leave it free". Charging puts the hours on the room's tab.
 * Every decision is written on the visit, so the VIP page counts hours used, charged and given away.
 */
export default function PosVipRooms({ bar, spaces = [], settings, staffName = '', userId = null, onCharge }) {
  const { t } = useI18n()
  const rooms = spaces.filter(s => s.ativo !== false && (s.tipo === 'vip_room' || s.zona === 'vip'))
  const cfg = vipSettings(settings)
  const [visits, setVisits] = useState([])
  const [now, setNow] = useState(Date.now())
  const [sheet, setSheet] = useState(null) // { roomId, mode: 'open' | 'ask' }
  const [party, setParty] = useState(2)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')
  const snoozed = useRef(new Map())

  const load = useCallback(async () => {
    if (!rooms.length) return
    forgetLiveSelects('bar_visits')
    const { data, error } = await supabase.from('bar_visits')
      .select('id,space_id,status,party_size,inicio,criado_em,fim,host_nome,vip_eventos,bar_guests(nome)')
      .eq('bar_id', bar.id).eq('status', 'seated').order('inicio', { ascending: false }).limit(50)
    // A room left "seated" for more than 16h is a forgotten visit (closed on the Seating screen), not tonight's guests.
    const fresh = v => Date.now() - new Date(v.inicio || v.criado_em || 0).getTime() < STALE_MS
    if (!error) setVisits((data || []).filter(v => !v.fim && fresh(v) && rooms.some(r => r.id === v.space_id)))
  }, [bar.id, rooms.length])

  useEffect(() => {
    load()
    const id = setInterval(() => {
      setNow(Date.now())
      if (document.visibilityState === 'visible') load()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [load])

  const live = rooms.map(room => {
    const visit = visits.find(v => v.space_id === room.id) || null
    const clock = visit ? roomClock(visit, now, cfg) : null
    return { room, visit, clock, hourPrice: readRoomMeta(room.notas).hourPrice }
  })

  // Open the question by itself when a room needs a decision (once per block, snooze 5 min on dismiss).
  useEffect(() => {
    if (sheet) return
    const due = live.find(x => x.clock?.askNow && (snoozed.current.get(x.clock.snoozeKey) || 0) < now)
    if (due) setSheet({ roomId: due.room.id, mode: 'ask' })
  })

  if (!rooms.length) return null

  const cur = sheet && live.find(x => x.room.id === sheet.roomId)

  function close() {
    if (cur?.clock) snoozed.current.set(cur.clock.snoozeKey, Date.now() + SNOOZE_MS)
    setSheet(null)
    setErr('')
  }

  async function openRoom(e) {
    e?.preventDefault?.()
    if (!cur || busy) return
    setBusy(true)
    setErr('')
    try {
      const { error } = await supabase.from('bar_visits').insert({
        bar_id: bar.id, space_id: cur.room.id, status: 'seated', party_size: Math.max(1, +party || 1),
        inicio: new Date().toISOString(), host_nome: staffName || null, criado_por: userId, vip_eventos: [],
      })
      if (error) throw new Error(error.message)
      await load()
      setNow(Date.now())
      setSheet({ roomId: cur.room.id, mode: 'ask' })
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  /** Re-read the visit first: another till may have decided this block already. */
  async function decide(acao, min) {
    if (!cur?.visit || busy) return
    setBusy(true)
    setErr('')
    try {
      forgetLiveSelects('bar_visits')
      const { data: fresh, error: readErr } = await supabase.from('bar_visits').select('id,inicio,criado_em,fim,status,vip_eventos').eq('id', cur.visit.id).maybeSingle()
      if (readErr) throw new Error(readErr.message)
      if (!fresh || fresh.fim) { await load(); setSheet(null); return }
      if (roomClock(fresh, Date.now(), cfg).coveredMin !== cur.clock.coveredMin) {
        await load()
        setNote(t('vipPos.alreadyDone'))
        setSheet(null)
        return
      }
      const ev = billingEvent({ acao, min, hourPrice: cur.hourPrice, por: staffName })
      if (acao === 'cobrar' && ev.valor > 0) {
        const where = await onCharge(cur.room, roomHourLine({ room: cur.room, min, hourPrice: cur.hourPrice }), cur.visit.party_size)
        setNote(t('vipPos.charged', { amount: fmtYen(ev.valor), tab: where || cur.room.nome }))
      } else {
        setNote(t('vipPos.leftFree', { room: cur.room.nome, time: formatVisitDuration(min) }))
      }
      const { error } = await supabase.from('bar_visits').update({ vip_eventos: [...(Array.isArray(fresh.vip_eventos) ? fresh.vip_eventos : []), ev] }).eq('id', fresh.id)
      if (error) throw new Error(error.message)
      await load()
      setNow(Date.now())
      setSheet(null)
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  async function endRoom() {
    if (!cur?.visit || busy) return
    setBusy(true)
    try {
      const { error } = await supabase.from('bar_visits').update({ status: 'done', fim: new Date().toISOString() }).eq('id', cur.visit.id)
      if (error) throw new Error(error.message)
      await load()
      setSheet(null)
      setNote(t('vipPos.ended', { room: cur.room.nome }))
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setBusy(false)
    }
  }

  const blockH = cfg.blockMin / 60

  return (
    <>
      <div className="pvip" aria-label={t('vipPos.title')}>
        {live.map(({ room, visit, clock }) => {
          const state = !visit ? 'free' : clock.state
          return (
            <button key={room.id} type="button" className={`pvip-room is-${state}`} onClick={() => setSheet({ roomId: room.id, mode: visit ? 'ask' : 'open' })}>
              <strong><Icon name="vip" size={13} /> {room.nome}</strong>
              {!visit ? <span>{t('vipPos.free')}</span> : (
                <>
                  <span>{formatVisitDuration(clock.usedMin)}{visit.party_size ? ` · ${t('vip.people', { n: visit.party_size })}` : ''}</span>
                  <span>
                    {clock.state === 'start' ? t('vipPos.needStart')
                      : clock.state === 'over' ? t('vipPos.over', { time: formatVisitDuration(-clock.leftMin) })
                        : t('vipPos.left', { time: formatVisitDuration(clock.leftMin) })}
                  </span>
                </>
              )}
            </button>
          )
        })}
      </div>
      {note && <div className="pq-hint" role="status" onClick={() => setNote('')}>{note}</div>}

      {cur && sheet.mode === 'open' && !cur.visit && (
        <div className="pq-sheet" role="dialog" aria-modal="true" aria-label={t('vipPos.openTitle', { room: cur.room.nome })} onClick={e => { if (e.target === e.currentTarget) close() }}>
          <form className="pq-sheet-card pvip-ask" onSubmit={openRoom}>
            <h2>{t('vipPos.openTitle', { room: cur.room.nome })}</h2>
            <p className="pq-hint">{cur.hourPrice ? t('vipPos.openHint', { price: fmtYen(cur.hourPrice), block: formatVisitDuration(cfg.blockMin) }) : t('vipPos.noPrice')}</p>
            <div className="pq-sheet-name">
              <input type="number" min="1" max="99" className="pq-people" value={party} aria-label={t('tabs.peopleLabel')} onChange={e => setParty(e.target.value)} />
              <button type="submit" disabled={busy}>{t('vipPos.start')}</button>
            </div>
            {err && <div className="pq-alert" role="alert">{err}</div>}
            <button type="button" className="pq-sheet-cancel" onClick={close}>{t('common.cancel')}</button>
          </form>
        </div>
      )}

      {cur && sheet.mode === 'ask' && cur.visit && (
        <div className="pq-sheet" role="dialog" aria-modal="true" aria-label={cur.room.nome} onClick={e => { if (e.target === e.currentTarget) close() }}>
          <div className="pq-sheet-card pvip-ask">
            <h2>{cur.room.nome}</h2>
            <div className="pvip-big">{formatVisitDuration(cur.clock.usedMin)}</div>
            <p className="pq-hint">
              {cur.clock.state === 'start' ? t('vipPos.askStart')
                : cur.clock.state === 'over' ? t('vipPos.askOver', { time: formatVisitDuration(-cur.clock.leftMin) })
                  : cur.clock.state === 'soon' ? t('vipPos.askSoon', { time: formatVisitDuration(cur.clock.leftMin) })
                    : t('vipPos.covered', { time: formatVisitDuration(cur.clock.leftMin) })}
            </p>
            <p className="pq-hint">{t('vipPos.sofar', { billed: formatVisitDuration(cur.clock.billedMin), amount: fmtYen(cur.clock.billedYen), free: formatVisitDuration(cur.clock.waivedMin) })}</p>
            {!cur.hourPrice && <p className="pq-hint">{t('vipPos.noPrice')}</p>}
            <div className="pvip-choices">
              {cur.hourPrice > 0 && (
                <button type="button" className="is-primary" disabled={busy} onClick={() => decide('cobrar', cfg.blockMin)}>
                  {t('vipPos.chargeH', { h: blockH })}<small>{fmtYen(roomCost(cur.hourPrice, cfg.blockMin))}</small>
                </button>
              )}
              {cur.hourPrice > 0 && cfg.blockMin > 60 && (
                <button type="button" disabled={busy} onClick={() => decide('cobrar', 60)}>
                  {t('vipPos.chargeH', { h: 1 })}<small>{fmtYen(roomCost(cur.hourPrice, 60))}</small>
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => decide('livre', cfg.blockMin)}>
                {t('vipPos.leave')}<small>{t('vipPos.leaveSub', { h: blockH })}</small>
              </button>
              <button type="button" disabled={busy} onClick={endRoom}>
                {t('vipPos.end')}<small>{t('vipPos.endSub')}</small>
              </button>
            </div>
            {err && <div className="pq-alert" role="alert">{err}</div>}
            <button type="button" className="pq-sheet-cancel" onClick={close}>{t('vipPos.later')}</button>
          </div>
        </div>
      )}
    </>
  )
}
