import { useEffect, useState } from 'react'
import { staffFetch } from '../lib/apiAuth'
import { invalidateBarTeam, loadBarTeam, peekBarTeam } from '../lib/barTeam'
import { addDays } from '../lib/barClose'
import { clockStaff } from '../lib/timeClock'
import { tokyoNightKey } from '../lib/tokyo'
import { fmtYen } from './utils'
import { useI18n } from '../lib/i18n'
import { errText } from '../lib/errText'
import { useScheduleBoard } from './staff/OwnerSchedule'

function rosterOf(pack) {
  const seen = new Set()
  const rows = []
  for (const p of [...clockStaff(pack?.staff), ...(pack?.people || [])]) {
    if (!p?.id || p.ativo === false || seen.has(p.id)) continue
    const nome = String(p.nome || p.email || '').trim()
    if (!nome) continue
    seen.add(p.id)
    rows.push({ id: p.id, nome })
  }
  rows.sort((a, b) => a.nome.localeCompare(b.nome))
  return rows
}

function sheetOf(pack, night) {
  return (pack?.sheets || []).find(s => s.night_key === night) || null
}

export default function DayStaffBoard() {
  const { t } = useI18n()
  const [night, setNight] = useState(() => tokyoNightKey())
  const [pack, setPack] = useState(() => peekBarTeam())
  const [late, setLate] = useState([])
  const [absent, setAbsent] = useState([])
  const [dj, setDj] = useState(false)
  const [djNome, setDjNome] = useState('')
  const [djCusto, setDjCusto] = useState('')
  const [missao, setMissao] = useState('')
  const [roles, setRoles] = useState({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let live = true
    loadBarTeam().then(j => {
      if (live && j && !j.error) setPack(j)
    })
    return () => { live = false }
  }, [])

  useEffect(() => {
    const row = sheetOf(pack, night)
    setLate(Array.isArray(row?.late) ? row.late : [])
    setAbsent(Array.isArray(row?.absent) ? row.absent : [])
    setDj(!!row?.dj)
    setDjNome(row?.dj_nome || '')
    setDjCusto(row?.dj ? String(row.dj_custo ?? '') : '')
    setMissao(row?.missao || '')
    setRoles(row?.roles && typeof row.roles === 'object' ? row.roles : {})
  }, [pack, night])

  const sched = useScheduleBoard(night, night)
  const expected = sched.rows[0]?.attendance || []
  const expectedById = Object.fromEntries(expected.map(a => [a.id, a]))
  // Scheduled people first (the night's expected staff), then the rest of the team.
  const people = [...rosterOf(pack)].sort((a, b) => (!!expectedById[b.id] - !!expectedById[a.id]) || a.nome.localeCompare(b.nome))
  const fromClock = expected.filter(a => a.status === 'late' || a.status === 'absent' || a.status === 'missing')

  /** Late / absent straight from the schedule and the clock (expected but no clock-in = absent). */
  function markFromClock() {
    const pick = kind => expected.filter(a => (kind === 'late' ? a.status === 'late' : a.status === 'absent' || a.status === 'missing')).map(a => ({ id: a.id, nome: a.nome || a.id }))
    const absentList = pick('absent')
    const absentIds = new Set(absentList.map(p => p.id))
    setAbsent([...absent.filter(p => !absentIds.has(p.id) && !expectedById[p.id]), ...absentList])
    setLate([...late.filter(p => !absentIds.has(p.id) && !expectedById[p.id]), ...pick('late').filter(p => !absentIds.has(p.id))])
    setNote('')
  }

  function drop(list, id) {
    return list.filter(p => p.id !== id)
  }

  function mark(person, kind) {
    if (kind === 'late') {
      const on = late.some(p => p.id === person.id)
      setLate(on ? drop(late, person.id) : [...drop(late, person.id), person])
      setAbsent(drop(absent, person.id))
    } else {
      const on = absent.some(p => p.id === person.id)
      setAbsent(on ? drop(absent, person.id) : [...drop(absent, person.id), person])
      setLate(drop(late, person.id))
    }
    setNote('')
  }

  async function save() {
    setBusy(true)
    setNote('')
    try {
      const res = await staffFetch('/api/bar-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveDaySheet',
          night_key: night,
          late,
          absent,
          dj,
          dj_nome: djNome,
          dj_custo: dj ? djCusto : 0,
          missao,
          roles: Object.fromEntries(Object.entries(roles).filter(([, v]) => String(v || '').trim())),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json.error) {
        setNote(errText(json.error || res.status))
        return
      }
      const sheet = json.sheet
      setPack(prev => {
        const sheets = [...(prev?.sheets || []).filter(s => s.night_key !== night)]
        if (sheet) sheets.unshift(sheet)
        return { ...(prev || {}), sheets }
      })
      invalidateBarTeam()
      setNote(t('portal.close.boardSaved'))
    } catch (e) {
      setNote(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="desk-card day-board">
      <h3>{t('portal.close.boardTitle')}</h3>
      <p className="desk-note">{t('portal.close.boardLead')}</p>
      <div className="day-board-nav">
        <button type="button" disabled={busy} onClick={() => { setNote(''); setNight(addDays(night, -1)) }}>{t('portal.close.boardPrev')}</button>
        <strong>{night}</strong>
        <button type="button" disabled={busy} onClick={() => { setNote(''); setNight(addDays(night, 1)) }}>{t('portal.close.boardNext')}</button>
      </div>
      <p className="desk-note">
        {t('portal.close.boardSummary', {
          late: late.length,
          absent: absent.length,
          dj: dj ? fmtYen(Math.round(+djCusto || 0)) : t('portal.close.boardDjNo'),
        })}
      </p>
      <div className="day-board-expected">
        <strong>{t('ownerSchedule.expectedTonight', { n: expected.length })}</strong>
        {sched.rows[0] && !sched.rows[0].confirmed && expected.length > 0 && <span className="desk-note">{t('ownerSchedule.fromMarks')}</span>}
        {!expected.length && !sched.loading && <span className="desk-note">{t('ownerSchedule.noExpected')}</span>}
        {fromClock.length > 0 && (
          <button type="button" className="ui-btn" disabled={busy} onClick={markFromClock}>{t('ownerSchedule.markFromClock', { n: fromClock.length })}</button>
        )}
      </div>
      {!people.length && <div className="house-empty">{t('portal.close.boardEmpty')}</div>}
      {!!people.length && (
        <ul className="day-board-list">
          {people.map(person => {
            const isLate = late.some(p => p.id === person.id)
            const isAbsent = absent.some(p => p.id === person.id)
            return (
              <li key={person.id} className={expectedById[person.id] ? 'is-expected' : ''}>
                <span>
                  {person.nome}
                  {expectedById[person.id] && (
                    <small className="day-board-exp">
                      {expectedById[person.id].start || t('ownerSchedule.scheduled')}
                      {expectedById[person.id].status !== 'pending' ? ` · ${t(`ownerSchedule.st_${expectedById[person.id].status}`, { min: expectedById[person.id].lateMinutes })}` : ''}
                    </small>
                  )}
                </span>
                <button type="button" className={isLate ? 'is-late' : ''} disabled={busy} onClick={() => mark(person, 'late')}>
                  {t('portal.close.boardLate')}
                </button>
                <button type="button" className={isAbsent ? 'is-absent' : ''} disabled={busy} onClick={() => mark(person, 'absent')}>
                  {t('portal.close.boardAbsent')}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <label className="day-board-mission">
        {t('dayBoardExtra.mission')}
        <input value={missao} maxLength={300} disabled={busy} placeholder={t('dayBoardExtra.missionPh')} onChange={e => { setMissao(e.target.value); setNote('') }} />
      </label>
      {!!people.length && (
        <fieldset className="day-board-roles">
          <legend>{t('dayBoardExtra.roles')}</legend>
          {people.filter(p => !absent.some(a => a.id === p.id)).map(person => (
            <label key={person.id}>
              <span>{person.nome}</span>
              <input value={roles[person.id] || ''} maxLength={80} disabled={busy} placeholder={t('dayBoardExtra.rolePh')} onChange={e => { const v = e.target.value; setRoles(r => ({ ...r, [person.id]: v })); setNote('') }} />
            </label>
          ))}
        </fieldset>
      )}
      <div className="goal-modes">
        <button type="button" className={dj ? 'is-on' : ''} disabled={busy} onClick={() => setDj(true)}>{t('portal.close.boardDjYes')}</button>
        <button type="button" className={!dj ? 'is-on' : ''} disabled={busy} onClick={() => setDj(false)}>{t('portal.close.boardDjNo')}</button>
      </div>
      {dj && (
        <div className="house-editor">
          <label>
            {t('portal.close.boardDjName')}
            <input value={djNome} disabled={busy} onChange={e => setDjNome(e.target.value)} />
          </label>
          <label>
            {t('portal.close.boardDjCost')}
            <input type="number" min="0" value={djCusto} disabled={busy} onChange={e => setDjCusto(e.target.value)} />
          </label>
        </div>
      )}
      <button type="button" className="btn-primary day-board-save" disabled={busy} onClick={save}>{t('portal.close.boardSave')}</button>
      {note && <p className="desk-note">{note}</p>}
    </section>
  )
}
