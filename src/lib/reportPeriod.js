/** Verifica se um período (início/fim) sobrepõe o mês selecionado (YYYY-MM) */
export function monthOverlapsPeriod(selMonth, inicio, fim) {
  if (!selMonth) return false
  const [y, m] = selMonth.split('-').map(Number)
  const monthStart = `${selMonth}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const monthEnd = `${selMonth}-${String(lastDay).padStart(2, '0')}`
  const start = inicio || fim || monthStart
  const end = fim || inicio || monthEnd
  return start <= monthEnd && end >= monthStart
}

export function ryoshushoForMonth(ryoshusho, selMonth) {
  return (ryoshusho || []).filter(r =>
    monthOverlapsPeriod(selMonth, r.periodo_inicio, r.periodo_fim)
    || (!r.periodo_inicio && !r.periodo_fim && r.data_emissao?.startsWith(selMonth))
  )
}

/** Receita coberta por um ryoshusho no mês (proporcional se período > 1 mês) */
export function ryoshushoMonthShare(r, selMonth) {
  return ryoshushoPeriodSplit(r, selMonth).share
}

/** Detalhe da alocação proporcional (para exibir no relatório) */
export function ryoshushoPeriodSplit(r, selMonth) {
  const total = +r.total || 0
  const ini = r.periodo_inicio || r.data_emissao
  const fim = r.periodo_fim || r.data_emissao || ini
  if (!total || !ini) {
    return { share: total, total, overlapDays: 0, periodDays: 0, multiMonth: false }
  }

  const [y, m] = selMonth.split('-').map(Number)
  const monthStart = new Date(y, m - 1, 1)
  const monthEnd = new Date(y, m, 0)
  const periodStart = new Date(ini + 'T12:00:00')
  const periodEnd = new Date(fim + 'T12:00:00')
  const overlapStart = new Date(Math.max(monthStart, periodStart))
  const overlapEnd = new Date(Math.min(monthEnd, periodEnd))
  if (overlapEnd < overlapStart) {
    return { share: 0, total, overlapDays: 0, periodDays: 0, multiMonth: ini.slice(0, 7) !== fim.slice(0, 7) }
  }

  const periodDays = Math.max(1, Math.round((periodEnd - periodStart) / 86400000) + 1)
  const overlapDays = Math.max(1, Math.round((overlapEnd - overlapStart) / 86400000) + 1)
  const multiMonth = ini.slice(0, 7) !== fim.slice(0, 7)
  return {
    share: Math.round(total * overlapDays / periodDays),
    total,
    overlapDays,
    periodDays,
    multiMonth,
  }
}
