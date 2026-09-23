import { montarPulso, noiteDoInstante, slotsNoite, valorSessao, ocupacaoNoite } from './operacao.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const noite = '2026-09-23'
assert(noiteDoInstante(new Date('2026-09-23T02:00:00+09:00')) === '2026-09-22', 'madrugada pertence à noite anterior')
assert(noiteDoInstante(new Date('2026-09-23T22:00:00+09:00')) === '2026-09-23', 'depois de abrir é a noite de hoje')
assert(slotsNoite(noite, '21:00', '05:00').length === 16, '8 horas / 30 min')

const sala = { id: 'sala1', preco_hora: 6000, taxa_pessoa: 0, minimo_minutos: 60, capacidade: 6, ativo: true }
const inicio = new Date('2026-09-23T21:00:00+09:00').getTime()
assert(valorSessao(sala, 4, inicio, inicio + 30 * 60000) === 6000, 'mínimo de 1 hora')
assert(valorSessao(sala, 4, inicio, inicio + 90 * 60000) === 9000, '1h30')

const agora = new Date('2026-09-23T21:40:00+09:00').getTime()
const pulso = montarPulso({
  noite,
  agora,
  vendas: [{ data_venda: '2026-09-23T21:10:00+09:00', total: 10000, forma_pagamento: 'dinheiro' }],
  comissoes: [{ data: '2026-09-23T21:10:00+09:00', valor: 2000 }],
  turnos: [{ entrada: '2026-09-23T21:00:00+09:00', saida: null, valor_hora: 2000 }],
  custos: [{ natureza: 'fixo', ativo: true, valor: 300000, frequencia: 'mensal' }],
  salas: [sala],
  sessoes: [{
    sala_id: 'sala1', inicio: '2026-09-23T21:00:00+09:00', fim: null, pessoas: 4, status: 'aberta',
  }],
})

const primeira = pulso.linhas[0]
assert(primeira.emCurso === false && pulso.linhas[1].emCurso === true, 'segunda faixa está em curso às 21:40')
assert(Math.round(primeira.fatBar) === 10000, 'venda cai na primeira meia hora')
assert(Math.round(primeira.comissao) === 2000, 'comissão na faixa')
assert(Math.round(primeira.staff) === 1000, 'meia hora a ¥2.000')
assert(primeira.fatVip > 0, 'VIP rateado na faixa')
assert(pulso.acumulado.falta === 0 || pulso.acumulado.lucro !== 0, 'acumulado calculado')
assert(pulso.acumulado.faturamento > 10000, 'faturamento junta bar e VIP')

const occ = ocupacaoNoite([sala], [{
  sala_id: 'sala1', inicio: '2026-09-23T21:00:00+09:00', fim: '2026-09-23T22:00:00+09:00', pessoas: 3, status: 'encerrada',
}], noite, '21:00', '05:00', new Date('2026-09-23T23:00:00+09:00').getTime())
assert(Math.round(occ.tempo * 100) === 50, '1h de 2h abertas = 50% do tempo')
assert(Math.round(occ.lugares * 100) === 25, '3 de 6 lugares na hora ocupada, metade do tempo = 25%')

const curto = montarPulso({
  noite: '2026-09-23',
  abre: '13:00',
  fecha: '18:00',
  agora: new Date('2026-09-23T14:40:00+09:00').getTime(),
  salas: [sala],
  sessoes: [{
    sala_id: 'sala1',
    inicio: '2026-09-23T14:35:05+09:00',
    fim: '2026-09-23T14:35:01+09:00',
    valor: 8000,
    status: 'encerrada',
    pessoas: 4,
  }],
})
assert(Math.round(curto.acumulado.fatVip) === 8000, 'sessão encerrada entra na faixa mesmo com fim anterior')

console.log('operacao tests ok')
