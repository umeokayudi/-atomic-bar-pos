import assert from 'node:assert/strict'
import { changedFields, auditSubject } from '../src/lib/audit.js'

assert.deepEqual(changedFields({ a: 1, b: 2, updated_at: 1 }, { a: 1, b: 3, updated_at: 2 }), ['b'])
assert.deepEqual(changedFields(null, { a: 1 }), [])
assert.equal(auditSubject({ depois: { numero: 'RY-202610-002', total: 300000 } }), 'RY-202610-002')
assert.equal(auditSubject({ antes: { nome: 'TESTE-MUSE' } }), 'TESTE-MUSE')
assert.equal(auditSubject({ registro_id: 'abcdef1234' }), 'abcdef12')
console.log('audit ok')
