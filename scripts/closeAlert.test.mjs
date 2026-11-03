import assert from 'node:assert/strict'
import { closeAlert, closeSettings, nightMode, shiftsDue } from '../src/lib/autoClose.js'

const at = s => new Date(`${s}+09:00`)
const alert = { modo_noite: 'alerta', hora_noite: 5, min_noite: 0, aviso_min: 15, auto_dia: false }

// Older bars: auto_noite true/missing → auto, false → off.
assert.equal(nightMode({}), 'auto')
assert.equal(nightMode({ auto_noite: false }), 'off')
assert.equal(nightMode({ auto_noite: false, modo_noite: 'alerta' }), 'alerta')
assert.equal(closeSettings({ aviso_min: 7 }).avisoMin, 0)

// Alert mode never closes the night by itself.
assert.deepEqual(shiftsDue(alert, at('2026-11-03T06:00')), [])
assert.equal(shiftsDue({ ...alert, modo_noite: 'auto' }, at('2026-11-03T06:00'))[0].key, '2026-11-02')

// 05:00 close: warning 15 min before, then "due" for the night that started on the 2nd.
assert.equal(closeAlert(alert, at('2026-11-03T04:44')), null)
assert.deepEqual(closeAlert(alert, at('2026-11-03T04:50')), { kind: 'soon', mode: 'alerta', key: '2026-11-02', time: '05:00', left: 10 })
assert.equal(closeAlert(alert, at('2026-11-03T05:00')).kind, 'due')
assert.equal(closeAlert(alert, at('2026-11-03T08:00')).late, 180)
assert.equal(closeAlert(alert, at('2026-11-03T18:00')), null)
// Closed (or counting) nights stop the alert.
assert.equal(closeAlert(alert, at('2026-11-03T06:00'), new Set(['2026-11-02'])), null)
assert.equal(closeAlert({ ...alert, fechou_noite: '2026-11-02' }, at('2026-11-03T06:00')), null)

// Auto mode: only the warning before; the close itself is AutoClose's job.
const auto = { ...alert, modo_noite: 'auto' }
assert.equal(closeAlert(auto, at('2026-11-03T04:50')).mode, 'auto')
assert.equal(closeAlert(auto, at('2026-11-03T05:10')), null)
assert.equal(closeAlert({ ...alert, modo_noite: 'off' }, at('2026-11-03T05:10')), null)

// Close before midnight (23:30): due after midnight belongs to the evening's night.
const late = { modo_noite: 'alerta', hora_noite: 23, min_noite: 30, aviso_min: 30 }
assert.equal(closeAlert(late, at('2026-11-03T23:10')).key, '2026-11-03')
assert.equal(closeAlert(late, at('2026-11-04T01:00')).key, '2026-11-03')

console.log('closeAlert tests passed')
