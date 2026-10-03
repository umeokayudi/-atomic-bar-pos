/**
 * Disposable Postgres only. Does not run against Supabase unless POS_PG_ALLOW=1
 * and the database name ends with _test.
 *
 *   POS_PG_TEST_URL=postgres://.../pos_test npm run test:pos:pg
 *
 * Without POS_PG_TEST_URL the suite skips. It is not part of npm run test:pos.
 *
 * Each run mints its own fixture ids, spaces, bottle codes and idempotency keys.
 * Earlier rows stay in the database. Asserts still expect exact counts for this
 * run's ids. They do not widen to "at least one".
 *
 * sql/pos_sale_security.sql is a repair for a database that already has the
 * legacy drinks schema (perfis, produtos, cast_members, vendas). It is not
 * applied here. sql/pos_floor.sql alters those existing tables and calls
 * auth.uid(); this file creates only the minimum auth schema, perfis and
 * catalog tables a local Postgres needs before applying it. Roles named
 * authenticated and anon, when present, belong to the local test cluster so
 * the Supabase GRANTs in that file can run. Creating them here does not
 * create them in production.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const url = process.env.POS_PG_TEST_URL
if (!url) {
  console.log('pos postgres tests skipped (set POS_PG_TEST_URL to a disposable database)')
  process.exit(0)
}
if (/supabase\.co/i.test(url) && process.env.POS_PG_ALLOW !== '1') {
  console.error('refusing a Supabase host without POS_PG_ALLOW=1')
  process.exit(1)
}

const bar = randomUUID()
const other = randomUUID()
const userA = randomUUID()
const userB = randomUUID()
const userJbm = randomUUID()
const userSupplier = randomUUID()
const spirit = randomUUID()
const sealed = randomUUID()
const drink = randomUUID()
const space = randomUUID()
const spaceSame = randomUUID()
const spaceBare = randomUUID()
const spacePour = randomUUID()
const spaceUnit = randomUUID()
const agent = randomUUID()
const pourCode = `POUR-${randomUUID()}`
const keySame = `same-key-${randomUUID()}`
const keyBare = `no-recipe-${randomUUID()}`
const keyPour = `pour-key-${randomUUID()}`
const keyUnit = `unit-key-${randomUUID()}`

const preamble = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('pos.test_actor', true), '')::uuid;
$$;

CREATE TABLE IF NOT EXISTS public.perfis (
  id uuid PRIMARY KEY,
  role text,
  bar_id uuid
);

CREATE OR REPLACE FUNCTION public.user_can_access_bar(target_bar uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT target_bar IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.perfis p
    WHERE p.id = auth.uid()
      AND (
        p.role = 'admin'
        OR (p.bar_id = target_bar AND p.role IN ('cliente', 'gerente', 'caixa', 'bar_staff'))
      )
  );
$$;

CREATE TABLE IF NOT EXISTS public.produtos (
  id uuid PRIMARY KEY,
  nome text,
  volume_ml integer,
  custo integer
);
CREATE TABLE IF NOT EXISTS public.drink_menu (
  id uuid PRIMARY KEY,
  bar_id uuid,
  nome text,
  preco_venda numeric
);
CREATE TABLE IF NOT EXISTS public.bar_pricing (
  bar_id uuid,
  produto_id uuid,
  preco_drink numeric,
  PRIMARY KEY (bar_id, produto_id)
);
CREATE TABLE IF NOT EXISTS public.drink_back_agents (
  id uuid PRIMARY KEY,
  bar_id uuid,
  ativo boolean,
  comissao_pct numeric
);
CREATE TABLE IF NOT EXISTS public.estoque_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid,
  bar_id uuid,
  tipo text,
  qtd integer,
  criado_por uuid,
  obs text
);
CREATE TABLE IF NOT EXISTS public.caixa_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid,
  tipo text,
  valor integer,
  descricao text,
  referencia_id uuid,
  referencia_tipo text,
  data timestamptz
);
CREATE TABLE IF NOT EXISTS public.pos_vendas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid,
  data date,
  subtotal integer,
  desconto_total integer,
  total integer,
  metodo_pagamento text,
  tipo text,
  criado_por uuid
);
CREATE TABLE IF NOT EXISTS public.pos_vendas_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_venda_id uuid,
  drink_menu_id uuid,
  produto_id uuid,
  nome text,
  qtd integer,
  preco_unitario numeric,
  preco_lista numeric,
  tipo_preco text,
  desconto_valor integer
);
`

function client(pg) {
  return new pg.Client({ connectionString: url })
}

async function tx(c, actor, fn) {
  await c.query('BEGIN')
  await c.query(`SELECT set_config('pos.test_actor', $1, true)`, [actor])
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
    await tx(c, actor, fn)
  } catch (error) {
    failed = error
  }
  assert.ok(failed, 'expected the database to reject the call')
  assert.match(failed.message, pattern)
}

async function race(a, b, actorA, actorB, sql, params) {
  await a.query('BEGIN')
  await b.query('BEGIN')
  await a.query(`SELECT set_config('pos.test_actor', $1, true)`, [actorA])
  await b.query(`SELECT set_config('pos.test_actor', $1, true)`, [actorB])
  const left = a.query(sql, params).then(row => ({ who: 'a', ok: true, row })).catch(error => ({ who: 'a', ok: false, error }))
  const right = b.query(sql, params).then(row => ({ who: 'b', ok: true, row })).catch(error => ({ who: 'b', ok: false, error }))
  const first = await Promise.race([left, right])
  const winner = first.who === 'a' ? a : b
  const loserClient = first.who === 'a' ? b : a
  const secondPromise = first.who === 'a' ? right : left
  if (first.ok) await winner.query('COMMIT')
  else await winner.query('ROLLBACK')
  const second = await secondPromise
  await loserClient.query(second.ok ? 'COMMIT' : 'ROLLBACK')
  return [first, second]
}

async function main() {
  const pg = (await import('pg')).default
  const root = client(pg)
  await root.connect()
  await root.query(`SET statement_timeout = '15s'`)
  const db = await root.query('SELECT current_database() AS name')
  if (!/_test$/i.test(db.rows[0].name)) {
    console.error(`refusing database ${db.rows[0].name}; name must end with _test`)
    await root.end()
    process.exit(1)
  }
  await root.query(preamble)
  await root.query(readFileSync('sql/pos_floor.sql', 'utf8'))
  await root.query(`
    INSERT INTO public.perfis (id, role, bar_id) VALUES
      ('${userA}', 'caixa', '${bar}'),
      ('${userB}', 'gerente', '${bar}'),
      ('${userJbm}', 'jbm', NULL),
      ('${userSupplier}', 'fornecedor', '${bar}')
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, bar_id = EXCLUDED.bar_id;
    INSERT INTO public.produtos (id, nome, volume_ml, custo) VALUES
      ('${spirit}', 'Hennessy', 700, 18000),
      ('${sealed}', 'Sealed bottle', 700, 9000)
    ON CONFLICT (id) DO UPDATE SET volume_ml = EXCLUDED.volume_ml, custo = EXCLUDED.custo;
    INSERT INTO public.drink_menu (id, bar_id, nome, preco_venda) VALUES
      ('${drink}', '${bar}', 'Hennessy Coca', 3000)
    ON CONFLICT (id) DO UPDATE SET preco_venda = EXCLUDED.preco_venda;
    INSERT INTO public.bar_pricing (bar_id, produto_id, preco_drink) VALUES
      ('${bar}', '${sealed}', 2500)
    ON CONFLICT (bar_id, produto_id) DO UPDATE SET preco_drink = EXCLUDED.preco_drink;
    INSERT INTO public.drink_back_agents (id, bar_id, ativo, comissao_pct) VALUES
      ('${agent}', '${bar}', true, 50)
    ON CONFLICT (id) DO NOTHING;
  `)

  await expectRaise(root, userSupplier, () => root.query(
    `SELECT public.pos_load_ticket($1, $2, '')`,
    [bar, space],
  ), /bar not allowed/)

  await expectRaise(root, userJbm, () => root.query(
    `SELECT public.pos_load_ticket($1, $2, '')`,
    [other, space],
  ), /bar not allowed/)

  await root.query(
    `INSERT INTO public.bar_memberships (user_id, bar_id, role, granted_by)
     VALUES ($1, $2, 'jbm', $1)
     ON CONFLICT (user_id, bar_id) DO UPDATE SET revoked_at = NULL`,
    [userJbm, other],
  )
  await tx(root, userJbm, () => root.query(
    `SELECT public.pos_load_ticket($1, $2, '')`,
    [other, space],
  ))

  const pgClient = (await import('pg')).default
  const a = client(pgClient)
  const b = client(pgClient)
  await a.connect()
  await b.connect()
  await a.query(`SET statement_timeout = '15s'`)
  await b.query(`SET statement_timeout = '15s'`)

  await root.query(`DELETE FROM public.estoque_movimentos WHERE produto_id = $1`, [spirit])
  await root.query(
    `INSERT INTO public.estoque_movimentos (produto_id, bar_id, tipo, qtd, criado_por, obs) VALUES ($1, $2, 'entrada', 1, $3, 'fixture')`,
    [spirit, bar, userA],
  )
  const openRace = await race(
    a, b, userA, userB,
    `SELECT public.pos_open_bottle($1, $2, 'RACE-' || gen_random_uuid()::text)`,
    [bar, spirit],
  )
  const opened = openRace.filter(row => row.ok)
  const rejected = openRace.filter(row => !row.ok)
  assert.equal(opened.length, 1)
  assert.equal(rejected.length, 1)
  assert.match(rejected[0].error.message, /bottle not in stock/)
  const sealedLeft = await root.query(
    `SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN qtd ELSE -qtd END), 0)::int AS n
     FROM public.estoque_movimentos WHERE bar_id = $1 AND produto_id = $2`,
    [bar, spirit],
  )
  assert.equal(sealedLeft.rows[0].n, 0)
  const bottles = await root.query(`SELECT count(*)::int AS n FROM public.pos_bottles WHERE produto_id = $1`, [spirit])
  assert.equal(bottles.rows[0].n, 1)

  const ticket = await tx(root, userA, async () => {
    const loaded = await root.query(`SELECT public.pos_load_ticket($1, $2, '') AS ticket`, [bar, space])
    return loaded.rows[0].ticket.id
  })
  const addRace = await race(
    a, b, userA, userB,
    `SELECT public.pos_ticket_item($1, $2, NULL, 1, false, NULL, $3)`,
    [bar, ticket, sealed],
  )
  assert.equal(addRace.filter(row => row.ok).length, 2)
  const items = await root.query(
    `SELECT added_by FROM public.pos_ticket_items WHERE ticket_id = $1`,
    [ticket],
  )
  assert.equal(items.rows.length, 2)
  assert.equal(new Set(items.rows.map(row => row.added_by)).size, 2)

  await root.query(
    `INSERT INTO public.estoque_movimentos (produto_id, bar_id, tipo, qtd, criado_por, obs) VALUES ($1, $2, 'entrada', 5, $3, 'fixture')`,
    [sealed, bar, userA],
  )
  const payRace = await race(
    a, b, userA, userB,
    `SELECT public.pos_close_ticket($1, $2, 'cash', 'pay-' || gen_random_uuid()::text, NULL)`,
    [bar, ticket],
  )
  assert.equal(payRace.filter(row => row.ok).length, 2)
  const payBodies = payRace.filter(row => row.ok).map(row => row.row.rows[0].pos_close_ticket)
  const realSales = payBodies.filter(body => body.duplicate !== true)
  assert.equal(realSales.length, 1)
  const dupSales = payBodies.filter(body => body.duplicate === true)
  assert.equal(dupSales.length, 1)
  assert.equal(dupSales[0].venda_id, realSales[0].venda_id)

  const ticket2 = await tx(root, userA, async () => {
    const loaded = await root.query(`SELECT public.pos_load_ticket($1, $2, '') AS ticket`, [bar, spaceSame])
    const id = loaded.rows[0].ticket.id
    await root.query(
      `SELECT public.pos_ticket_item($1, $2, NULL, 1, false, NULL, $3)`,
      [bar, id, sealed],
    )
    return id
  })
  const sameKey = await race(
    a, b, userA, userB,
    `SELECT public.pos_close_ticket($1, $2, 'cash', $3, NULL)`,
    [bar, ticket2, keySame],
  )
  assert.equal(sameKey.filter(row => row.ok).length, 2)
  const sameBodies = sameKey.filter(row => row.ok).map(row => row.row.rows[0].pos_close_ticket)
  assert.equal(sameBodies.filter(body => body.duplicate !== true).length, 1)
  assert.equal(new Set(sameBodies.map(body => body.venda_id)).size, 1)

  const bare = await tx(root, userA, async () => {
    const loaded = await root.query(`SELECT public.pos_load_ticket($1, $2, '') AS ticket`, [bar, spaceBare])
    const id = loaded.rows[0].ticket.id
    await root.query(`SELECT public.pos_ticket_item($1, $2, NULL, 1, true, $3, NULL)`, [bar, id, drink])
    return id
  })
  await expectRaise(root, userA, () => root.query(
    `SELECT public.pos_close_ticket($1, $2, 'card', $3, $4)`,
    [bar, bare, keyBare, agent],
  ), /recipe required/)

  await root.query(`
    INSERT INTO public.pos_recipes (drink_menu_id, bar_id)
    SELECT '${drink}', '${bar}'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.pos_recipes WHERE drink_menu_id = '${drink}' AND bar_id = '${bar}'
    );
    INSERT INTO public.pos_recipe_lines (recipe_id, produto_id, volume_ml)
    SELECT r.id, '${spirit}', 30
    FROM public.pos_recipes r
    WHERE r.drink_menu_id = '${drink}' AND r.bar_id = '${bar}'
      AND NOT EXISTS (SELECT 1 FROM public.pos_recipe_lines l WHERE l.recipe_id = r.id);
  `)
  await root.query(`DELETE FROM public.pos_bottle_moves WHERE produto_id = $1`, [spirit])
  await root.query(`DELETE FROM public.pos_bottles WHERE produto_id = $1`, [spirit])
  await root.query(`DELETE FROM public.estoque_movimentos WHERE produto_id = $1 AND bar_id = $2`, [spirit, bar])
  await root.query(
    `INSERT INTO public.estoque_movimentos (produto_id, bar_id, tipo, qtd, criado_por, obs) VALUES ($1, $2, 'entrada', 1, $3, 'fixture')`,
    [spirit, bar, userA],
  )
  const bottleId = await tx(root, userA, async () => {
    const openedBottle = await root.query(
      `SELECT public.pos_open_bottle($1, $2, $3) AS id`,
      [bar, spirit, pourCode],
    )
    return openedBottle.rows[0].id
  })
  const pour = await tx(root, userA, async () => {
    const loaded = await root.query(`SELECT public.pos_load_ticket($1, $2, '') AS ticket`, [bar, spacePour])
    const id = loaded.rows[0].ticket.id
    await root.query(`SELECT public.pos_ticket_item($1, $2, NULL, 2, true, $3, NULL)`, [bar, id, drink])
    const closed = await root.query(
      `SELECT public.pos_close_ticket($1, $2, 'card', $3, $4) AS body`,
      [bar, id, keyPour, agent],
    )
    return closed.rows[0].body
  })
  assert.equal(pour.duplicate, false)
  assert.equal(pour.commission, 2000)
  assert.equal(pour.fee, 227)
  const volume = await root.query(`SELECT volume_atual, opened_by, custo FROM public.pos_bottles WHERE id = $1`, [bottleId])
  assert.equal(volume.rows[0].volume_atual, 640)
  assert.equal(volume.rows[0].custo, 18000)
  const spiritSaida = await root.query(
    `SELECT COALESCE(SUM(qtd), 0)::int AS n FROM public.estoque_movimentos
     WHERE produto_id = $1 AND tipo = 'saida' AND obs LIKE 'pos_venda%'`,
    [spirit],
  )
  assert.equal(spiritSaida.rows[0].n, 0)
  const night = await root.query(
    `SELECT data = operational_day AS same FROM public.caixa_movimentos
     WHERE referencia_id = $1 AND referencia_tipo = 'taxa_cartao'`,
    [pour.venda_id],
  )
  assert.equal(night.rows.length, 1)
  const cardCash = await root.query(
    `SELECT count(*)::int AS n FROM public.caixa_movimentos
     WHERE referencia_id = $1 AND referencia_tipo = 'pos_venda'`,
    [pour.venda_id],
  )
  assert.equal(cardCash.rows[0].n, 0)
  const feeLines = await root.query(
    `SELECT count(*)::int AS n FROM public.caixa_movimentos
     WHERE referencia_id = $1 AND referencia_tipo = 'taxa_cartao'`,
    [pour.venda_id],
  )
  assert.equal(feeLines.rows[0].n, 1)

  const saleItem = await root.query(
    `SELECT id, qtd, comissao_valor FROM public.pos_vendas_itens WHERE pos_venda_id = $1`,
    [pour.venda_id],
  )
  const cashierDenied = await tx(root, userA, () => root.query(
    `SELECT public.pos_void_sale($1, 'partial_refund', NULL, 'cashier void', $2, $3, 1) AS result`,
    [pour.venda_id, userB, saleItem.rows[0].id],
  ))
  assert.equal(cashierDenied.rows[0].result, null)
  const cashierDeniedAgain = await tx(root, userA, () => root.query(
    `SELECT public.pos_void_sale($1, 'partial_refund', NULL, 'cashier void', $2, $3, 1) AS result`,
    [pour.venda_id, userA, saleItem.rows[0].id],
  ))
  assert.equal(cashierDeniedAgain.rows[0].result, null)
  const untouchedPour = await root.query(
    `SELECT refunded, void_status FROM public.pos_vendas WHERE id = $1`,
    [pour.venda_id],
  )
  assert.equal(untouchedPour.rows[0].refunded, 0)
  assert.equal(untouchedPour.rows[0].void_status, null)
  const deniedVoids = await root.query(
    `SELECT result, reason FROM public.pos_void_audit WHERE venda_id = $1 AND result = 'denied'`,
    [pour.venda_id],
  )
  assert.equal(deniedVoids.rows.length, 2)
  assert.equal(deniedVoids.rows.every(row => row.reason === 'cashier void'), true)
  await tx(root, userB, () => root.query(
    `SELECT public.pos_void_sale($1, 'partial_refund', NULL, 'wrong pour', $2, $3, 1)`,
    [pour.venda_id, userB, saleItem.rows[0].id],
  ))
  await expectRaise(root, userB, () => root.query(
    `SELECT public.pos_void_sale($1, 'partial_refund', NULL, 'again', $2, $3, 2)`,
    [pour.venda_id, userB, saleItem.rows[0].id],
  ), /refund exceeds item/)
  const afterPartial = await root.query(
    `SELECT total, refunded, comissao_valor, comissao_estornada, card_fee_reversed, void_status
     FROM public.pos_vendas WHERE id = $1`,
    [pour.venda_id],
  )
  assert.equal(Number(afterPartial.rows[0].total), 6000)
  assert.equal(afterPartial.rows[0].refunded, 3000)
  assert.equal(afterPartial.rows[0].comissao_valor, 2000)
  assert.equal(afterPartial.rows[0].comissao_estornada, 1000)
  assert.ok(afterPartial.rows[0].card_fee_reversed > 0)
  const restoredMl = await root.query(
    `SELECT COALESCE(SUM(volume_ml), 0)::int AS n FROM public.pos_bottle_moves
     WHERE sale_id = $1 AND kind = 'refund'`,
    [pour.venda_id],
  )
  assert.equal(restoredMl.rows[0].n, 30)

  const unitSale = await tx(root, userA, async () => {
    const loaded = await root.query(`SELECT public.pos_load_ticket($1, $2, '') AS ticket`, [bar, spaceUnit])
    const id = loaded.rows[0].ticket.id
    await root.query(`SELECT public.pos_ticket_item($1, $2, NULL, 1, false, NULL, $3)`, [bar, id, sealed])
    const closed = await root.query(
      `SELECT public.pos_close_ticket($1, $2, 'cash', $3, NULL) AS body`,
      [bar, id, keyUnit],
    )
    return closed.rows[0].body
  })
  assert.equal(unitSale.fee, 0)
  assert.equal(unitSale.commission, 0)
  const unitSaida = await root.query(
    `SELECT COALESCE(SUM(qtd), 0)::int AS n FROM public.estoque_movimentos
     WHERE produto_id = $1 AND tipo = 'saida' AND obs LIKE $2`,
    [sealed, `pos_venda ${unitSale.venda_id}%`],
  )
  assert.equal(unitSaida.rows[0].n, 1)
  const unitMl = await root.query(
    `SELECT count(*)::int AS n FROM public.pos_bottle_moves WHERE sale_id = $1 AND kind = 'consume'`,
    [unitSale.venda_id],
  )
  assert.equal(unitMl.rows[0].n, 0)
  await tx(root, userB, () => root.query(
    `SELECT public.pos_void_sale($1, 'void', NULL, 'cash back', $2, NULL, NULL)`,
    [unitSale.venda_id, userB],
  ))
  const unitBack = await root.query(
    `SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN qtd ELSE 0 END), 0)::int AS n
     FROM public.estoque_movimentos WHERE obs LIKE $1`,
    [`pos_void ${unitSale.venda_id}%`],
  )
  assert.equal(unitBack.rows[0].n, 1)
  const kept = await root.query(`SELECT total, void_status FROM public.pos_vendas WHERE id = $1`, [unitSale.venda_id])
  assert.equal(Number(kept.rows[0].total), 2500)
  assert.equal(kept.rows[0].void_status, 'void')
  await expectRaise(root, userB, () => root.query(
    `SELECT public.pos_void_sale($1, 'refund', NULL, 'twice', $2, NULL, NULL)`,
    [unitSale.venda_id, userB],
  ), /already void/)

  await expectRaise(root, userA, () => root.query(
    `SELECT public.pos_bottle_move($1, 'waste', 10, '')`,
    [bottleId],
  ), /reason required/)
  await tx(root, userA, () => root.query(
    `SELECT public.pos_bottle_move($1, 'waste', 10, 'spilled on the bar')`,
    [bottleId],
  ))
  const audit = await root.query(
    `SELECT kind FROM public.pos_sale_events WHERE bottle_id = $1 AND kind = 'waste'`,
    [bottleId],
  )
  assert.ok(audit.rows.length >= 1)

  await a.end()
  await b.end()
  await root.end()
  console.log('pos postgres tests passed')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
