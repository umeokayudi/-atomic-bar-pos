import { custoMensalEstimado } from './payroll.js'

export const DEFAULT_ABRE = '21:00'
export const DEFAULT_FECHA = '05:00'
export const SLOT_MIN = 30
const HORAS_KEY = 'atomic-operacao-horas'

export function horaLabel(ms) {
  return new Date(ms).toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Tokyo',
  })
}

export function tokyoParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]))
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  }
}

export function dateStrFromParts(p) {
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function tokyoStamp(dateStr, hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  const [y, mo, d] = dateStr.split('-').map(Number)
  const pad = n => String(n).padStart(2, '0')
  return new Date(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(m || 0)}:00+09:00`).getTime()
}

export function addDays(dateStr, days) {
  const t = tokyoStamp(dateStr, '12:00') + days * 86400000
  return dateStrFromParts(tokyoParts(new Date(t)))
}

export function loadHoras() {
  try {
    const raw = JSON.parse(localStorage.getItem(HORAS_KEY) || '{}')
    return { abre: raw.abre || DEFAULT_ABRE, fecha: raw.fecha || DEFAULT_FECHA }
  } catch {
    return { abre: DEFAULT_ABRE, fecha: DEFAULT_FECHA }
  }
}

export function saveHoras(abre, fecha) {
  localStorage.setItem(HORAS_KEY, JSON.stringify({ abre, fecha }))
}

export function noiteDoInstante(now = new Date(), abre = DEFAULT_ABRE, fecha = DEFAULT_FECHA) {
  const p = tokyoParts(now)
  const dateStr = dateStrFromParts(p)
  const minutes = p.hour * 60 + p.minute
  const [fh, fm] = fecha.split(':').map(Number)
  const [ah, am] = abre.split(':').map(Number)
  const fechaMin = fh * 60 + (fm || 0)
  const abreMin = ah * 60 + (am || 0)
  if (abreMin > fechaMin && minutes < fechaMin) return addDays(dateStr, -1)
  return dateStr
}

export function janelaNoite(dateStr, abre = DEFAULT_ABRE, fecha = DEFAULT_FECHA) {
  const start = tokyoStamp(dateStr, abre)
  let end = tokyoStamp(dateStr, fecha)
  if (end <= start) end = tokyoStamp(addDays(dateStr, 1), fecha)
  return { start, end }
}

export function slotsNoite(dateStr, abre = DEFAULT_ABRE, fecha = DEFAULT_FECHA, slotMin = SLOT_MIN) {
  const { start, end } = janelaNoite(dateStr, abre, fecha)
  const slots = []
  for (let t = start; t < end; t += slotMin * 60000) {
    slots.push({ start: t, end: Math.min(t + slotMin * 60000, end) })
  }
  return slots
}

export function overlapMs(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

export function taxaCartaoVenda(venda) {
  if (!venda || venda.forma_pagamento !== 'cartao') return 0
  return ((Number(venda.total) || 0) / 1.25) * 0.0378
}

export function valorSessao(sala, pessoas, inicioMs, fimMs) {
  const minutos = Math.max(0, (fimMs - inicioMs) / 60000)
  const cobrados = Math.max(minutos, Number(sala?.minimo_minutos) || 0)
  const horas = cobrados / 60
  const porHora = (Number(sala?.preco_hora) || 0) * horas
  const porPessoa = (Number(sala?.taxa_pessoa) || 0) * (Number(pessoas) || 0) * horas
  return Math.round(porHora + porPessoa)
}

export function ocupacaoNoite(salas, sessoes, noite, abre, fecha, agora) {
  const { start, end } = janelaNoite(noite, abre, fecha)
  const limite = Math.min(Math.max(agora, start), end)
  const abertoMin = Math.max(0, (limite - start) / 60000)
  const ativas = salas.filter(s => s.ativo !== false)
  const capacidade = ativas.reduce((s, sala) => s + (Number(sala.capacidade) || 0), 0)
  let ocupadoMin = 0
  let pessoasMin = 0
  for (const sess of sessoes) {
    if (sess.status === 'cancelada') continue
    const ini = new Date(sess.inicio).getTime()
    const fim = sess.fim ? new Date(sess.fim).getTime() : agora
    const min = overlapMs(start, limite, ini, fim) / 60000
    ocupadoMin += min
    pessoasMin += min * (Number(sess.pessoas) || 0)
  }
  const salasMin = ativas.length * abertoMin
  return {
    abertoMin,
    ocupadoMin,
    pessoasMin,
    capacidade,
    salas: ativas.length,
    tempo: salasMin > 0 ? ocupadoMin / salasMin : 0,
    lugares: capacidade > 0 && abertoMin > 0 ? pessoasMin / (capacidade * abertoMin) : 0,
  }
}

export function montarPulso({
  noite, abre = DEFAULT_ABRE, fecha = DEFAULT_FECHA, agora = Date.now(),
  vendas = [], comissoes = [], turnos = [], custos = [], sessoes = [], salas = [],
}) {
  const slotList = slotsNoite(noite, abre, fecha)
  const slotCount = slotList.length || 1
  const fixosMes = custos
    .filter(c => c.natureza === 'fixo' && c.ativo !== false)
    .reduce((s, c) => s + custoMensalEstimado(c), 0)
  const varDia = custos
    .filter(c => c.natureza === 'variavel' && String(c.data || '').slice(0, 10) === noite)
    .reduce((s, c) => s + (Number(c.valor) || 0), 0)
  const rateioFixoCheio = (fixosMes / 30) / slotCount
  const rateioVarCheio = varDia / slotCount
  const salasById = Object.fromEntries(salas.map(s => [s.id, s]))
  const salasAtivas = salas.filter(s => s.ativo !== false)

  const linhas = slotList.map(slot => {
    const vendasSlot = vendas.filter(v => {
      const t = new Date(v.data_venda).getTime()
      return t >= slot.start && t < slot.end
    })
    const fatBar = vendasSlot.reduce((s, v) => s + (Number(v.total) || 0), 0)
    const taxa = vendasSlot.reduce((s, v) => s + taxaCartaoVenda(v), 0)
    const comissao = comissoes.filter(c => {
      const t = new Date(c.data).getTime()
      return t >= slot.start && t < slot.end
    }).reduce((s, c) => s + (Number(c.valor) || 0), 0)

    let staff = 0
    for (const turno of turnos) {
      const ini = new Date(turno.entrada).getTime()
      const fim = turno.saida ? new Date(turno.saida).getTime() : agora
      staff += (Number(turno.valor_hora) || 0) * (overlapMs(slot.start, slot.end, ini, fim) / 3600000)
    }

    let fatVip = 0
    let ocupadoMin = 0
    let pessoasMin = 0
    const slotMin = (slot.end - slot.start) / 60000
    for (const sess of sessoes) {
      if (sess.status === 'cancelada') continue
      const ini = new Date(sess.inicio).getTime()
      let fimReal = sess.fim ? new Date(sess.fim).getTime() : agora
      if (fimReal <= ini) fimReal = ini + 1000
      const ms = overlapMs(slot.start, slot.end, ini, fimReal)
      if (ms <= 0) continue
      const dur = Math.max(fimReal - ini, 1)
      const valorCheio = sess.status === 'encerrada' && sess.valor != null
        ? Number(sess.valor)
        : valorSessao(salasById[sess.sala_id], sess.pessoas, ini, fimReal)
      fatVip += valorCheio * (ms / dur)
      const min = ms / 60000
      ocupadoMin += min
      pessoasMin += min * (Number(sess.pessoas) || 0)
    }

    const futuro = agora < slot.start
    const emCurso = agora >= slot.start && agora < slot.end
    const peso = futuro ? 0 : emCurso ? Math.min(1, (agora - slot.start) / (slot.end - slot.start)) : 1
    const rateioFixo = rateioFixoCheio * peso
    const rateioVar = rateioVarCheio * peso
    const faturamento = fatBar + fatVip
    const custosSlot = staff + comissao + taxa + rateioFixo + rateioVar
    const lucro = faturamento - custosSlot
    const capacidadeMin = salasAtivas.reduce((s, sala) => s + (Number(sala.capacidade) || 0), 0) * slotMin * (peso || (futuro ? 0 : 1))
    return {
      start: slot.start,
      end: slot.end,
      label: `${horaLabel(slot.start)}–${horaLabel(slot.end)}`,
      fatBar, fatVip, faturamento, taxa, comissao, staff, rateioFixo, rateioVar,
      custos: custosSlot,
      lucro,
      falta: Math.max(0, -lucro),
      ocupadoMin,
      pessoasMin,
      ocupacaoTempo: salasAtivas.length && slotMin && peso ? ocupadoMin / (salasAtivas.length * slotMin * Math.max(peso, 0.0001)) : 0,
      ocupacaoLugares: capacidadeMin > 0 ? pessoasMin / capacidadeMin : 0,
      futuro,
      emCurso,
    }
  })

  const ateAgora = linhas.filter(l => !l.futuro)
  const sum = key => ateAgora.reduce((s, l) => s + l[key], 0)
  const lucro = sum('lucro')
  return {
    linhas,
    acumulado: {
      faturamento: sum('faturamento'),
      fatBar: sum('fatBar'),
      fatVip: sum('fatVip'),
      staff: sum('staff'),
      comissao: sum('comissao'),
      taxa: sum('taxa'),
      rateio: sum('rateioFixo') + sum('rateioVar'),
      lucro,
      falta: Math.max(0, -lucro),
    },
    fixosDia: fixosMes / 30,
    varDia,
  }
}
