import { todayTokyo } from './format.js'

function parseDate(s) {
  if (!s) return null
  const d = new Date(s + (s.length <= 10 ? 'T00:00:00' : ''))
  return Number.isNaN(d.getTime()) ? null : d
}

function toISODate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Next payday on or after `from` (YYYY-MM-DD). */
export function proximoPagamento(staff, from = todayTokyo()) {
  const ciclo = staff.ciclo_pagamento || 'mensal'
  const fromDate = parseDate(from)
  if (!fromDate) return from

  if (ciclo === 'diario') return from

  if (ciclo === 'semanal') {
    const target = staff.dia_pagamento == null ? 5 : Number(staff.dia_pagamento)
    const d = new Date(fromDate)
    for (let i = 0; i < 8; i++) {
      if (d.getDay() === target) return toISODate(d)
      d.setDate(d.getDate() + 1)
    }
    return from
  }

  if (ciclo === 'quinzenal') {
    const day = fromDate.getDate()
    const y = fromDate.getFullYear()
    const m = fromDate.getMonth()
    if (day <= 15) return toISODate(new Date(y, m, 15))
    return toISODate(new Date(y, m + 1, 1))
  }

  const targetDay = Math.min(Math.max(Number(staff.dia_pagamento) || 25, 1), 28)
  const y = fromDate.getFullYear()
  const m = fromDate.getMonth()
  const thisMonth = new Date(y, m, targetDay)
  if (toISODate(fromDate) <= toISODate(thisMonth)) return toISODate(thisMonth)
  return toISODate(new Date(y, m + 1, targetDay))
}

export function periodoAtual(staff, from = todayTokyo()) {
  const ciclo = staff.ciclo_pagamento || 'mensal'
  const venc = proximoPagamento(staff, from)
  const vencDate = parseDate(venc)
  const ini = new Date(vencDate)

  if (ciclo === 'diario') {
    return { inicio: venc, fim: venc }
  }
  if (ciclo === 'semanal') {
    ini.setDate(ini.getDate() - 6)
    return { inicio: toISODate(ini), fim: venc }
  }
  if (ciclo === 'quinzenal') {
    const day = vencDate.getDate()
    if (day === 15) return { inicio: toISODate(new Date(vencDate.getFullYear(), vencDate.getMonth(), 1)), fim: venc }
    ini.setDate(1)
    return { inicio: toISODate(new Date(vencDate.getFullYear(), vencDate.getMonth() - 1, 16)), fim: venc }
  }
  ini.setMonth(ini.getMonth() - 1)
  ini.setDate(ini.getDate() + 1)
  return { inicio: toISODate(ini), fim: venc }
}

export function inRange(dateStr, inicio, fim) {
  if (!dateStr) return false
  const d = String(dateStr).slice(0, 10)
  return d >= inicio && d <= fim
}

export function calcularAPagar(staff, { horas = [], comissoes = [] } = {}, from = todayTokyo()) {
  const { inicio, fim } = periodoAtual(staff, from)
  const forma = staff.forma_pagamento || (staff.contrato === 'freelancer' ? 'comissao' : 'comissao')
  const valorHora = Number(staff.valor_hora) || 0

  const horasPeriodo = horas.filter(h => h.staff_id === staff.id && inRange(h.data, inicio, fim))
  const totalHoras = horasPeriodo.reduce((s, h) => s + (Number(h.horas) || 0), 0)
  const valorHoras = totalHoras * valorHora

  const comissoesPeriodo = comissoes.filter(c => {
    const sid = c.cast_id || c.staff_id
    return sid === staff.id && !c.pago && inRange(c.data, inicio, fim)
  })
  const valorComissao = comissoesPeriodo.reduce((s, c) => s + (Number(c.valor) || 0), 0)

  const total = forma === 'hora'
    ? valorHoras
    : forma === 'comissao'
      ? valorComissao
      : valorHoras + valorComissao

  const vencimento = proximoPagamento(staff, from)
  const atrasado = vencimento < from && total > 0

  return {
    inicio,
    fim,
    vencimento,
    atrasado,
    totalHoras,
    valorHoras,
    valorComissao,
    total,
    forma,
  }
}

export function taxaComissao(staff, itemPrice) {
  if (!staff) return 0
  const forma = staff.forma_pagamento || 'comissao'
  if (forma === 'hora') return 0
  if (staff.percentual_comissao != null && staff.percentual_comissao !== '') {
    return Number(staff.percentual_comissao) / 100
  }
  if (staff.contrato === 'freelancer') return 0.5
  return itemPrice > 2000 ? 0.3 : 0
}

export function custoMensalEstimado(custo) {
  const valor = Number(custo.valor) || 0
  if (custo.natureza !== 'fixo') return valor
  const freq = custo.frequencia || 'mensal'
  if (freq === 'semanal') return valor * 4.33
  if (freq === 'anual') return valor / 12
  if (freq === 'diario') return valor * 30
  return valor
}
