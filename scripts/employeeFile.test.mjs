import assert from 'node:assert/strict'
import { contractState, isSystemLogin, initials } from '../src/lib/employeeFile.js'
assert.equal(isSystemLogin({ role: 'caixa' }), true)
assert.equal(isSystemLogin({ role: 'cliente' }), true)
assert.equal(isSystemLogin({ role: 'bar_staff' }), false)
assert.equal(isSystemLogin({}), false)
// A till login linked to an employee file is a person again (Staff page, payroll); owner and tablets never are.
assert.equal(isSystemLogin({ role: 'caixa', person_id: 'p1' }), false)
assert.equal(isSystemLogin({ role: 'cliente', person_id: 'p1' }), true)
assert.equal(isSystemLogin({ role: 'caixa', lane: true, person_id: 'p1' }), true)
assert.deepEqual(contractState({}, '2026-10-12'), { state: 'none', days: null })
assert.deepEqual(contractState({ contrato_tipo: 'part' }, '2026-10-12'), { state: 'open', days: null })
assert.equal(contractState({ contrato_fim: '2026-10-30' }, '2026-10-12').state, 'ending')
assert.equal(contractState({ contrato_fim: '2027-03-01' }, '2026-10-12').state, 'active')
assert.equal(contractState({ contrato_fim: '2026-10-01' }, '2026-10-12').state, 'ended')
assert.equal(initials('Funcionário Atomic'), 'FA')
console.log('employeeFile ok')
