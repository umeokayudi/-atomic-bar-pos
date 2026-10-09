export function faturaAmount(f) {
  return +f.total || +f.valor || 0
}

export function faturaBalance(f) {
  return Math.max(0, faturaAmount(f) - (+f.pago || 0))
}

export function faturaCoversMonth(f, selMonth) {
  if (!selMonth || !f) return false
  const [y, m] = selMonth.split('-').map(Number)
  const monthStart = `${selMonth}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const monthEnd = `${selMonth}-${String(lastDay).padStart(2, '0')}`
  const start = (f.periodo_inicio || f.data_emissao || '').slice(0, 10)
  const end = (f.periodo_fim || f.data_vencimento || start).slice(0, 10)
  if (start && end && start <= monthEnd && end >= monthStart) return true
  if ((f.data_emissao || '').slice(0, 7) === selMonth) return true
  return false
}

export function aReceberForMonth(faturas, selMonth) {
  return (faturas || [])
    .filter(f => f.status !== 'pago' && faturaCoversMonth(f, selMonth))
    .reduce((a, f) => a + faturaBalance(f), 0)
}

/** Total faturado no mês (faturas do período, pagas ou em aberto). */
export function faturamentoForMonth(faturas, selMonth) {
  return (faturas || [])
    .filter(f => faturaCoversMonth(f, selMonth))
    .reduce((a, f) => a + faturaAmount(f), 0)
}
