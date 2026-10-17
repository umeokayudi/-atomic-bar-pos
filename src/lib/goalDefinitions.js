/**
 * Every goal with its target, where it stands and how it is measured, so the owner and the team
 * read the same definition. Text lives in locales (goalDef.*); this file only picks numbers.
 */

const ICON = { noite: 'hoje', hora: 'clock', semana: 'shifts', turno: 'timer', lucro: 'piggy', mes: 'metas', pessoa: 'people' }

/** Bar goals in display order. `progress` is buildGoalProgress() output; without it only targets show. */
export function goalGuide(progress = null, goals = {}) {
  const g = goals || {}
  const p = progress || {}
  const row = (id, target, current, pct) => ({
    id,
    icon: ICON[id],
    target: +target || 0,
    current: current == null ? null : Math.round(+current || 0),
    pct: pct == null ? null : pct,
  })
  return [
    row('noite', g.noite ?? p.noite?.goal, p.noite?.sales, p.noite?.pct),
    row('hora', g.hora ?? p.hora?.goal, p.hora?.sales, p.hora?.pct),
    row('semana', g.semana ?? p.semana?.goal, p.semana?.sales, p.semana?.pct),
    row('turno', g.turno ?? p.bands?.noite?.goal, p.bands?.noite?.sales, p.bands?.noite?.pct),
    row('lucro', g.lucro ?? p.lucro?.goal, p.lucro?.profit, p.lucro?.pct),
    row('mes', g.mes ?? p.mes?.goal, p.mes?.sales, p.mes?.pct),
    row('pessoa', null, null, null),
  ]
}

/** Hours used inside the definitions ("from 20:00 to 05:00"). */
export function goalHours(goals = {}) {
  const pad = n => String(((+n % 24) + 24) % 24).padStart(2, '0')
  const g = goals || {}
  return {
    abre: `${pad(g.abre ?? 20)}:00`,
    fecha: `${pad(g.fecha ?? 5)}:00`,
    corta: `${pad(g.corta ?? 0)}:00`,
  }
}

/** Personal goal (payroll_goal_notes) → which definition explains it. */
export function personalGoalSource(goal = {}) {
  const s = String(goal.source || '').toLowerCase()
  if (/pos|till|venda|sale/.test(s)) return 'sales'
  if (/drink|back|cast/.test(s)) return 'drinkBack'
  if (/clock|ponto|hour|hora/.test(s)) return 'hours'
  if (/point|pts/.test(s)) return 'points'
  return 'manual'
}
