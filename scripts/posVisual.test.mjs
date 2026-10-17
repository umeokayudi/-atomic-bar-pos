// Till tile colours: base spirit on the left, mixer on the right (src/lib/posVisual.js).
import assert from 'node:assert/strict'
import { drinkParts, itemVisual } from '../src/lib/posVisual.js'

const parts = (categoria, nome) => {
  const p = drinkParts({ categoria, nome })
  return [p.base?.id || null, p.mixer?.id || null]
}

assert.deepEqual(parts('Vodka Base', 'Vodka & Cranberry'), ['vodka', 'cranberry'])
assert.deepEqual(parts('Rum Base', 'Rum & Cranberry'), ['rum', 'cranberry'])
assert.deepEqual(parts('Rum Base', 'Cuba Libre'), ['rum', 'cola'])
assert.deepEqual(parts('Gin Base', 'Gin & Tonic — Hendricks (VIP)'), ['gin', 'tonic'])
assert.deepEqual(parts('Champagne', 'Mimosa'), ['champagne', 'orange'])
assert.deepEqual(parts('Hennessy', 'Hennessy Straight / On the Rocks'), ['cognac', null])
assert.deepEqual(parts('Tequila Base', 'Tequila Shot (Cuervo)'), ['tequila', null])
assert.deepEqual(parts('Soft Drinks', 'Ginger Ale'), [null, 'gingerale'])
assert.deepEqual(parts('Vodka Base', 'Grey Goose & Apple Juice (VIP)'), ['vodka', 'apple'])

// Same base gives the same left colour; same mixer the same right colour.
const a = drinkParts({ categoria: 'Vodka Base', nome: 'Vodka & Cranberry' })
const b = drinkParts({ categoria: 'Rum Base', nome: 'Rum & Cranberry' })
const c = drinkParts({ categoria: 'Vodka Base', nome: 'Vodka & Soda' })
assert.equal(a.mixer.color, b.mixer.color)
assert.equal(a.base.color, c.base.color)
assert.notEqual(a.base.color, b.base.color)

assert.match(itemVisual({ categoria: 'Vodka Base', nome: 'Vodka & Cranberry' }).background, /^linear-gradient\(90deg, #[0-9a-f]+ 0 50%, #[0-9a-f]+ 50% 100%\)$/)
assert.equal(itemVisual({ categoria: 'Beer', nome: 'Asahi' }).emoji, '🍺')

console.log('posVisual: ok')
