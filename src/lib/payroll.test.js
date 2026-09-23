import { calcularAPagar, proximoPagamento, taxaComissao, custoMensalEstimado, periodoAtual } from './payroll.js'
import { fmt } from './format.js'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

// Weekly payday: Friday (5)
assert(proximoPagamento({ ciclo_pagamento: 'semanal', dia_pagamento: 5 }, '2026-09-23') === '2026-09-25', 'weekly friday')
assert(proximoPagamento({ ciclo_pagamento: 'mensal', dia_pagamento: 25 }, '2026-09-23') === '2026-09-25', 'monthly this month')
assert(proximoPagamento({ ciclo_pagamento: 'mensal', dia_pagamento: 10 }, '2026-09-23') === '2026-10-10', 'monthly next month')
assert(proximoPagamento({ ciclo_pagamento: 'quinzenal' }, '2026-09-23') === '2026-10-01', 'quinzenal after 15')
assert(proximoPagamento({ ciclo_pagamento: 'quinzenal' }, '2026-09-10') === '2026-09-15', 'quinzenal before 15')

const staffHora = {
  id: 's1',
  forma_pagamento: 'hora',
  valor_hora: 1500,
  ciclo_pagamento: 'mensal',
  dia_pagamento: 25,
}
const due = calcularAPagar(staffHora, {
  horas: [{ staff_id: 's1', data: '2026-09-10', horas: 8 }],
  comissoes: [{ cast_id: 's1', data: '2026-09-10', valor: 9999, pago: false }],
}, '2026-09-23')
assert(due.total === 12000, 'hourly ignores commission, 8*1500')
assert(due.vencimento === '2026-09-25', 'due date')

const staffComm = {
  id: 's2',
  forma_pagamento: 'comissao',
  ciclo_pagamento: 'mensal',
  dia_pagamento: 25,
}
const dueC = calcularAPagar(staffComm, {
  horas: [{ staff_id: 's2', data: '2026-09-10', horas: 8 }],
  comissoes: [{ cast_id: 's2', data: '2026-09-10', valor: 3000, pago: false }],
}, '2026-09-23')
assert(dueC.total === 3000, 'commission only')

assert(taxaComissao({ forma_pagamento: 'hora' }, 3000) === 0, 'hora no commission')
assert(taxaComissao({ forma_pagamento: 'comissao', percentual_comissao: 30 }, 2000) === 0.3, 'percent')
assert(taxaComissao({ forma_pagamento: 'comissao', contrato: 'freelancer' }, 1000) === 0.5, 'freelancer default')
assert(custoMensalEstimado({ natureza: 'fixo', valor: 120000, frequencia: 'anual' }) === 10000, 'anual / 12')
assert(fmt(1234) === '¥1,234', 'fmt')

const p = periodoAtual({ ciclo_pagamento: 'mensal', dia_pagamento: 25 }, '2026-09-23')
assert(p.fim === '2026-09-25', 'periodo fim')

console.log('payroll tests ok')
