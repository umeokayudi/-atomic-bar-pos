/** Each bar's colour, logo and name in its app (HQ → Bars). node scripts/barBrand.test.mjs */
import assert from 'node:assert/strict'
import {
  ATOMIC_BAR_ID, ATOMIC_RED, BRAND_COLORS, brandColorOf, brandRow, brandTokens, cleanHex, cleanLogo, contrast, resolveBrand,
} from '../src/lib/barBrand.js'

let n = 0
const test = (name, fn) => { fn(); n++; console.log(`ok ${n} - ${name}`) }

test('only hex colours pass', () => {
  assert.equal(cleanHex('#ABC'), '#aabbcc')
  assert.equal(cleanHex('#D7191F'), '#d7191f')
  assert.equal(cleanHex('var(--blue)'), '')
  assert.equal(cleanHex('red; background:url(x)'), '')
})

test('only https or inline image logos pass', () => {
  assert.equal(cleanLogo('javascript:alert(1)'), '')
  assert.equal(cleanLogo('data:text/html;base64,PGI+'), '')
  assert.equal(cleanLogo('data:image/png;base64,iVBOR'), 'data:image/png;base64,iVBOR')
  assert.equal(cleanLogo('https://cdn.example.com/l.png'), 'https://cdn.example.com/l.png')
})

test('colour: HQ pick first, then Atomic red for Atomic, then the old bars.cor', () => {
  assert.equal(brandColorOf({ id: ATOMIC_BAR_ID, nome: 'Atomic', cor: '#185FA5' }), ATOMIC_RED.toLowerCase())
  assert.equal(brandColorOf({ id: ATOMIC_BAR_ID, nome: 'Atomic', marca: { cor: '#1C7ED6' } }), '#1c7ed6')
  assert.equal(brandColorOf({ id: 'x', nome: 'Kuri', cor: '#2F9E44' }), '#2f9e44')
  assert.equal(brandColorOf({ id: 'x', nome: 'Kuri', cor: 'var(--blue)' }), '')
})

test('Atomic today: red and black with the atom, no logo', () => {
  const b = resolveBrand({ id: ATOMIC_BAR_ID, nome: 'Atomic', cor: '#185FA5' })
  assert.deepEqual(b, { atomic: true, theme: 'atomic', name: 'Atomic', color: '#d7191f', logo: '' })
})

test('any bar picking Atomic red gets the red/black theme but keeps its own mark', () => {
  const b = resolveBrand({ id: 'k', nome: 'Kuri Bar', marca: { cor: ATOMIC_RED } })
  assert.equal(b.theme, 'atomic')
  assert.equal(b.atomic, false)
})

test('a bar with no colour keeps the JBM look', () => {
  assert.equal(resolveBrand({ id: 'k', nome: 'Kuri Bar' }).theme, '')
})

test('logo from HQ wins over an old logo_url', () => {
  const b = resolveBrand({ id: 'k', nome: 'K', logo_url: 'https://a/x.png', marca: { logo: 'data:image/png;base64,AA' } })
  assert.equal(b.logo, 'data:image/png;base64,AA')
})

test('tokens: readable accent and button text for every quick colour, both themes', () => {
  for (const { hex } of BRAND_COLORS) {
    const tk = brandTokens(hex)
    assert.ok(contrast(tk['--bb-accent'], '#ffffff') >= 3, `${hex} light accent`)
    assert.ok(contrast(tk['--bb-accent-d'], '#161618') >= 4.5, `${hex} dark accent`)
    assert.ok(contrast(tk['--bb-on'], tk['--bb-accent']) >= 3, `${hex} button text`)
    assert.ok(contrast('#ffffff', tk['--bb-chrome']) >= 7, `${hex} sidebar text`)
  }
  // A pale yellow becomes a darker yellow for text on white, with dark text on its buttons.
  const y = brandTokens('#FFE066')
  assert.ok(contrast(y['--bb-accent'], '#ffffff') >= 3)
  assert.equal(brandTokens('nope'), null)
})

test('bar_brand row: id is the bar id, junk dropped', () => {
  const r = brandRow('bar-1', { cor: '#ABC', logo: 'javascript:x' })
  assert.equal(r.id, 'bar-1')
  assert.equal(r.bar_id, 'bar-1')
  assert.equal(r.cor, '#aabbcc')
  assert.equal(r.logo, null)
})

console.log(`\n${n} tests passed`)
