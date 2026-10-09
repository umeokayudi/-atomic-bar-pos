import { useEffect, useState } from 'react'
import { staffFetch } from '../lib/apiAuth'
import { invalidateBarTeam, loadBarTeam, peekBarTeam } from '../lib/barTeam'
import { addDays } from '../lib/barClose'
import { tokyoNightKey } from '../lib/tokyo'
import { fmtYen } from './utils'
import { useI18n } from '../lib/i18n'
import { errText } from '../lib/errText'

function rosterOf(pack) {
  const seen = new Set()
  const rows = []
  for (const p of [...(pack?.staff || []), ...(pack?.people || [])]) {
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
  }, [pack, night])

  const people = rosterOf(pack)

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
      {!people.length && <div className="house-empty">{t('portal.close.boardEmpty')}</div>}
      {!!people.length && (
        <ul className="day-board-list">
          {people.map(person => {
            const isLate = late.some(p => p.id === person.id)
            const isAbsent = absent.some(p => p.id === person.id)
            return (
              <li key={person.id}>
                <span>{person.nome}</span>
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
