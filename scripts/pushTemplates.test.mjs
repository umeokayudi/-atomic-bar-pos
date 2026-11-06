import assert from 'node:assert/strict'
import { cleanPrefs, cleanStyle, cleanVars, clockPushVars, fill, renderPush, PUSH_TYPE_IDS, DEFAULT_TEXTS } from '../src/lib/pushTemplates.js'
import { monthSummary } from '../src/lib/pushMonth.js'
import { colorDiscPng, urlFor } from '../api/_push.js'

// Every kind has a default text in every tone and language.
for (const lang of ['en', 'ja']) for (const tone of ['party', 'neutral', 'short']) for (const id of PUSH_TYPE_IDS) {
  assert.ok(DEFAULT_TEXTS[lang][tone][id], `${lang}/${tone}/${id}`)
}

// Values: money as yen, unknown keys dropped, strings cut.
const v = cleanVars('sale', { amount: 12800, tab: 'Table 3\nx', method: 'card', evil: '<b>' })
assert.equal(v.amount, '¥12,800')
assert.equal(v.tab, 'Table 3 x')
assert.equal(v.evil, undefined)
assert.equal(v._money, 12800)
assert.equal(cleanVars('shift_close', { diff: -500 }).diff, '−¥500')

// Empty values leave no stray separators.
assert.equal(fill('Sale {amount} · {tab} · {method}', { amount: '¥1' }), 'Sale ¥1')
assert.equal(fill('Order ({tab})', {}), 'Order')

// Title = bar name; congratulations on money above zero; none on clock or on zero.
const sale = renderPush({ type: 'sale', vars: cleanVars('sale', { amount: 5000 }), lang: 'en', style: {}, barName: 'Atomic' })
assert.equal(sale.title, 'Atomic')
assert.match(sale.body, /^🎉 Congratulations! Sale of ¥5,000/)
const clock = renderPush({ type: 'clock_in', vars: cleanVars('clock_in', { who: 'Ken', time: '19:00' }), lang: 'en', barName: 'Atomic' })
assert.doesNotMatch(clock.body, /Congratulations/)
const zero = renderPush({ type: 'day_close', vars: cleanVars('day_close', { total: 0 }), lang: 'en', barName: 'A' })
assert.doesNotMatch(zero.body, /Congratulations/)

// The owner's own text, own congratulations, emoji off.
const own = renderPush({
  type: 'sale', vars: cleanVars('sale', { amount: 1000, who: 'Mai' }), lang: 'ja',
  style: { tone: 'neutral', emoji: false, congratsText: 'Parabéns 🎉', texts: { sale: 'Venda {amount} por {who} 🍸' } }, barName: 'Bar X',
})
assert.equal(own.body, 'Parabéns Venda ¥1,000 por Mai')
const noCheer = renderPush({ type: 'sale', vars: cleanVars('sale', { amount: 1000 }), lang: 'en', style: { congrats: false } })
assert.doesNotMatch(noCheer.body, /Congratulations/)

// Style and prefs cleaning.
const st = cleanStyle({ tone: 'loud', texts: { sale: 'x'.repeat(500), nope: 'y' } })
assert.equal(st.tone, 'party')
assert.equal(st.texts.sale.length, 200)
assert.equal(st.texts.nope, undefined)
const pr = cleanPrefs({ sale: false, junk: true })
assert.equal(pr.sale, false)
assert.equal(pr.order, true)
assert.equal(pr.junk, undefined)

// Clock: Tokyo time and hours worked.
const c = clockPushVars({ nome: 'Ken', at: '2026-11-06T18:10:00Z', inAt: '2026-11-06T10:02:00Z' })
assert.equal(c.time, '03:10')
assert.equal(c.hours, '8h 08m')

// Month: nights of the month only (a sale at 02:00 on the 1st belongs to the 31st), refunds off.
const m = monthSummary([
  { total: 1000, criado_em: '2026-10-31T17:00:00Z' }, // 02:00 JST Nov 1 → night of Oct 31
  { total: 3000, refunded: 1000, criado_em: '2026-10-10T12:00:00Z' },
  { total: 9000, criado_em: '2026-11-01T12:00:00Z' }, // November
], '2026-10')
assert.deepEqual(m, { total: 3000, tickets: 2, bestNight: '2026-10-10', bestTotal: 2000 })

// Icon PNG is a real PNG; taps open the right screen.
const png = colorDiscPng('#d7191f')
assert.equal(png.subarray(1, 4).toString(), 'PNG')
assert.equal(urlFor('order'), '/bar/bar')
assert.equal(urlFor('sale'), '/bar/pos')
console.log('pushTemplates ok')
