import { useEffect, useState } from 'react'
import { useAuth } from './Auth'
import { fmtYen, Spinner } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { payrollFromPunches, monthRange, hoursBetween } from '../lib/timeClock'
import { canManageBarTeam } from '../lib/access'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'

export async function postClockMark({ barId, staffId, tipo, managerMark }) {
  const res = await staffFetch('/api/time-clock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo, staff_id: staffId, managerMark: !!managerMark, bar_id: barId }),
  })
  const text = await res.text()
  let json = {}
  try { json = text ? JSON.parse(text) : {} } catch { json = { error: text.slice(0, 160) } }
  if (!res.ok) throw new Error(errText(json.error, json.message || `Clock failed (${res.status})`))
  return json
}

export default function TimeClockPanel({ bar, onOpenStaff }) {
  const { perfil } = useAuth()
  const { t } = useI18n()
  const [punches, setPunches] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const range = monthRange()
  const manager = canManageBarTeam(perfil?.role)

  async function load() {
    setLoading(true)
    try {
      const j = await staffFetch(`/api/time-clock?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`).then(r => r.json())
      setPunches(j.punches || [])
    } catch {
      setPunches([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [bar.id])

  const meId = perfil?.id
  const rows = payrollFromPunches(punches, [{ id: meId, nome: perfil?.nome, salario_hora: perfil?.salario_hora || 0 }], range)
  const meRow = rows.find(r => r.staff_id === meId) || { hours: 0, pay: 0, open: false }
  const last = [...punches].filter(p => p.staff_id === meId)[0]
  const liveHours = last?.tipo === 'in' ? hoursBetween(last.punched_at, new Date().toISOString()) : 0

  async function mark(tipo) {
    if (!meId) return
    setErr(''); setBusy(true)
    try {
      await postClockMark({ barId: bar.id, staffId: meId, tipo, managerMark: manager })
      await load()
    } catch (e) {
      setErr(errText(e))
    }
    setBusy(false)
  }

  return (
    <div className="fade-in">
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>{t('clock.title')}</div>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>{t('clock.selfHint')}</div>
      {err && <div className="pos-sale-err" style={{ marginBottom: 12 }}>{asReactText(err)}</div>}
      {loading ? <Spinner /> : (
        <div className="card people-me">
          <div>
            <div className="people-me-kicker">{t('clock.you')}</div>
            <div className="people-me-name">{perfil?.nome}</div>
            <div className="people-me-sub">
              {meRow.open ? t('clock.openShift') : t('clock.offShift')}
              {' · '}{(meRow.hours || 0).toFixed(1)}h · {fmtYen(meRow.pay || 0)}
              {meRow.open && liveHours > 0 ? ` · ${t('clock.workingNow', { hours: liveHours.toFixed(1) })}` : ''}
            </div>
          </div>
          <button
            type="button"
            className={meRow.open ? 'people-out people-me-btn' : 'people-in people-me-btn'}
            disabled={!meId || busy}
            onClick={() => mark(meRow.open ? 'out' : 'in')}
          >
            {busy ? t('common.wait') : (meRow.open ? t('clock.bigOut') : t('clock.bigIn'))}
          </button>
        </div>
      )}
      {manager && onOpenStaff && (
        <button type="button" className="people-add-link" onClick={() => onOpenStaff()}>
          {t('clock.openStaffLogins')}
        </button>
      )}
    </div>
  )
}
