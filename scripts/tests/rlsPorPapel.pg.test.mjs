/**
 * sql/rls_por_papel.sql against a disposable local Postgres that starts like production (RLS off / "any logged-in").
 *
 *   RLS_PG_TEST_URL=postgres://postgres@localhost:5544/postgres node scripts/tests/rlsPorPapel.pg.test.mjs
 *
 * Creates and drops the database `jbm_rls_test`. Refuses Supabase hosts. Without the variable it is skipped.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const url = process.env.RLS_PG_TEST_URL || process.env.FLOOR_PG_TEST_URL
if (!url) {
  console.log('rls por papel postgres tests skipped (set RLS_PG_TEST_URL to a disposable server)')
  process.exit(0)
}
if (/supabase\.(co|com)/i.test(url)) { console.error('refusing a Supabase host'); process.exit(1) }

const admin = new pg.Client({ connectionString: url })
await admin.connect()
await admin.query('DROP DATABASE IF EXISTS jbm_rls_test')
await admin.query('CREATE DATABASE jbm_rls_test')
await admin.end()
const dbUrl = new URL(url)
dbUrl.pathname = '/jbm_rls_test'
const db = new pg.Client({ connectionString: dbUrl.toString() })
await db.connect()
const read = f => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
await db.query(read('scripts/fixtures/drinks_baseline.sql'))
await db.query(read('scripts/fixtures/prod_money_tables.sql'))

const id = () => randomUUID()
const barA = id(), barB = id()
const U = { admin: id(), staff: id(), func: id(), ownerA: id(), managerA: id(), tillA: id(), staffA: id(), ownerB: id(), ghost: id() }
await db.query(`INSERT INTO bars (id, nome) VALUES ($1,'Atomic'),($2,'Other')`, [barA, barB])
await db.query(`INSERT INTO perfis (id, nome, role, bar_id) VALUES
  ($1,'Admin','admin',NULL),($2,'Staff','staff',NULL),($3,'Func','funcionario',NULL),
  ($4,'OwnerA','cliente',$9),($5,'ManagerA','gerente',$9),($6,'TillA','caixa',$9),($7,'StaffA','bar_staff',$9),($8,'OwnerB','cliente',$10)`,
  [U.admin, U.staff, U.func, U.ownerA, U.managerA, U.tillA, U.staffA, U.ownerB, barA, barB])
const prod = id(), fatA = id(), fatB = id(), payA = id(), recA = id(), vendaA = id(), vendaB = id(), pedA = id(), pedB = id(), forn = id()
await db.query(`INSERT INTO produtos (id, nome, custo, preco_venda, estoque_atual) VALUES ($1,'Gin',1000,1500,10)`, [prod])
await db.query(`INSERT INTO faturas (id, bar_id, total, pago, status) VALUES ($1,$3,465000,300000,'parcial'),($2,$4,1000,0,'pendente')`, [fatA, fatB, barA, barB])
await db.query(`INSERT INTO fatura_pagamentos (id, fatura_id, valor, metodo, confirmado) VALUES ($1,$2,876910,'Stripe',false)`, [payA, fatA])
await db.query(`INSERT INTO ryoshusho (id, numero, bar_id, total) VALUES ($1,'RY-1',$2,300000)`, [recA, barA])
await db.query(`INSERT INTO vendas (id, bar_id, total) VALUES ($1,$3,100),($2,$4,200)`, [vendaA, vendaB, barA, barB])
await db.query(`INSERT INTO vendas_itens (venda_id, produto_id, qtd, preco_unitario) VALUES ($1,$3,1,100),($2,$3,2,100)`, [vendaA, vendaB, prod])
await db.query(`INSERT INTO pedidos (id, bar_id, status) VALUES ($1,$3,'pendente'),($2,$4,'pendente')`, [pedA, pedB, barA, barB])
await db.query(`INSERT INTO pedidos_itens (pedido_id, produto_id, qtd) VALUES ($1,$3,1),($2,$3,1)`, [pedA, pedB, prod])
await db.query(`INSERT INTO fornecedores (id, nome) VALUES ($1,'Supplier X')`, [forn])
await db.query(`INSERT INTO compras (fornecedor, total_real) VALUES ('Supplier X', 5000)`)
await db.query(`INSERT INTO estoque_movimentos (produto_id, bar_id, tipo, qtd) VALUES ($1,$2,'entrada',5),($1,$3,'entrada',7)`, [prod, barA, barB])
await db.query(`INSERT INTO drink_menu (bar_id, nome) VALUES ($1,'A drink'),($2,'B drink')`, [barA, barB])
await db.query(`INSERT INTO notificacoes (user_id, titulo) VALUES ($1,'for admin'),($2,'for ownerA')`, [U.admin, U.ownerA])

async function as(user, fn, role = 'authenticated') {
  await db.query('BEGIN')
  try {
    await db.query(`SELECT set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)`, [user || '', role])
    await db.query(`SET LOCAL ROLE ${role}`)
    return await fn()
  } finally {
    await db.query('ROLLBACK') // nothing a test writes is kept
  }
}
const count = async (sql, p) => +(await db.query(`SELECT count(*) AS n FROM (${sql}) q`, p)).rows[0].n
const affected = async (sql, p) => (await db.query(sql, p)).rowCount
const denied = async (sql, p) => {
  await db.query('SAVEPOINT s')
  try { const r = await db.query(sql, p); await db.query('RELEASE SAVEPOINT s'); return r.rowCount === 0 }
  catch { await db.query('ROLLBACK TO SAVEPOINT s'); return true }
}
let n = 0
const ok = (cond, label) => { assert.ok(cond, label); n++ }

// Before: the starting point really is open (the test would be worthless otherwise).
ok(await as(null, () => count('SELECT 1 FROM vendas'), 'anon') === 2, 'before: anon reads every delivery')
ok(await as(U.tillA, () => affected(`UPDATE perfis SET role = 'admin' WHERE id = $1`, [U.tillA])) === 1, 'before: a till login can make itself admin')

const before = (await db.query(`SELECT (SELECT count(*) FROM faturas) f, (SELECT sum(pago) FROM faturas) pago, (SELECT count(*) FROM ryoshusho) r, (SELECT count(*) FROM fatura_pagamentos) p, (SELECT count(*) FROM perfis) u`)).rows[0]
await db.query(read('sql/rls_por_papel.sql'))
await db.query(read('sql/rls_por_papel.sql')) // safe to run again
const after = (await db.query(`SELECT (SELECT count(*) FROM faturas) f, (SELECT sum(pago) FROM faturas) pago, (SELECT count(*) FROM ryoshusho) r, (SELECT count(*) FROM fatura_pagamentos) p, (SELECT count(*) FROM perfis) u`)).rows[0]
assert.deepEqual(after, before, 'the SQL changes no data'); n++

// Every table has RLS on and no table keeps a "true" / "any authenticated" policy.
ok(+(await db.query(`SELECT count(*) n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace WHERE s.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`)).rows[0].n === 0, 'RLS on everywhere')
ok(+(await db.query(`SELECT count(*) n FROM pg_policies WHERE schemaname = 'public' AND (qual = 'true' OR qual ~ 'auth.role\\(\\)')`)).rows[0].n === 0, 'no open policy left')

// anon: nothing.
for (const t of ['vendas', 'produtos', 'perfis', 'faturas', 'pedidos', 'ryoshusho', 'produtos_public']) {
  ok(await as(null, () => denied(`SELECT 1 FROM ${t}`), 'anon'), `anon cannot read ${t}`)
}
ok(await as(null, () => denied(`DELETE FROM vendas`), 'anon'), 'anon cannot delete deliveries')
ok(await as(null, () => denied(`SELECT deduct_stock($1, 1)`, [prod]), 'anon'), 'anon cannot run deduct_stock')
ok(await as(U.tillA, () => denied(`SELECT deduct_stock($1, 1)`, [prod])), 'a login cannot run the unchecked deduct_stock')

// A login without a profile row sees nothing.
ok(await as(U.ghost, () => count('SELECT 1 FROM produtos')) === 0, 'no profile: no catalogue')
ok(await as(U.ghost, () => count('SELECT 1 FROM vendas')) === 0, 'no profile: no deliveries')

// perfis: nobody but an admin changes a role or a bar.
ok(await as(U.tillA, () => denied(`UPDATE perfis SET role = 'admin' WHERE id = $1`, [U.tillA])), 'till cannot make itself admin')
ok(await as(U.ownerA, () => denied(`UPDATE perfis SET bar_id = $2 WHERE id = $1`, [U.ownerA, barB])), 'owner cannot move to another bar')
ok(await as(U.ownerA, () => denied(`UPDATE perfis SET role = 'admin' WHERE id = $1`, [U.tillA])), 'owner cannot promote staff')
ok(await as(U.ownerA, () => affected(`UPDATE perfis SET nome = 'New name' WHERE id = $1`, [U.ownerA])) === 1, 'owner can fix own name')
ok(await as(U.staff, () => denied(`UPDATE perfis SET role = 'admin' WHERE id = $1`, [U.staff])), 'HQ staff cannot make itself admin')
ok(await as(U.admin, () => affected(`UPDATE perfis SET role = 'gerente' WHERE id = $1`, [U.tillA])) === 1, 'admin changes a role')
ok(await as(U.ownerA, () => denied(`INSERT INTO perfis (id, role) VALUES (gen_random_uuid(), 'admin')`)), 'owner cannot create a profile')
ok(await as(U.ownerA, () => count(`SELECT 1 FROM perfis WHERE bar_id = $1`, [barB])) === 0, 'owner A does not see bar B people')
ok(await as(U.ownerA, () => count(`SELECT 1 FROM perfis WHERE role = 'admin'`)) === 1, 'a bar can find the admin to notify')
ok(await as(U.admin, () => count('SELECT 1 FROM perfis')) === 8, 'admin sees everyone')

// Bar isolation: A never sees or touches B.
for (const who of ['ownerA', 'managerA', 'tillA', 'staffA']) {
  ok(await as(U[who], () => count('SELECT 1 FROM vendas')) === 1, `${who}: only own deliveries`)
  ok(await as(U[who], () => count('SELECT 1 FROM vendas_itens')) === 1, `${who}: only own delivery lines`)
  ok(await as(U[who], () => count('SELECT 1 FROM pedidos')) === 1, `${who}: only own orders`)
  ok(await as(U[who], () => count('SELECT 1 FROM pedidos_itens')) === 1, `${who}: only own order lines`)
  ok(await as(U[who], () => count('SELECT 1 FROM estoque_movimentos')) === 1, `${who}: only own stock`)
  ok(await as(U[who], () => count('SELECT 1 FROM drink_menu')) === 1, `${who}: only own menu`)
  ok(await as(U[who], () => count('SELECT 1 FROM bars')) === 1, `${who}: only own bar`)
  ok(await as(U[who], () => count('SELECT 1 FROM fornecedores')) === 0, `${who}: never sees JBM suppliers`)
  ok(await as(U[who], () => count('SELECT 1 FROM compras')) === 0, `${who}: never sees JBM purchases`)
  ok(await as(U[who], () => denied(`UPDATE produtos SET custo = 1`)), `${who}: cannot edit the catalogue`)
  ok(await as(U[who], () => denied(`UPDATE vendas SET total = 0`)), `${who}: cannot edit a delivery`)
  ok(await as(U[who], () => denied(`DELETE FROM vendas`)), `${who}: cannot delete a delivery`)
  ok(await as(U[who], () => denied(`INSERT INTO pedidos (bar_id, status) VALUES ($1, 'pendente')`, [barB])), `${who}: cannot order for another bar`)
  ok(await as(U[who], () => denied(`INSERT INTO estoque_movimentos (produto_id, bar_id, tipo, qtd) VALUES ($1, $2, 'entrada', 99)`, [prod, barB])), `${who}: cannot add stock to another bar`)
  ok(await as(U[who], () => affected(`INSERT INTO pedidos (bar_id, status) VALUES ($1, 'pendente')`, [barA])) === 1, `${who}: can order for own bar`)
  ok(await as(U[who], () => affected(`INSERT INTO estoque_movimentos (produto_id, bar_id, tipo, qtd) VALUES ($1, $2, 'saida', 1)`, [prod, barA])) === 1, `${who}: can log own stock`)
  ok(await as(U[who], () => affected(`INSERT INTO notificacoes (user_id, titulo) VALUES ($1, 'new order')`, [U.admin])) === 1, `${who}: can notify the admin`)
  ok(await as(U[who], () => count('SELECT 1 FROM notificacoes')) === (who === 'ownerA' ? 1 : 0), `${who}: reads only own notices`)
}

// Money: only owner/manager of the bar see its invoices; till and staff do not; nobody at the bar confirms.
for (const who of ['ownerA', 'managerA']) {
  ok(await as(U[who], () => count('SELECT 1 FROM faturas')) === 1, `${who}: own invoices only`)
  ok(await as(U[who], () => count('SELECT 1 FROM ryoshusho')) === 1, `${who}: own receipts`)
  ok(await as(U[who], () => count('SELECT 1 FROM fatura_pagamentos')) === 1, `${who}: own payments`)
  ok(await as(U[who], () => denied(`UPDATE faturas SET pago = total`)), `${who}: cannot mark an invoice paid`)
  ok(await as(U[who], () => denied(`UPDATE fatura_pagamentos SET confirmado = true`)), `${who}: cannot confirm a pending credit`)
  ok(await as(U[who], () => denied(`INSERT INTO fatura_pagamentos (fatura_id, valor, confirmado) VALUES ($1, 1000, true)`, [fatA])), `${who}: cannot log a confirmed payment`)
  ok(await as(U[who], () => affected(`INSERT INTO fatura_pagamentos (fatura_id, valor, confirmado) VALUES ($1, 1000, false)`, [fatA])) === 1, `${who}: can say "I paid" (waits for confirmation)`)
  ok(await as(U[who], () => denied(`INSERT INTO fatura_pagamentos (fatura_id, valor, confirmado) VALUES ($1, 1000, false)`, [fatB])), `${who}: not on another bar's invoice`)
  ok(await as(U[who], () => denied(`DELETE FROM fatura_pagamentos`)), `${who}: cannot delete a payment`)
  ok(await as(U[who], () => denied(`DELETE FROM ryoshusho`)), `${who}: cannot delete a receipt`)
  ok(await as(U[who], () => denied(`INSERT INTO ryoshusho (numero, bar_id, total) VALUES ('RY-X', $1, 1)`, [barA])), `${who}: cannot issue a receipt`)
}
for (const who of ['tillA', 'staffA', 'ownerB', 'func']) {
  ok(await as(U[who], () => count(`SELECT 1 FROM faturas WHERE bar_id = $1`, [barA])) === 0, `${who}: no bar A invoices`)
  ok(await as(U[who], () => count(`SELECT 1 FROM ryoshusho`)) === 0, `${who}: no receipts`)
  ok(await as(U[who], () => count(`SELECT 1 FROM fatura_pagamentos`)) === 0, `${who}: no payments`)
}

// Till sales: till/staff ring up but do not change money or delete old sales; the owner can.
const saleOld = id()
await db.query(`INSERT INTO pos_vendas (id, bar_id, total, criado_por, criado_em) VALUES ($1,$2,5000,$3, now() - interval '1 hour')`, [saleOld, barA, U.tillA])
ok(await as(U.tillA, () => affected(`INSERT INTO pos_vendas (bar_id, total, criado_por) VALUES ($1, 1200, $2)`, [barA, U.tillA])) === 1, 'till rings up a sale')
ok(await as(U.tillA, () => denied(`INSERT INTO pos_vendas (bar_id, total, criado_por) VALUES ($1, -1200, $2)`, [barA, U.tillA])), 'till cannot void')
ok(await as(U.tillA, () => denied(`UPDATE pos_vendas SET total = 1 WHERE id = $1`, [saleOld])), 'till cannot change a sale total')
ok(await as(U.tillA, () => denied(`DELETE FROM pos_vendas WHERE id = $1`, [saleOld])), 'till cannot delete an old sale')
ok(await as(U.ownerA, () => affected(`UPDATE pos_vendas SET obs = 'fix' WHERE id = $1`, [saleOld])) === 1, 'owner can correct a sale')

// HQ.
ok(await as(U.staff, () => count('SELECT 1 FROM faturas')) === 2, 'HQ staff: all invoices')
ok(await as(U.staff, () => affected(`UPDATE fatura_pagamentos SET confirmado = true, confirmado_em = now() WHERE id = $1`, [payA])) === 1, 'HQ staff confirms a payment')
ok(await as(U.staff, () => denied(`DELETE FROM faturas`)), 'HQ staff cannot delete an invoice (admin only)')
ok(await as(U.staff, () => denied(`DELETE FROM ryoshusho`)), 'HQ staff cannot delete a receipt (admin only)')
ok(await as(U.admin, () => affected(`UPDATE faturas SET notas = 'x' WHERE id = $1`, [fatA])) === 1, 'admin edits an invoice')
ok(await as(U.func, () => count('SELECT 1 FROM pedidos')) === 2, 'HQ employee: all orders')
ok(await as(U.func, () => affected(`UPDATE produtos SET nome = 'Gin 700' WHERE id = $1`, [prod])) === 1, 'HQ employee edits the catalogue')
ok(await as(U.func, () => denied(`UPDATE faturas SET pago = 0`)), 'HQ employee does not touch invoices')
ok(await as(U.func, () => count('SELECT 1 FROM compras')) === 1, 'HQ employee sees purchases')

await db.end()
const drop = new pg.Client({ connectionString: url })
await drop.connect()
await drop.query('DROP DATABASE IF EXISTS jbm_rls_test')
await drop.end()
console.log(`rls por papel: ${n} checks passed`)
