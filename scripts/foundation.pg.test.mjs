/**
 * Fresh-install checks against a disposable Postgres database whose name
 * ends with _test. Refuses supabase.co. Does not read production credentials.
 *
 *   POS_PG_TEST_URL=postgres://.../atomic_bar_foundation_test npm run test:foundation
 *
 * When POS_PG_TEST_URL is unset and local peer auth for postgres works, the
 * script installs sql/install_fresh.sql into atomic_bar_foundation_test and
 * connects as the local role atomic_tester. That role is not a Supabase login.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const LOCAL_DB = 'atomic_bar_foundation_test'
const LOCAL_PASSWORD = 'atomic_local_test'

function refuse(url) {
  if (/supabase\.co/i.test(url) || /ojirgkqtqvugqktyuhem|fxsakrshmldmkdmbevna/i.test(url)) {
    console.error('refusing a protected or hosted Supabase target')
    process.exit(1)
  }
}

function bootstrap() {
  execFileSync('sudo', ['-u', 'postgres', 'psql', '-c', `DROP DATABASE IF EXISTS ${LOCAL_DB};`], { stdio: 'inherit' })
  execFileSync('sudo', ['-u', 'postgres', 'psql', '-c', `CREATE DATABASE ${LOCAL_DB};`], { stdio: 'inherit' })
  execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', LOCAL_DB, '-v', 'ON_ERROR_STOP=1', '-f', 'sql/install_fresh.sql'], { stdio: 'inherit' })
  execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', LOCAL_DB, '-v', 'ON_ERROR_STOP=1', '-c', `
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atomic_tester') THEN
        CREATE ROLE atomic_tester LOGIN SUPERUSER PASSWORD '${LOCAL_PASSWORD}';
      END IF;
    END $$;
  `], { stdio: 'inherit' })
}

let url = process.env.POS_PG_TEST_URL || ''
if (!url) {
  try {
    bootstrap()
  } catch (error) {
    console.log('foundation postgres tests skipped (no POS_PG_TEST_URL and local postgres bootstrap failed)')
    console.log(error.message)
    process.exit(0)
  }
  url = `postgres://atomic_tester:${LOCAL_PASSWORD}@127.0.0.1:5432/${LOCAL_DB}`
}
refuse(url)

function client(pg) {
  return new pg.Client({ connectionString: url })
}

async function asUser(c, actor, fn) {
  await c.query('BEGIN')
  await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [actor])
  await c.query('SET LOCAL ROLE authenticated')
  try {
    const value = await fn()
    await c.query('COMMIT')
    return value
  } catch (error) {
    await c.query('ROLLBACK')
    throw error
  }
}

async function expectRaise(c, actor, fn, pattern) {
  let failed = null
  try {
    await asUser(c, actor, fn)
  } catch (error) {
    failed = error
  }
  assert.ok(failed, 'expected the database to reject the call')
  assert.match(failed.message, pattern)
}

async function ident(c, id, email, role, barId) {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [id, email])
  await c.query(
    `INSERT INTO public.perfis (id, email, nome, role, bar_id) VALUES ($1, $2, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, bar_id = EXCLUDED.bar_id`,
    [id, email, role, barId],
  )
}

async function main() {
  const pg = (await import('pg')).default
  const root = client(pg)
  await root.connect()
  await root.query(`SET statement_timeout = '20s'`)
  const db = await root.query('SELECT current_database() AS name')
  if (!/_test$/i.test(db.rows[0].name)) {
    console.error(`refusing database ${db.rows[0].name}; name must end with _test`)
    await root.end()
    process.exit(1)
  }

  const verify = await root.query(`
    SELECT status, detail FROM (
      SELECT object_name AS object, status, module, detail, 0 AS sort_summary
      FROM (
        SELECT 'schema_install' AS object_name, 'table' AS object_kind, 'foundation' AS module, 'present' AS detail
      ) e
      JOIN LATERAL (
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM information_schema.tables t
          WHERE t.table_schema = 'public' AND t.table_name = 'schema_install'
        ) THEN 'PASS' ELSE 'FAIL' END AS status
      ) s ON true
    ) q
  `)
  assert.equal(verify.rows[0].status, 'PASS')
  const version = await root.query(`SELECT version FROM public.schema_install WHERE id = 1`)
  assert.equal(version.rows[0].version, 'foundation-1')

  let failedInstall = null
  try {
    await root.query('BEGIN')
    await root.query('CREATE TABLE public._foundation_fail_probe (id int)')
    await root.query('SELECT 1/0')
    await root.query('COMMIT')
  } catch (error) {
    failedInstall = error
    await root.query('ROLLBACK')
  }
  assert.ok(failedInstall)
  const probe = await root.query(`SELECT to_regclass('public._foundation_fail_probe') AS rel`)
  assert.equal(probe.rows[0].rel, null)

  const barA = randomUUID()
  const barB = randomUUID()
  const admin = randomUUID()
  const jbm = randomUUID()
  const jbmPlain = randomUUID()
  const managerA = randomUUID()
  const cashierA = randomUUID()
  const staffA = randomUUID()
  const managerB = randomUUID()
  const supplierA = randomUUID()
  const supplierOther = randomUUID()
  const employeeA = randomUUID()
  const employeeB = randomUUID()
  const product = randomUUID()
  const space = randomUUID()

  await root.query(`INSERT INTO public.bars (id, nome) VALUES ($1, 'Bar A'), ($2, 'Bar B')`, [barA, barB])
  await ident(root, admin, 'admin@example.test', 'admin', null)
  await ident(root, jbm, 'jbm@example.test', 'jbm', null)
  await ident(root, jbmPlain, 'jbm-plain@example.test', 'jbm', null)
  await ident(root, managerA, 'manager-a@example.test', 'gerente', barA)
  await ident(root, cashierA, 'cashier-a@example.test', 'caixa', barA)
  await ident(root, staffA, 'staff-a@example.test', 'bar_staff', barA)
  await ident(root, managerB, 'manager-b@example.test', 'gerente', barB)
  await ident(root, supplierA, 'supplier-a@example.test', 'fornecedor', null)
  await ident(root, supplierOther, 'supplier-b@example.test', 'fornecedor', null)
  await ident(root, employeeA, 'employee-a@example.test', 'funcionario', barA)
  await ident(root, employeeB, 'employee-b@example.test', 'funcionario', barA)
  await root.query(
    `INSERT INTO public.platform_access (user_id, scope, reason) VALUES ($1, 'hq', 'test admin'), ($2, 'hq', 'test jbm')`,
    [admin, jbm],
  )
  await root.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, volume_ml, custo) VALUES ($1, 'Bottle', 2500, 700, 900)`,
    [product],
  )
  await root.query(
    `INSERT INTO public.bar_catalog (bar_id, product_id, sale_price, cost, min_stock, stock_policy)
     VALUES ($1, $2, 2500, 900, 1, 'block')`,
    [barA, product],
  )
  await root.query(
    `INSERT INTO public.bar_pricing (bar_id, produto_id, preco_drink) VALUES ($1, $2, 2500)`,
    [barA, product],
  )
  await root.query(
    `INSERT INTO public.pos_settings (bar_id, tax_rate, tax_included, card_fee_rate) VALUES ($1, 0.10, true, 0.0378)`,
    [barA],
  )

  const tax = await asUser(root, managerA, () => root.query(`SELECT public.tax_on($1, 1100) AS tax`, [barA]))
  assert.equal(tax.rows[0].tax, 100)

  await asUser(root, managerA, () => root.query(
    `SELECT public.stock_post($1, $2, 'entrada', 1, 'receipt')`,
    [barA, product],
  ))
  await expectRaise(root, managerA, () => root.query(
    `SELECT public.stock_post($1, $2, 'saida', 2, 'too many')`,
    [barA, product],
  ), /insufficient stock/)
  await asUser(root, managerA, () => root.query(
    `SELECT public.stock_post($1, $2, 'entrada', 4, 'more')`,
    [barA, product],
  ))
  await asUser(root, managerA, () => root.query(
    `SELECT public.stock_post($1, $2, 'perda', 1, 'waste')`,
    [barA, product],
  ))
  await asUser(root, managerA, () => root.query(
    `SELECT public.stock_post($1, $2, 'estorno', 1, 'reversal')`,
    [barA, product],
  ))
  const onHand = await root.query(`SELECT public.stock_on_hand($1, $2) AS n`, [barA, product])
  assert.equal(onHand.rows[0].n, 5)

  const a = client(pg)
  const b = client(pg)
  await a.connect()
  await b.connect()
  await a.query(`SET statement_timeout = '20s'`)
  await b.query(`SET statement_timeout = '20s'`)
  await a.query('BEGIN')
  await b.query('BEGIN')
  await a.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [managerA])
  await b.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [cashierA])
  await a.query('SET LOCAL ROLE authenticated')
  await b.query('SET LOCAL ROLE authenticated')
  const left = a.query(`SELECT public.stock_post($1, $2, 'saida', 5, 'race')`, [barA, product])
    .then(row => ({ who: 'a', ok: true, row })).catch(error => ({ who: 'a', ok: false, error }))
  const right = b.query(`SELECT public.stock_post($1, $2, 'saida', 5, 'race')`, [barA, product])
    .then(row => ({ who: 'b', ok: true, row })).catch(error => ({ who: 'b', ok: false, error }))
  const first = await Promise.race([left, right])
  const winner = first.who === 'a' ? a : b
  const secondPromise = first.who === 'a' ? right : left
  await winner.query(first.ok ? 'COMMIT' : 'ROLLBACK')
  const second = await secondPromise
  const loser = first.who === 'a' ? b : a
  await loser.query(second.ok ? 'COMMIT' : 'ROLLBACK')
  const raced = [first, second]
  assert.equal(raced.filter(row => row.ok).length, 1)
  assert.match(raced.find(row => !row.ok).error.message, /insufficient stock/)
  const afterRace = await root.query(`SELECT public.stock_on_hand($1, $2) AS n`, [barA, product])
  assert.equal(afterRace.rows[0].n, 0)
  await asUser(root, managerA, () => root.query(
    `SELECT public.stock_post($1, $2, 'entrada', 3, 'restock')`,
    [barA, product],
  ))

  const ticket = await asUser(root, cashierA, async () => {
    const loaded = await root.query(`SELECT public.pos_load_ticket($1, $2, 'Table 1') AS ticket`, [barA, space])
    return loaded.rows[0].ticket.id
  })
  await asUser(root, cashierA, () => root.query(
    `SELECT public.pos_ticket_item($1, $2, NULL, 1, false, NULL, $3)`,
    [barA, ticket, product],
  ))
  await expectRaise(root, cashierA, () => root.query(
    `SELECT public.pos_apply_discount($1, $2, 100)`,
    [barA, ticket],
  ), /discount not allowed/)
  await asUser(root, managerA, () => root.query(
    `SELECT public.pos_apply_discount($1, $2, 100)`,
    [barA, ticket],
  ))
  const payKey = `pay-${randomUUID()}`
  const payment = await asUser(root, cashierA, () => root.query(
    `SELECT public.pos_take_payment($1, $2, 'cash', 1400, $3) AS id`,
    [barA, ticket, payKey],
  ))
  const replay = await asUser(root, cashierA, () => root.query(
    `SELECT public.pos_take_payment($1, $2, 'cash', 1400, $3) AS id`,
    [barA, ticket, payKey],
  ))
  assert.equal(replay.rows[0].id, payment.rows[0].id)
  await expectRaise(root, cashierA, () => root.query(
    `SELECT public.pos_close_ticket($1, $2, 'cash', $3, NULL)`,
    [barA, ticket, `bad-${randomUUID()}`],
  ), /payment does not reconcile/)
  await asUser(root, cashierA, () => root.query(
    `SELECT public.pos_take_payment($1, $2, 'card', 1000, $3)`,
    [barA, ticket, `card2-${randomUUID()}`],
  ))
  const closed = await asUser(root, cashierA, () => root.query(
    `SELECT public.pos_close_ticket($1, $2, 'cash', $3, NULL) AS body`,
    [barA, ticket, `close-${randomUUID()}`],
  ))
  const body = closed.rows[0].body
  assert.equal(body.duplicate, false)
  assert.equal(body.total, 2400)
  assert.equal(body.discount, 100)
  assert.equal(body.fee, 38)
  const again = await asUser(root, cashierA, () => root.query(
    `SELECT public.pos_close_ticket($1, $2, 'cash', $3, NULL) AS body`,
    [barA, ticket, `close-again-${randomUUID()}`],
  ))
  assert.equal(again.rows[0].body.duplicate, true)
  assert.equal(again.rows[0].body.venda_id, body.venda_id)
  const sale = await root.query(
    `SELECT total, desconto_total, card_fee, metodo_pagamento FROM public.pos_vendas WHERE id = $1`,
    [body.venda_id],
  )
  assert.equal(sale.rows[0].total, 2400)
  assert.equal(sale.rows[0].desconto_total, 100)
  assert.equal(sale.rows[0].card_fee, 38)
  assert.equal(sale.rows[0].metodo_pagamento, 'split')
  const drawer = await root.query(`SELECT public.cash_drawer_expected($1, public.pos_tokyo_night(now())) AS n`, [barA])
  assert.equal(Number(drawer.rows[0].n), 1400)
  const night = await root.query(`SELECT public.pos_tokyo_night(now()) AS day`)
  await asUser(root, managerA, () => root.query(
    `SELECT public.cash_close_night($1, $2, $3)`,
    [barA, night.rows[0].day, 1400],
  ))
  await expectRaise(root, managerA, () => root.query(
    `SELECT public.cash_close_night($1, $2, $3)`,
    [barA, night.rows[0].day, 1400],
  ), /already closed/)
  const feeRows = await root.query(
    `SELECT count(*)::int AS n FROM public.caixa_movimentos WHERE referencia_id = $1 AND referencia_tipo = 'taxa_cartao'`,
    [body.venda_id],
  )
  assert.equal(feeRows.rows[0].n, 1)
  await expectRaise(root, cashierA, () => root.query(
    `SELECT public.pos_void_sale($1, 'refund', NULL, 'cashier', $2)`,
    [body.venda_id, managerA],
  ), /void not allowed/)
  await expectRaise(root, cashierA, () => root.query(
    `SELECT public.pos_void_sale($1, 'refund', NULL, 'cashier', $2)`,
    [body.venda_id, cashierA],
  ), /void not allowed/)
  const untouched = await root.query(`SELECT refunded FROM public.pos_vendas WHERE id = $1`, [body.venda_id])
  assert.equal(untouched.rows[0].refunded, 0)
  const deniedAudit = await root.query(
    `SELECT result FROM public.pos_void_audit WHERE venda_id = $1 ORDER BY created_at`,
    [body.venda_id],
  )
  assert.equal(deniedAudit.rows.length, 2)
  assert.equal(deniedAudit.rows.every(row => row.result === 'denied'), true)
  const deniedVisible = await asUser(root, cashierA, () => root.query(
    `SELECT result FROM public.pos_void_audit WHERE venda_id = $1`,
    [body.venda_id],
  ))
  assert.equal(deniedVisible.rows.length, 2)
  const hiddenDenial = await asUser(root, managerB, () => root.query(
    `SELECT result FROM public.pos_void_audit WHERE venda_id = $1`,
    [body.venda_id],
  ))
  assert.equal(hiddenDenial.rows.length, 0)
  await expectRaise(root, cashierA, () => root.query(
    `UPDATE public.pos_void_audit SET result = 'applied' WHERE venda_id = $1`,
    [body.venda_id],
  ), /permission denied/)
  await expectRaise(root, cashierA, () => root.query(
    `INSERT INTO public.pos_void_audit (user_id, bar_id, venda_id, reason, result) VALUES ($1, $2, $3, 'forged', 'applied')`,
    [cashierA, barA, body.venda_id],
  ), /permission denied/)
  await asUser(root, managerA, () => root.query(
    `SELECT public.pos_void_sale($1, 'refund', NULL, 'guest left', $2)`,
    [body.venda_id, managerA],
  ))
  const afterVoid = await root.query(`SELECT void_status, refunded FROM public.pos_vendas WHERE id = $1`, [body.venda_id])
  assert.equal(afterVoid.rows[0].void_status, 'void')
  assert.equal(afterVoid.rows[0].refunded, 2400)
  const voidAudit = await asUser(root, managerA, () => root.query(
    `SELECT user_id, bar_id, venda_id, reason, result, created_at
     FROM public.pos_void_audit WHERE venda_id = $1 AND result = 'applied'`,
    [body.venda_id],
  ))
  assert.equal(voidAudit.rows.length, 1)
  assert.equal(voidAudit.rows[0].user_id, managerA)
  assert.equal(voidAudit.rows[0].bar_id, barA)
  assert.equal(voidAudit.rows[0].reason, 'guest left')
  assert.equal(voidAudit.rows[0].result, 'applied')
  assert.ok(voidAudit.rows[0].created_at)
  await expectRaise(root, employeeA, () => root.query(
    `SELECT public.pos_void_sale($1, 'refund', NULL, 'staff', $2)`,
    [body.venda_id, employeeA],
  ), /void not allowed/)
  await expectRaise(root, managerB, () => root.query(
    `SELECT public.pos_void_sale($1, 'refund', NULL, 'other bar', $2)`,
    [body.venda_id, managerB],
  ), /bar not allowed/)
  await expectRaise(root, supplierA, () => root.query(
    `SELECT public.pos_void_sale($1, 'refund', NULL, 'supplier', $2)`,
    [body.venda_id, supplierA],
  ), /bar not allowed/)
  await expectRaise(root, jbmPlain, () => root.query(
    `SELECT public.pos_void_sale($1, 'refund', NULL, 'jbm without hq', $2)`,
    [body.venda_id, jbmPlain],
  ), /bar not allowed/)
  await expectRaise(root, admin, () => root.query(
    `SELECT public.pos_void_sale($1, 'refund', NULL, 'hq repeat', $2)`,
    [body.venda_id, admin],
  ), /already void/)
  const stillOneAudit = await root.query(
    `SELECT count(*)::int AS n FROM public.pos_void_audit WHERE venda_id = $1 AND result = 'applied'`,
    [body.venda_id],
  )
  assert.equal(stillOneAudit.rows[0].n, 1)

  const hiddenSales = await asUser(root, managerB, () => root.query(`SELECT id FROM public.vendas WHERE bar_id = $1`, [barA]))
  assert.equal(hiddenSales.rows.length, 0)
  const seen = await asUser(root, managerB, () => root.query(`SELECT id FROM public.pos_vendas WHERE bar_id = $1`, [barA]))
  assert.equal(seen.rows.length, 0)
  await expectRaise(root, managerB, () => root.query(
    `INSERT INTO public.pedidos (bar_id, status) VALUES ($1, 'pendente')`,
    [barA],
  ), /row-level security|new row violates/)
  await expectRaise(root, cashierA, () => root.query(
    `UPDATE public.pos_vendas SET total = 1 WHERE id = $1`,
    [body.venda_id],
  ), /permission denied/)
  await expectRaise(root, managerB, () => root.query(
    `SELECT public.pos_load_ticket($1, $2, '')`,
    [barA, randomUUID()],
  ), /bar not allowed/)
  await expectRaise(root, jbmPlain, () => root.query(
    `SELECT public.pos_load_ticket($1, $2, '')`,
    [barB, randomUUID()],
  ), /bar not allowed/)
  await root.query(
    `INSERT INTO public.bar_memberships (user_id, bar_id, role) VALUES ($1, $2, 'jbm')`,
    [jbmPlain, barB],
  )
  await asUser(root, jbmPlain, () => root.query(`SELECT public.pos_load_ticket($1, $2, 'visit')`, [barB, randomUUID()]))
  const auditBefore = await root.query(`SELECT count(*)::int AS n FROM public.platform_access_audit WHERE user_id = $1`, [jbm])
  await asUser(root, jbm, () => root.query(`SELECT public.pos_load_ticket($1, $2, 'HQ visit')`, [barB, randomUUID()]))
  const auditAfter = await root.query(`SELECT count(*)::int AS n FROM public.platform_access_audit WHERE user_id = $1`, [jbm])
  assert.ok(auditAfter.rows[0].n > auditBefore.rows[0].n)

  const supplierId = randomUUID()
  await root.query(`INSERT INTO public.fornecedores (id, nome) VALUES ($1, 'House Supply')`, [supplierId])
  await root.query(
    `INSERT INTO public.supplier_users (supplier_id, user_id) VALUES ($1, $2)`,
    [supplierId, supplierA],
  )
  const costSeen = await asUser(root, supplierA, () => root.query(`SELECT custo FROM public.produtos WHERE id = $1`, [product]))
  assert.equal(costSeen.rows.length, 0)
  const otherLink = await asUser(root, supplierOther, () => root.query(
    `SELECT supplier_id FROM public.supplier_users WHERE user_id = $1`,
    [supplierA],
  ))
  assert.equal(otherLink.rows.length, 0)

  await asUser(root, employeeA, () => root.query(`SELECT public.staff_clock($1, 'in')`, [barA]))
  await asUser(root, employeeA, () => root.query(`SELECT public.staff_clock($1, 'break_start')`, [barA]))
  await asUser(root, employeeA, () => root.query(`SELECT public.staff_clock($1, 'break_end')`, [barA]))
  await asUser(root, employeeA, () => root.query(`SELECT public.staff_clock($1, 'out')`, [barA]))
  await expectRaise(root, employeeA, () => root.query(`SELECT public.staff_clock($1, 'out')`, [barA]), /not clocked in/)
  const period = await asUser(root, jbm, () => root.query(`SELECT public.payroll_open_period('2026-09') AS id`))
  await asUser(root, jbm, () => root.query(
    `SELECT public.payroll_post_lines($1, $2::jsonb)`,
    [period.rows[0].id, JSON.stringify([{
      employee_id: employeeA, bar_id: barA, type: 'base_salary', description: 'September', amount: 200000,
    }])],
  ))
  const own = await asUser(root, employeeA, () => root.query(`SELECT amount FROM public.payroll_lines WHERE employee_id = $1`, [employeeA]))
  assert.equal(own.rows.length, 1)
  const otherPay = await asUser(root, employeeB, () => root.query(`SELECT amount FROM public.payroll_lines WHERE employee_id = $1`, [employeeA]))
  assert.equal(otherPay.rows.length, 0)
  await expectRaise(root, managerB, () => root.query(`SELECT public.payroll_open_period('2026-10')`), /payroll hq only/)

  await root.query(`SELECT public.sync_supplier_procurement()`)
  const source = await root.query(`SELECT id FROM public.procurement_sources WHERE fornecedor_id = $1`, [supplierId])
  assert.equal(source.rows.length, 1)
  await root.query(
    `INSERT INTO public.procurement_routing_rules (product_id, source_id, active)
     VALUES ($1, $2, true)`,
    [product, source.rows[0].id],
  )
  await root.query(
    `INSERT INTO public.bar_product_prices (bar_id, product_id, sale_price) VALUES ($1, $2, 2500)`,
    [barA, product],
  )
  const order = await asUser(root, managerA, () => root.query(
    `SELECT public.submit_bar_order($1, now(), 'foundation', $2::jsonb, $3) AS body`,
    [barA, JSON.stringify([{ produto_id: product, qtd: 2 }]), `order-${randomUUID()}`],
  ))
  const orderId = order.rows[0].body.order_id
  assert.ok(orderId)
  const replayOrder = await asUser(root, managerA, () => root.query(
    `SELECT public.submit_bar_order($1, now(), 'foundation', $2::jsonb, $3) AS body`,
    [barA, JSON.stringify([{ produto_id: product, qtd: 2 }]), order.rows[0].body && 'ignored'],
  ))
  // second call uses a new key inside the SQL only when we pass the same key
  const sameKey = `order-same-${randomUUID()}`
  const firstOrder = await asUser(root, managerA, () => root.query(
    `SELECT public.submit_bar_order($1, now(), 'again', $2::jsonb, $3) AS body`,
    [barA, JSON.stringify([{ produto_id: product, qtd: 1 }]), sameKey],
  ))
  const secondOrder = await asUser(root, managerA, () => root.query(
    `SELECT public.submit_bar_order($1, now(), 'again', $2::jsonb, $3) AS body`,
    [barA, JSON.stringify([{ produto_id: product, qtd: 1 }]), sameKey],
  ))
  assert.equal(secondOrder.rows[0].body.replayed, true)
  assert.equal(secondOrder.rows[0].body.order_id, firstOrder.rows[0].body.order_id)

  await asUser(root, jbm, () => root.query(`SELECT public.plan_procurement($1, now())`, [orderId]))
  const task = await root.query(
    `SELECT id, quantity_allocated, source_id FROM public.procurement_tasks WHERE order_id = $1 AND status <> 'cancelled'`,
    [orderId],
  )
  assert.ok(task.rows.length >= 1)
  assert.equal(Number(task.rows[0].quantity_allocated), 2)
  await asUser(root, jbm, () => root.query(
    `SELECT public.record_purchase($1, $2::jsonb)`,
    [task.rows[0].id, JSON.stringify({ quantity: 2, unit_cost: 900 })],
  ))
  const location = await root.query(
    `SELECT public._ensure_source_location($1) AS id`,
    [task.rows[0].source_id],
  )
  const barLocation = await root.query(
    `SELECT public._ensure_bar_location($1) AS id`,
    [barA],
  )
  const ship = await asUser(root, jbm, () => root.query(
    `SELECT public.create_shipment($1::jsonb) AS body`,
    [JSON.stringify({
      from_location_id: location.rows[0].id,
      to_location_id: barLocation.rows[0].id,
      items: [{ task_id: task.rows[0].id, quantity: 2 }],
    })],
  ))
  const shipmentId = ship.rows[0].body.shipment_id
  await asUser(root, jbm, () => root.query(`SELECT public.advance_shipment($1, 'depart')`, [shipmentId]))
  await asUser(root, jbm, () => root.query(`SELECT public.advance_shipment($1, 'deliver')`, [shipmentId]))
  await asUser(root, managerA, () => root.query(
    `SELECT public.confirm_bar_shipment($1, 'received', '[]'::jsonb, 'ok')`,
    [shipmentId],
  ))
  const received = await root.query(
    `SELECT COALESCE(SUM(qtd), 0)::int AS n FROM public.estoque_movimentos
     WHERE produto_id = $1 AND bar_id = $2 AND tipo = 'entrada' AND obs LIKE 'JBM ship%'`,
    [product, barA],
  )
  assert.ok(received.rows[0].n >= 2)
  const done = await root.query(`SELECT status FROM public.pedidos WHERE id = $1`, [orderId])
  assert.equal(done.rows[0].status, 'entregue')

  const priced = randomUUID()
  const drinkId = randomUUID()
  await root.query(
    `INSERT INTO public.produtos (id, nome, preco_venda) VALUES ($1, 'Priced', 999)`,
    [priced],
  )
  await root.query(
    `INSERT INTO public.drink_menu (id, bar_id, nome, preco_venda) VALUES ($1, $2, 'Highball', 3000)`,
    [drinkId, barA],
  )
  await root.query(
    `INSERT INTO public.bar_pricing (bar_id, produto_id, preco_drink) VALUES ($1, $2, 2500)`,
    [barA, priced],
  )
  await root.query(
    `INSERT INTO public.bar_product_prices (bar_id, product_id, sale_price) VALUES ($1, $2, 1800)`,
    [barA, priced],
  )
  const drinkPrice = await asUser(root, cashierA, () => root.query(
    `SELECT public.operation_price($1, NULL, $2, 'pos_drink') AS price`,
    [barA, drinkId],
  ))
  const unitPrice = await asUser(root, cashierA, () => root.query(
    `SELECT public.operation_price($1, $2, NULL, 'pos_unit') AS price`,
    [barA, priced],
  ))
  const buyPrice = await asUser(root, managerA, () => root.query(
    `SELECT public.operation_price($1, $2, NULL, 'procurement') AS price`,
    [barA, priced],
  ))
  assert.equal(Number(drinkPrice.rows[0].price), 3000)
  assert.equal(Number(unitPrice.rows[0].price), 2500)
  assert.equal(Number(buyPrice.rows[0].price), 1800)
  const conflict = await asUser(root, managerA, () => root.query(
    `SELECT public.price_conflict($1, $2) AS body`,
    [barA, priced],
  ))
  assert.equal(conflict.rows[0].body.diverges, true)
  const legacy = await asUser(root, managerA, () => root.query(
    `SELECT public.resolve_bar_price($1, $2, now(), 1) AS price`,
    [barA, priced],
  ))
  assert.equal(Number(legacy.rows[0].price), 1800)
  const globalProduct = randomUUID()
  const barProduct = randomUUID()
  const zeroProduct = randomUUID()
  const ambiguousProduct = randomUUID()
  await root.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, bar_id) VALUES ($1, 'Global', 999, NULL), ($2, 'Bar scoped', 700, $3)`,
    [globalProduct, barProduct, barA],
  )
  await expectRaise(root, managerA, () => root.query(
    `SELECT public.resolve_bar_price($1, $2, now(), 1)`,
    [barA, globalProduct],
  ), /sale price not configured/)
  await expectRaise(root, managerA, () => root.query(
    `SELECT public.resolve_bar_price($1, $2, now(), 1)`,
    [barA, barProduct],
  ), /sale price not configured/)
  await root.query(`INSERT INTO public.produtos (id, nome, preco_venda) VALUES ($1, 'Zero', 0)`, [zeroProduct])
  await root.query(`ALTER TABLE public.bar_product_prices DROP CONSTRAINT bar_product_prices_positive`)
  await root.query(
    `INSERT INTO public.bar_product_prices (bar_id, product_id, sale_price) VALUES ($1, $2, 0)`,
    [barA, zeroProduct],
  )
  await expectRaise(root, managerA, () => root.query(
    `SELECT public.resolve_bar_price($1, $2, now(), 1)`,
    [barA, zeroProduct],
  ), /sale price not configured/)
  await root.query(`DELETE FROM public.bar_product_prices WHERE product_id = $1`, [zeroProduct])
  await root.query(`ALTER TABLE public.bar_product_prices ADD CONSTRAINT bar_product_prices_positive CHECK (sale_price > 0)`)
  await root.query(`INSERT INTO public.produtos (id, nome, preco_venda) VALUES ($1, 'Ambiguous', 50)`, [ambiguousProduct])
  await root.query(
    `INSERT INTO public.bar_product_prices (bar_id, product_id, sale_price, minimum_quantity, valid_from)
     VALUES ($1, $2, 1000, 1, now() - interval '2 days'), ($1, $2, 1100, 1, now() - interval '1 day')`,
    [barA, ambiguousProduct],
  )
  await expectRaise(root, managerA, () => root.query(
    `SELECT public.resolve_bar_price($1, $2, now(), 1)`,
    [barA, ambiguousProduct],
  ), /ambiguous sale price/)
  const freeDrink = randomUUID()
  await root.query(
    `INSERT INTO public.drink_menu (id, bar_id, nome, preco_venda) VALUES ($1, $2, 'Zero drink', 0)`,
    [freeDrink, barA],
  )
  await expectRaise(root, cashierA, () => root.query(
    `SELECT public.operation_price($1, NULL, $2, 'pos_drink')`,
    [barA, freeDrink],
  ), /sale price not configured/)
  await expectRaise(root, managerB, () => root.query(
    `SELECT public.operation_price($1, $2, NULL, 'pos_unit')`,
    [barA, priced],
  ), /not allowed/)

  await root.query(
    `INSERT INTO public.vendas (bar_id, total, obs) VALUES ($1, 1000, 'jbm book only')`,
    [barA],
  )
  await root.query(
    `INSERT INTO public.vendas (bar_id, total, status, obs) VALUES ($1, 400, 'cancelada', 'cancelled jbm row')`,
    [barA],
  )
  const openSale = randomUUID()
  const partialSale = randomUUID()
  const partialItem = randomUUID()
  await root.query(
    `INSERT INTO public.pos_vendas (id, bar_id, total, refunded, metodo_pagamento, void_status)
     VALUES ($1, $2, 800, 0, 'cash', NULL)`,
    [openSale, barA],
  )
  await root.query(
    `INSERT INTO public.pos_vendas (id, bar_id, total, refunded, metodo_pagamento, void_status)
     VALUES ($1, $2, 1000, 0, 'cash', NULL)`,
    [partialSale, barA],
  )
  await root.query(
    `INSERT INTO public.pos_vendas_itens (id, pos_venda_id, nome, qtd, preco_unitario, refunded_qtd)
     VALUES ($1, $2, 'Two pours', 2, 500, 0)`,
    [partialItem, partialSale],
  )
  const beforeVoids = await asUser(root, managerA, () => root.query(
    `SELECT public.sales_indicator('till', $1) AS body`,
    [barA],
  ))
  assert.equal(Number(beforeVoids.rows[0].body.gross), 4200)
  assert.equal(Number(beforeVoids.rows[0].body.refunds), 2400)
  assert.equal(Number(beforeVoids.rows[0].body.net), 1800)
  assert.equal(Number(beforeVoids.rows[0].body.valid_transactions), 2)
  assert.equal(Number(beforeVoids.rows[0].body.transactions), 3)
  await root.query('BEGIN')
  await root.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [managerA])
  await root.query('SET LOCAL ROLE authenticated')
  await root.query(
    `SELECT public.pos_void_sale($1, 'partial_refund', NULL, 'first half', $2, $3, 1)`,
    [partialSale, managerA, partialItem],
  )
  await root.query('ROLLBACK')
  const rolled = await root.query(`SELECT refunded, void_status FROM public.pos_vendas WHERE id = $1`, [partialSale])
  assert.equal(rolled.rows[0].refunded, 0)
  assert.equal(rolled.rows[0].void_status, null)
  const noApplied = await root.query(
    `SELECT count(*)::int AS n FROM public.pos_void_audit WHERE venda_id = $1 AND result = 'applied'`,
    [partialSale],
  )
  assert.equal(noApplied.rows[0].n, 0)
  await asUser(root, managerA, () => root.query(
    `SELECT public.pos_void_sale($1, 'partial_refund', NULL, 'first half', $2, $3, 1)`,
    [partialSale, managerA, partialItem],
  ))
  await asUser(root, managerA, () => root.query(
    `SELECT public.pos_void_sale($1, 'partial_refund', NULL, 'second half', $2, $3, 1)`,
    [partialSale, managerA, partialItem],
  ))
  await expectRaise(root, managerA, () => root.query(
    `SELECT public.pos_void_sale($1, 'partial_refund', NULL, 'third', $2, $3, 1)`,
    [partialSale, managerA, partialItem],
  ), /already void|refund exceeds/)
  const partialRow = await root.query(
    `SELECT total, refunded, void_status FROM public.pos_vendas WHERE id = $1`,
    [partialSale],
  )
  assert.equal(partialRow.rows[0].total, 1000)
  assert.equal(partialRow.rows[0].refunded, 1000)
  assert.equal(partialRow.rows[0].void_status, 'void')
  const partialAudits = await root.query(
    `SELECT result FROM public.pos_void_audit WHERE venda_id = $1 AND result = 'applied'`,
    [partialSale],
  )
  assert.equal(partialAudits.rows.length, 2)
  const till = await asUser(root, managerA, () => root.query(
    `SELECT public.sales_indicator('till', $1) AS body`,
    [barA],
  ))
  const jbmBook = await asUser(root, managerA, () => root.query(
    `SELECT public.sales_indicator('jbm', $1) AS body`,
    [barA],
  ))
  assert.equal(Number(till.rows[0].body.gross), 4200)
  assert.equal(Number(till.rows[0].body.refunds), 3400)
  assert.equal(Number(till.rows[0].body.net), 800)
  assert.equal(Number(till.rows[0].body.transactions), 3)
  assert.equal(Number(till.rows[0].body.valid_transactions), 1)
  assert.equal(Number(jbmBook.rows[0].body.gross), 1400)
  assert.equal(Number(jbmBook.rows[0].body.refunds), 0)
  assert.equal(Number(jbmBook.rows[0].body.net), 1000)
  assert.equal(Number(jbmBook.rows[0].body.transactions), 2)
  assert.equal(Number(jbmBook.rows[0].body.valid_transactions), 1)
  assert.equal(Number(till.rows[0].body.net) + Number(jbmBook.rows[0].body.net), 1800)
  assert.notEqual(Number(till.rows[0].body.net), 1800)
  await expectRaise(root, managerA, () => root.query(
    `SELECT public.sales_indicator('both', $1)`,
    [barA],
  ), /unknown sales book/)
  const shared = await root.query(
    `SELECT count(*)::int AS n FROM public.pos_vendas p
     JOIN public.vendas v ON v.id = p.id WHERE p.bar_id = $1`,
    [barA],
  )
  assert.equal(shared.rows[0].n, 0)

  await root.query(
    `INSERT INTO public.supplier_routing_rules (product_id, supplier_id, active)
     SELECT $1, $2, true
     WHERE NOT EXISTS (
       SELECT 1 FROM public.supplier_routing_rules r WHERE r.product_id = $1
     )`,
    [priced, supplierId],
  )
  await root.query(
    `INSERT INTO public.fulfillment_alerts (audience, bar_id, event_type, title)
     VALUES ('bar', $1, 'review', 'Bar A only')`,
    [barA],
  )
  const rulesForStaff = await asUser(root, employeeA, () => root.query(
    `SELECT id FROM public.supplier_routing_rules`,
  ))
  assert.equal(rulesForStaff.rows.length, 0)
  const rulesForJbm = await asUser(root, jbm, () => root.query(
    `SELECT id FROM public.supplier_routing_rules`,
  ))
  assert.ok(rulesForJbm.rows.length >= 1)
  const alertsA = await asUser(root, managerA, () => root.query(
    `SELECT id FROM public.fulfillment_alerts WHERE bar_id = $1`,
    [barA],
  ))
  const alertsB = await asUser(root, managerB, () => root.query(
    `SELECT id FROM public.fulfillment_alerts WHERE bar_id = $1`,
    [barA],
  ))
  assert.ok(alertsA.rows.length >= 1)
  assert.equal(alertsB.rows.length, 0)
  await expectRaise(root, managerA, () => root.query(
    `UPDATE public.fulfillment_alerts SET title = 'changed' WHERE bar_id = $1`,
    [barA],
  ), /permission denied/)
  await expectRaise(root, supplierA, () => root.query(
    `UPDATE public.fulfillment_alerts SET read_at = now()`,
  ), /permission denied/)
  await root.query(
    `INSERT INTO public.fulfillment_alerts (audience, supplier_id, event_type, title)
     VALUES ('supplier', $1, 'review', 'Supplier A only')`,
    [supplierId],
  )
  const supplierAlerts = await asUser(root, supplierA, () => root.query(
    `SELECT id FROM public.fulfillment_alerts WHERE audience = 'supplier' AND supplier_id = $1`,
    [supplierId],
  ))
  const otherSupplierAlerts = await asUser(root, supplierOther, () => root.query(
    `SELECT id FROM public.fulfillment_alerts WHERE supplier_id = $1`,
    [supplierId],
  ))
  const supplierSeesBar = await asUser(root, supplierA, () => root.query(
    `SELECT id FROM public.fulfillment_alerts WHERE audience = 'bar' AND bar_id = $1`,
    [barA],
  ))
  assert.ok(supplierAlerts.rows.length >= 1)
  assert.equal(otherSupplierAlerts.rows.length, 0)
  assert.equal(supplierSeesBar.rows.length, 0)
  const ownSupplier = await asUser(root, supplierA, () => root.query(
    `SELECT supplier_id FROM public.supplier_users WHERE user_id = $1`,
    [supplierA],
  ))
  assert.equal(ownSupplier.rows.length, 1)
  await expectRaise(root, cashierA, () => root.query(`SELECT id FROM public.audit_logs`), /permission denied/)
  await expectRaise(root, managerA, () => root.query(
    `INSERT INTO public.supplier_users (supplier_id, user_id) VALUES ($1, $2)`,
    [supplierId, managerA],
  ), /row-level security|permission denied/)
  const hqPortal = await asUser(root, admin, () => root.query(`SELECT pedido_id FROM public.pedido_fulfillment`))
  assert.ok(Array.isArray(hqPortal.rows))
  await expectRaise(root, admin, () => root.query(`SELECT id FROM public.order_supplier_items`), /permission denied/)
  await expectRaise(root, admin, () => root.query(`SELECT id FROM public.fulfillment_events`), /permission denied/)
  await expectRaise(root, admin, () => root.query(`SELECT id FROM public.delivery_confirmations`), /permission denied/)
  await expectRaise(root, admin, () => root.query(`SELECT id FROM public.supplier_purchase_requests`), /permission denied/)
  await expectRaise(root, cashierA, () => root.query(
    `INSERT INTO public.supplier_routing_rules (product_id, supplier_id) VALUES ($1, $2)`,
    [priced, supplierId],
  ), /row-level security|permission denied/)
  const otherSupplier = await asUser(root, supplierOther, () => root.query(
    `SELECT supplier_id FROM public.supplier_users WHERE user_id = $1`,
    [supplierA],
  ))
  assert.equal(otherSupplier.rows.length, 0)

  await a.end()
  await b.end()
  await root.end()

  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', 'sql/install_fresh.sql'], { stdio: 'inherit' })
  const summary = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-A', '-F', '|', '-f', 'sql/verify_schema.sql'], { encoding: 'utf8' })
  const summaryLine = summary.split('\n').find(line => line.startsWith('SUMMARY|'))
  if (!summaryLine || !summaryLine.startsWith('SUMMARY|OK|')) {
    throw new Error(summary)
  }
  console.log('foundation postgres tests passed')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
