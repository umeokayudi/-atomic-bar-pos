import assert from 'node:assert/strict'
import { commitPosSale } from '../src/lib/atomicPos.js'

const demo = {
  __localDemo: true,
  from() {
    throw new Error('demo sale must not write')
  },
}

const blocked = await commitPosSale(demo, {
  bar: { id: 'demo-bar' },
  cart: [{ nome: 'Highball', preco: 800, qtd: 1 }],
})
assert.equal(blocked.ok, false)
assert.equal(blocked.errorKey, 'atomicPos.demoSaleBlocked')

const remote = {
  from() {
    throw new Error('empty cart must return before a write')
  },
}
const empty = await commitPosSale(remote, { bar: { id: 'bar' }, cart: [] })
assert.equal(empty.ok, false)
assert.equal(empty.errorKey, 'atomicPos.cartEmpty')

console.log('demo guard tests passed')
