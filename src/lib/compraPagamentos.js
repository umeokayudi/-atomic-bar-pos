import { compraDueDate, isCompraOverdue } from '../components/utils'

/** Mapa fornecedor → termo de pagamento (ex. "Dia 10") */
export function pagamentoMap(fornecedores = []) {
  const m = {}
  for (const f of fornecedores) m[f.nome] = f.pagamento
  return m
}

export function pagamentoFor(nome, map) {
  return map?.[nome] || ''
}

/** Valor pendente de uma compra */
export function compraPendingAmount(c) {
  return +c.total_real || +c.total_pago || 0
}

/** Saldo em aberto de uma fatura */
export function faturaOutstanding(f) {
  return Math.max(0, (+f.total || +f.valor || 0) - (+f.pago || 0))
}

/** Fatura vencida e ainda não quitada */
export function isFaturaOverdue(f, today = new Date().toISOString().slice(0, 10)) {
  if (f?.status === 'pago') return false
  if (!f?.data_vencimento) return false
  return f.data_vencimento < today && faturaOutstanding(f) > 0
}

/** Faturas em aberto separadas em atrasadas vs futuras */
export function splitPendingFaturas(faturas = [], today = new Date().toISOString().slice(0, 10)) {
  const overdue = []
  const future = []

  for (const f of faturas) {
    if (f.status === 'pago') continue
    const amount = faturaOutstanding(f)
    if (amount <= 0) continue
    const row = { ...f, amount, dueDate: f.data_vencimento }

    if (f.data_vencimento && f.data_vencimento < today) overdue.push(row)
    else future.push(row)
  }

  overdue.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
  future.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))

  const sum = rows => rows.reduce((a, r) => a + r.amount, 0)

  return {
    overdue,
    future,
    overdueTotal: sum(overdue),
    futureTotal: sum(future),
    pendingTotal: sum(overdue) + sum(future),
  }
}

/** Compras pendentes separadas em atrasadas vs futuras */
export function splitPendingCompras(compras = [], fornecedores = []) {
  const map = pagamentoMap(fornecedores)
  const pending = compras.filter(c => c.status_pagamento === 'pendente')
  const overdue = []
  const future = []
  const noDue = []

  for (const c of pending) {
    const pag = pagamentoFor(c.fornecedor, map)
    const due = compraDueDate(c, pag)
    const amount = compraPendingAmount(c)
    const row = { ...c, dueDate: due, amount, pagamentoTerm: pag }

    if (!due) {
      noDue.push(row)
      continue
    }
    if (isCompraOverdue(c, pag)) overdue.push(row)
    else future.push(row)
  }

  overdue.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
  future.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))

  const sum = rows => rows.reduce((a, r) => a + r.amount, 0)

  return {
    overdue,
    future,
    noDue,
    overdueTotal: sum(overdue) + sum(noDue),
    futureTotal: sum(future),
    pendingTotal: sum(overdue) + sum(future) + sum(noDue),
  }
}

/** Eventos de calendário (entradas/saídas) a partir de faturas e compras pendentes */
export function buildCashflowEvents({ faturas = [], compras = [], fornecedores = [], pagamentosPendentes = [] }) {
  const map = pagamentoMap(fornecedores)
  const today = new Date().toISOString().slice(0, 10)
  const events = []

  for (const f of faturas) {
    if (f.status === 'pago') continue
    const amount = Math.max(0, (+f.valor || +f.total || 0) - (+f.pago || 0))
    if (amount <= 0 || !f.data_vencimento) continue
    events.push({
      date: f.data_vencimento,
      type: 'in',
      label: f.bars?.nome || 'Bar',
      amount,
      status: f.data_vencimento < today ? 'atrasado' : 'a_receber',
      note: 'Fatura vencimento',
      id: f.id,
      kind: 'fatura',
    })
  }

  for (const c of compras) {
    if (c.status_pagamento !== 'pendente') continue
    const pag = pagamentoFor(c.fornecedor, map)
    const due = compraDueDate(c, pag)
    if (!due) continue
    const amount = compraPendingAmount(c)
    events.push({
      date: due,
      type: 'out',
      label: c.fornecedor || 'Fornecedor',
      amount,
      status: isCompraOverdue(c, pag) ? 'atrasado' : 'a_pagar',
      note: c.obs || 'Compra pendente',
      id: c.id,
      kind: 'compra',
      docUrl: c.foto_url || null,
    })
  }

  for (const p of pagamentosPendentes) {
    if (!p.data) continue
    events.push({
      date: p.data,
      type: 'in',
      label: p.metodo || 'Pagamento',
      amount: +p.valor || 0,
      status: 'em_analise',
      note: 'Stripe / cartão — crédito previsto',
      id: p.id,
      kind: 'pagamento',
    })
  }

  return events.sort((a, b) => (a.date || '').localeCompare(b.date || ''))
}
