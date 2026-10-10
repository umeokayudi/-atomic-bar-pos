/**
 * sql/floor_comandas.sql against a disposable local Postgres.
 *
 *   FLOOR_PG_TEST_URL=postgres://postgres@localhost:55432/postgres npm run test:floor:pg
 *
 * The URL must point at a server where this script may create and drop the database `jbm_floor_test`.
 * Refuses Supabase hosts. Without the variable the suite is skipped.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const url = process.env.FLOOR_PG_TEST_URL
if (!url) {
  console.log('floor/comandas postgres tests skipped (set FLOOR_PG_TEST_URL to a disposable server)')
  process.exit(0)
}
if (/supabase\.(co|com)/i.test(url)) {
  console.error('refusing a Supabase host')
  process.exit(1)
}

const admin = new pg.Client({ connectionString: url })
await admin.connect()
await admin.query('DROP DATABASE IF EXISTS jbm_floor_test')
await admin.query('CREATE DATABASE jbm_floor_test')
await admin.end()

const dbUrl = new URL(url)
dbUrl.pathname = '/jbm_floor_test'
const db = new pg.Client({ connectionString: dbUrl.toString() })
await db.connect()

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
await db.query(read('scripts/fixtures/drinks_baseline.sql'))

const bar = randomUUID()
const otherBar = randomUUID()
const gerente = randomUUID()
const caixa = randomUUID()
const stranger = randomUUID()
const gin = randomUUID()
const beer = randomUUID()
const bottle = randomUUID()

await db.query(`INSERT INTO bars (id, nome) VALUES ($1, 'Atomic'), ($2, 'Other')`, [bar, otherBar])
await db.query(`INSERT INTO perfis (id, nome, role, bar_id) VALUES ($1,'G','gerente',$4), ($2,'C','caixa',$4), ($3,'S','gerente',$5)`,
  [gerente, caixa, stranger, bar, otherBar])
await db.query(`INSERT INTO drink_menu (id, bar_id, nome, categoria, preco_venda) VALUES ($1,$3,'Gin Tonic','Cocktails',1200), ($2,$3,'Beer','Beer',800)`,
  [gin, beer, bar])
await db.query(`INSERT INTO produtos (id, nome, categoria, drinks_por_garrafa) VALUES ($1, 'Gin 700ml', 'Gin', 20)`, [bottle])
// Legacy floor: 3 standard + 1 vip + 1 counter, and a closed legacy tab.
await db.query(`INSERT INTO mesas (bar_id, nome, tipo, ativo) VALUES ($1,'T1','standard',true),($1,'T2','standard',true),($1,'T3','standard',true),($1,'VIP 1','vip',true),($1,'Counter','counter',true)`, [bar])
await db.query(`INSERT INTO tabs (bar_id, mesa_nome, status, total) VALUES ($1, 'T1', 'closed', 5000)`, [bar])

await db.query(read('sql/pos_start.sql'))
await db.query(read('sql/floor_comandas.sql'))
await db.query(read('sql/floor_comandas.sql')) // idempotent

async function as(user, fn) {
  await db.query('BEGIN')
  try {
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)`, [user])
    await db.query('SET LOCAL ROLE authenticated')
    const out = await fn()
    await db.query('COMMIT')
    return out
  } catch (e) {
    await db.query('ROLLBACK')
    throw e
  }
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const all = async (sql, params) => (await db.query(sql, params)).rows
let passed = 0
async function test(name, fn) {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}

console.log('floor_comandas.sql')

await test('legacy mesas are copied into an active layout; mesas and tabs untouched', async () => {
  const tables = await all(`SELECT nome, forma, capacidade, legacy_mesa_id FROM floor_tables WHERE bar_id = $1 ORDER BY nome`, [bar])
  assert.equal(tables.length, 5)
  assert.ok(tables.every(t => t.legacy_mesa_id))
  assert.equal(tables.find(t => t.nome === 'Counter').forma, 'bar')
  assert.equal(tables.find(t => t.nome === 'VIP 1').capacidade, 6)
  assert.equal((await one(`SELECT count(*)::int n FROM floor_layouts WHERE bar_id = $1 AND ativo`, [bar])).n, 1)
  assert.equal((await one(`SELECT count(*)::int n FROM mesas`)).n, 5)
  assert.equal((await one(`SELECT count(*)::int n FROM tabs`)).n, 1)
})

const layout = (await one(`SELECT id, versao FROM floor_layouts WHERE bar_id = $1`, [bar]))
const t1 = (await one(`SELECT id FROM floor_tables WHERE bar_id = $1 AND nome = 'T1'`, [bar])).id
const t2 = (await one(`SELECT id FROM floor_tables WHERE bar_id = $1 AND nome = 'T2'`, [bar])).id

await test('manager saves a layout; version check stops a stale save', async () => {
  const current = await all(`SELECT id, nome, forma, x, y, largura, altura, capacidade FROM floor_tables WHERE layout_id = $1`, [layout.id])
  const payload = current.map(t => (t.id === t1 ? { ...t, x: 333, y: 222, capacidade: 6 } : t))
  payload.push({ nome: 'Rooftop 1', forma: 'round', x: 500, y: 500, largura: 90, altura: 90, capacidade: 2, sector_key: 'roof' })
  const res = await as(gerente, () => one(
    `SELECT floor_save_layout($1, $2, 'Salão', 1200, 800, $3::jsonb, $4::jsonb) r`,
    [layout.id, layout.versao, JSON.stringify([{ key: 'roof', nome: 'Rooftop', cor: '#83B7A0' }]), JSON.stringify(payload)],
  ))
  assert.equal(res.r.versao, layout.versao + 1)
  const moved = await one(`SELECT x, y, capacidade FROM floor_tables WHERE id = $1`, [t1])
  assert.equal(+moved.x, 333)
  assert.equal(moved.capacidade, 6)
  const roof = await one(`SELECT ft.nome, fs.nome sector FROM floor_tables ft JOIN floor_sectors fs ON fs.id = ft.sector_id WHERE ft.nome = 'Rooftop 1'`)
  assert.equal(roof.sector, 'Rooftop')
  await assert.rejects(
    as(gerente, () => db.query(`SELECT floor_save_layout($1, $2, 'x', 1200, 800, '[]', '[]')`, [layout.id, layout.versao])),
    /changed on another device/,
  )
})

await test('cashier cannot edit the layout; another bar cannot even see it', async () => {
  await assert.rejects(
    as(caixa, () => db.query(`SELECT floor_save_layout($1, 2, 'x', 1200, 800, '[]', '[]')`, [layout.id])),
    /not (allowed|found)/,
  )
  const seen = await as(stranger, () => all(`SELECT id FROM floor_tables WHERE bar_id = $1`, [bar]))
  assert.equal(seen.length, 0)
  const seenOwn = await as(caixa, () => all(`SELECT id FROM floor_tables WHERE bar_id = $1`, [bar]))
  assert.equal(seenOwn.length, 6)
})

let tabA, tabB
await test('open a tab on a table (idempotent key) and add lines at menu price only', async () => {
  tabA = (await as(caixa, () => one(`SELECT comanda_open($1, '', $2, 3, 'Ken', 10, 'open-key-001') id`, [bar, t1]))).id
  const again = (await as(caixa, () => one(`SELECT comanda_open($1, '', $2, 3, 'Ken', 10, 'open-key-001') id`, [bar, t1]))).id
  assert.equal(again, tabA)
  const row = await one(`SELECT nome, mesa_nome, pessoas FROM pos_comandas WHERE id = $1`, [tabA])
  assert.equal(row.nome, 'T1')
  await assert.rejects(
    as(caixa, () => db.query(`SELECT comanda_add_items($1, $2::jsonb)`, [tabA, JSON.stringify([{ drink_menu_id: gin, nome: 'Gin Tonic', qtd: 1, preco_unitario: 100 }])])),
    /price changed/,
  )
  const totals = (await as(caixa, () => one(`SELECT comanda_add_items($1, $2::jsonb, 'add-key-0001') t`, [tabA, JSON.stringify([
    { drink_menu_id: gin, nome: 'Gin Tonic', qtd: 3, preco_unitario: 1200 },
    { drink_menu_id: beer, nome: 'Beer', qtd: 2, preco_unitario: 800 },
  ])]))).t
  assert.equal(+totals.itens, 3 * 1200 + 2 * 800)
  // Same key again (double tap on Send) adds nothing.
  const again2 = (await as(caixa, () => one(`SELECT comanda_add_items($1, $2::jsonb, 'add-key-0001') t`, [tabA, JSON.stringify([{ drink_menu_id: beer, nome: 'Beer', qtd: 9, preco_unitario: 800 }])]))).t
  assert.equal(+again2.itens, 5200)
})

await test('a table with an open tab cannot be removed', async () => {
  await assert.rejects(as(gerente, () => db.query(`DELETE FROM floor_tables WHERE id = $1`, [t1])), /open tab/)
  // Moving it is fine.
  await as(gerente, () => db.query(`UPDATE floor_tables SET x = 10 WHERE id = $1`, [t1]))
})

await test('transfer part of a line to another tab, then merge back', async () => {
  tabB = (await as(caixa, () => one(`SELECT comanda_open($1, 'Bar seat', $2, 1, null, 0, null) id`, [bar, t2]))).id
  const ginLine = (await one(`SELECT id FROM pos_comanda_itens WHERE comanda_id = $1 AND nome = 'Gin Tonic'`, [tabA])).id
  await as(caixa, () => db.query(`SELECT comanda_transfer_items($1, $2, $3::jsonb)`, [tabA, tabB, JSON.stringify([{ item: ginLine, qtd: 1 }])]))
  const a = await one(`SELECT comanda_totals($1) t`, [tabA])
  const b = await one(`SELECT comanda_totals($1) t`, [tabB])
  assert.equal(+a.t.itens, 2 * 1200 + 2 * 800)
  assert.equal(+b.t.itens, 1200)
  await as(caixa, () => db.query(`SELECT comanda_merge($1, $2)`, [tabB, tabA]))
  const merged = await one(`SELECT status, merged_into FROM pos_comandas WHERE id = $1`, [tabB])
  assert.equal(merged.status, 'merged')
  assert.equal(merged.merged_into, tabA)
  assert.equal(+(await one(`SELECT comanda_totals($1) t`, [tabA])).t.itens, 5200)
  assert.equal((await one(`SELECT pessoas FROM pos_comandas WHERE id = $1`, [tabA])).pessoas, 4)
  const events = await all(`SELECT tipo FROM pos_comanda_eventos WHERE comanda_id = $1 ORDER BY criado_em`, [tabA])
  assert.ok(events.some(e => e.tipo === 'items_out') && events.some(e => e.tipo === 'merged_in'))
})

await test('split by items creates a new tab with those lines', async () => {
  const beerLine = (await one(`SELECT id FROM pos_comanda_itens WHERE comanda_id = $1 AND nome = 'Beer' AND removido_em IS NULL`, [tabA])).id
  const ids = (await as(caixa, () => one(`SELECT comanda_split($1, $2::jsonb) ids`, [tabA, JSON.stringify([{ nome: 'Ana', moves: [{ item: beerLine, qtd: 2 }] }])]))).ids
  assert.equal(ids.length, 1)
  assert.equal(+(await one(`SELECT comanda_totals($1) t`, [ids[0]])).t.itens, 1600)
  assert.equal(+(await one(`SELECT comanda_totals($1) t`, [tabA])).t.itens, 3600)
  // Merge back so the next test pays one tab.
  await as(caixa, () => db.query(`SELECT comanda_merge($1, $2)`, [ids[0], tabA]))
})

await test('partial payments are idempotent and the sale waits for the full amount', async () => {
  const p1 = (await as(caixa, () => one(`SELECT comanda_pay($1, 3000, 'Cash', 'pay-key-0001', 'Ana') t`, [tabA]))).t
  const p1b = (await as(caixa, () => one(`SELECT comanda_pay($1, 3000, 'Cash', 'pay-key-0001', 'Ana') t`, [tabA]))).t
  assert.equal(+p1.pago, 3000)
  assert.equal(+p1b.pago, 3000)
  assert.equal((await one(`SELECT status FROM pos_comandas WHERE id = $1`, [tabA])).status, 'awaiting_payment')
  const lines = (await all(`SELECT drink_menu_id, nome, qtd, preco_unitario, tipo_preco FROM pos_comanda_itens WHERE comanda_id = $1 AND removido_em IS NULL`, [tabA]))
    .map(l => ({ ...l, qtd: +l.qtd, preco_unitario: +l.preco_unitario }))
  const service = Math.round(5200 * 0.10)
  const items = [...lines, { nome: 'Service 10%', qtd: 1, preco_unitario: service, tipo_preco: 'service' }]
  const sale = { bar_id: bar, total: 5200 + service, comanda_id: tabA, metodo_pagamento: 'Cash+Card' }
  await assert.rejects(
    as(caixa, () => db.query(`SELECT pos_commit_sale('sale-key-0001', $1::jsonb, $2::jsonb, '[]')`, [JSON.stringify(sale), JSON.stringify(items)])),
    /not fully paid/,
  )
  await as(caixa, () => db.query(`SELECT comanda_pay($1, $2, 'Credit card', 'pay-key-0002', null)`, [tabA, 5200 + service - 3000]))
  const stock = [{ produto_id: bottle, qtd: 1 }]
  const v1 = (await as(caixa, () => one(`SELECT pos_commit_sale('sale-key-0001', $1::jsonb, $2::jsonb, $3::jsonb) id`, [JSON.stringify(sale), JSON.stringify(items), JSON.stringify(stock)]))).id
  assert.ok(v1)
  assert.equal((await one(`SELECT status, venda_id FROM pos_comandas WHERE id = $1`, [tabA])).venda_id, v1)
  assert.equal(+(await one(`SELECT total FROM pos_vendas WHERE id = $1`, [v1])).total, 5200 + service)
  assert.equal((await one(`SELECT count(*)::int n FROM pos_vendas_itens WHERE pos_venda_id = $1`, [v1])).n, items.length)
  assert.equal((await one(`SELECT count(*)::int n FROM estoque_movimentos WHERE obs = $1`, [`POS caixa ${String(v1).slice(0, 8)}`])).n, 1)
})

await test('the same sale key never writes twice (double tap, retry after timeout)', async () => {
  const items = [{ drink_menu_id: beer, nome: 'Beer', qtd: 1, preco_unitario: 800 }]
  const sale = { bar_id: bar, total: 800, metodo_pagamento: 'Cash' }
  const args = [JSON.stringify(sale), JSON.stringify(items)]
  const a = (await as(caixa, () => one(`SELECT pos_commit_sale('counter-key-001', $1::jsonb, $2::jsonb) id`, args))).id
  const b = (await as(caixa, () => one(`SELECT pos_commit_sale('counter-key-001', $1::jsonb, $2::jsonb) id`, args))).id
  assert.equal(a, b)
  assert.equal((await one(`SELECT count(*)::int n FROM pos_vendas WHERE idempotency_key = 'counter-key-001'`)).n, 1)
})

await test('a sale whose total does not match its lines is refused and leaves nothing behind', async () => {
  const before = (await one(`SELECT count(*)::int n FROM pos_vendas`)).n
  await assert.rejects(
    as(caixa, () => db.query(`SELECT pos_commit_sale('bad-total-001', $1::jsonb, $2::jsonb)`, [
      JSON.stringify({ bar_id: bar, total: 1 }), JSON.stringify([{ drink_menu_id: beer, nome: 'Beer', qtd: 1, preco_unitario: 800 }]),
    ])),
    /total does not match/,
  )
  await assert.rejects(
    as(stranger, () => db.query(`SELECT pos_commit_sale('other-bar-001', $1::jsonb, $2::jsonb)`, [
      JSON.stringify({ bar_id: bar, total: 800 }), JSON.stringify([{ drink_menu_id: beer, nome: 'Beer', qtd: 1, preco_unitario: 800 }]),
    ])),
    /not allowed/,
  )
  assert.equal((await one(`SELECT count(*)::int n FROM pos_vendas`)).n, before)
})

await test('an empty tab can be cancelled; a tab with lines cannot', async () => {
  const empty = (await as(caixa, () => one(`SELECT comanda_open($1, 'Walk-in', null, 1, null, 0, null) id`, [bar]))).id
  await as(caixa, () => db.query(`SELECT comanda_cancel($1, 'mistake')`, [empty]))
  assert.equal((await one(`SELECT status FROM pos_comandas WHERE id = $1`, [empty])).status, 'cancelled')
  const busy = (await as(caixa, () => one(`SELECT comanda_open($1, 'Busy', null, 1, null, 0, null) id`, [bar]))).id
  await as(caixa, () => db.query(`SELECT comanda_add_items($1, $2::jsonb)`, [busy, JSON.stringify([{ drink_menu_id: beer, nome: 'Beer', qtd: 1, preco_unitario: 800 }])]))
  await assert.rejects(as(caixa, () => db.query(`SELECT comanda_cancel($1, 'x')`, [busy])), /still has lines/)
})

await test('duplicate a layout and switch the active one', async () => {
  const copy = (await as(gerente, () => one(`SELECT floor_duplicate_layout($1, 'Eventos') id`, [layout.id]))).id
  assert.equal((await one(`SELECT count(*)::int n FROM floor_tables WHERE layout_id = $1`, [copy])).n, 6)
  await as(gerente, () => db.query(`SELECT floor_activate_layout($1)`, [copy]))
  assert.equal((await one(`SELECT id FROM floor_layouts WHERE bar_id = $1 AND ativo`, [bar])).id, copy)
})

await db.end()
console.log(`floor_comandas: ${passed} passed`)
