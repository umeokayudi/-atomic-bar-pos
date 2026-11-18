// Roles and scopes on /api/bar/live-db: a bar login can never reach another bar's rows.
import assert from 'node:assert/strict'
import { scopeLiveRequest, scopePatch } from '../../api/_liveScope.js'

const A = 'bar-a', B = 'bar-b'
const owner = { perfil: { role: 'cliente', bar_id: A } }
const till = { perfil: { role: 'caixa', bar_id: A } }
const hq = { perfil: { role: 'admin', bar_id: null } }

// 1. The browser asks for another bar: the filter is replaced by the login's own bar.
let r = scopeLiveRequest(owner, { table: 'pos_vendas', mode: 'select', filters: [{ op: 'eq', k: 'bar_id', v: B }] })
assert.deepEqual(r.filters, [{ op: 'eq', k: 'bar_id', v: A }])
// 2. "Everything except bar x" trick.
r = scopeLiveRequest(till, { table: 'bar_guests', mode: 'delete', filters: [{ op: 'neq', k: 'bar_id', v: 'x' }, { op: 'eq', k: 'id', v: '1' }] })
assert.deepEqual(r.filters, [{ op: 'eq', k: 'id', v: '1' }, { op: 'eq', k: 'bar_id', v: A }])
// 3. Writing a row for another bar is refused; a row without bar gets the login's bar.
assert.equal(scopeLiveRequest(owner, { table: 'bar_guests', mode: 'insert', insertRows: [{ id: '1', bar_id: B }] }).status, 403)
assert.equal(scopeLiveRequest(owner, { table: 'bar_guests', mode: 'upsert', insertRows: [{ id: '1' }] }).insertRows[0].bar_id, A)
// 4. Sale lines: only lines of this bar's sales.
r = scopeLiveRequest(till, { table: 'pos_vendas_itens', mode: 'select', filters: [] }, { ownSaleIds: ['s1'] })
assert.deepEqual(r.filters, [{ op: 'in', k: 'pos_venda_id', v: ['s1'] }])
r = scopeLiveRequest(till, { table: 'pos_vendas_itens', mode: 'select', filters: [] }, { ownSaleIds: [] })
assert.deepEqual(r.filters[0].v, ['__none__'])
assert.equal(scopeLiveRequest(till, { table: 'pos_vendas_itens', mode: 'insert', insertRows: [{ pos_venda_id: 's9' }] }, { ownSaleIds: ['s1'] }).status, 403)
assert.ok(!scopeLiveRequest(till, { table: 'pos_vendas_itens', mode: 'insert', insertRows: [{ pos_venda_id: 's1' }] }, { ownSaleIds: ['s1'] }).error)
// 5. Staff files never through this route; the bar location is read-only and only its own.
assert.equal(scopeLiveRequest(owner, { table: 'staff_extras', mode: 'select' }).status, 403)
assert.equal(scopeLiveRequest(owner, { table: 'bar_geo', mode: 'update', filters: [{ op: 'eq', k: 'id', v: B }] }).status, 403)
assert.deepEqual(scopeLiveRequest(owner, { table: 'bar_geo', mode: 'select', filters: [{ op: 'eq', k: 'id', v: B }] }).filters, [{ op: 'eq', k: 'id', v: A }])
// 6. A bar login with no bar, and logins that are neither bar nor HQ, get nothing.
assert.equal(scopeLiveRequest({ perfil: { role: 'caixa', bar_id: null } }, { table: 'pos_vendas', mode: 'select' }).status, 403)
assert.equal(scopeLiveRequest({ perfil: { role: 'fornecedor' } }, { table: 'pos_vendas', mode: 'select' }).status, 403)
assert.equal(scopeLiveRequest({ perfil: { role: 'staff' } }, { table: 'bar_guests', mode: 'select' }).status, 403)
assert.ok(!scopeLiveRequest({ perfil: { role: 'staff' } }, { table: 'jbm_company', mode: 'select' }).error)
// 7. HQ is not limited.
assert.deepEqual(scopeLiveRequest(hq, { table: 'pos_vendas', mode: 'select', filters: [{ op: 'eq', k: 'bar_id', v: B }] }).filters, [{ op: 'eq', k: 'bar_id', v: B }])
// 8. An update cannot move a row to another bar.
assert.deepEqual(scopePatch(owner, { nome: 'x', bar_id: B }), { nome: 'x' })
assert.deepEqual(scopePatch(hq, { bar_id: B }), { bar_id: B })
console.log('liveScope: 8 groups passed')
