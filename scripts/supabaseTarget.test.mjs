import assert from 'node:assert/strict'
import {
  assertServerMayConnect,
  resolveDataTarget,
  DRINKS_URL,
} from '../src/lib/supabaseTarget.js'
import { createLocalDemoClient, DEMO_BAR_ID } from '../src/lib/localDemoClient.js'

const DRINKS = 'ojirgkqtqvugqktyuhem'
const HOLDING = 'fxsakrshmldmkdmbevna'
const drinksAnon = `header.${Buffer.from(JSON.stringify({ ref: DRINKS, role: 'anon' })).toString('base64url')}.sig`
const holdingAnon = `header.${Buffer.from(JSON.stringify({ ref: HOLDING, role: 'anon' })).toString('base64url')}.sig`
const safeRef = 'abcdefghijklmnopqrst'
const safeAnon = `header.${Buffer.from(JSON.stringify({ ref: safeRef, role: 'anon' })).toString('base64url')}.sig`

const production = resolveDataTarget({ channel: 'production', url: '', anonKey: '', drinksAnon })
assert.equal(production.mode, 'remote')
assert.equal(production.url, DRINKS_URL)
assert.equal(production.key, drinksAnon)

const previewMissing = resolveDataTarget({ channel: 'preview', url: '', anonKey: '' })
assert.equal(previewMissing.mode, 'local')
assert.equal(previewMissing.url, '')

const previewDrinks = resolveDataTarget({
  channel: 'preview',
  url: DRINKS_URL,
  anonKey: drinksAnon,
})
assert.equal(previewDrinks.mode, 'local')

const previewHolding = resolveDataTarget({
  channel: 'preview',
  url: `https://${HOLDING}.supabase.co`,
  anonKey: holdingAnon,
})
assert.equal(previewHolding.mode, 'local')

const devMissing = resolveDataTarget({ channel: 'development', url: '', anonKey: 'placeholder' })
assert.equal(devMissing.mode, 'local')

const previewSafe = resolveDataTarget({
  channel: 'preview',
  url: `https://${safeRef}.supabase.co`,
  anonKey: safeAnon.padEnd(80, 'x'),
})
assert.equal(previewSafe.mode, 'remote')
assert.equal(previewSafe.url, `https://${safeRef}.supabase.co`)
assert.doesNotMatch(previewSafe.url, new RegExp(DRINKS))
assert.doesNotMatch(previewSafe.url, new RegExp(HOLDING))

const previous = process.env.VERCEL_ENV
process.env.VERCEL_ENV = 'preview'
assert.throws(() => assertServerMayConnect(DRINKS_URL), /Preview refuses protected Supabase projects/)
assert.throws(() => assertServerMayConnect(`https://${HOLDING}.supabase.co`), /Preview refuses/)
assert.throws(() => assertServerMayConnect(''), /Preview refuses/)
assert.doesNotThrow(() => assertServerMayConnect(`https://${safeRef}.supabase.co`))
process.env.VERCEL_ENV = 'production'
assert.doesNotThrow(() => assertServerMayConnect(DRINKS_URL))
if (previous == null) delete process.env.VERCEL_ENV
else process.env.VERCEL_ENV = previous

const client = createLocalDemoClient()
const { data: bar } = await client.from('bars').select('*').eq('id', DEMO_BAR_ID).single()
assert.equal(bar.nome, 'Atomic Bar')
const { data: sales } = await client.from('pos_vendas').select('*')
assert.ok(sales.length > 0)
assert.ok(sales.every(row => row.demo === true && row.bar_id === DEMO_BAR_ID && row.obs === 'DEMO'))
const { data: vendas } = await client.from('vendas').select('*')
assert.deepEqual(vendas, [])
const { data: spaces } = await client.from('bar_spaces').select('nome').eq('bar_id', DEMO_BAR_ID)
assert.ok(spaces.length >= 8)
assert.equal(spaces.some(row => 'total' in row), false)
const session = await client.auth.getSession()
assert.equal(session.data.session.access_token, 'local-demo')
assert.equal(session.data.session.access_token.includes('service_role'), false)

console.log('supabase target tests passed')
