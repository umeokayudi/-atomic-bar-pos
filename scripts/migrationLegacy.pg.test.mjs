/**
 * Applies sql/migration_final.sql on disposable local databases.
 * Does not connect to Supabase. Does not read or write production.
 *
 *   node scripts/migrationLegacy.pg.test.mjs
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const migration = new URL('../sql/migration_final.sql', import.meta.url)
const schema = new URL('./fixtures/legacy_schema.sql', import.meta.url)
const seed = new URL('./fixtures/legacy_seed.sql', import.meta.url)

function psql(database, args, allowFailure = false) {
  try {
    return execFileSync(
      'sudo',
      ['-u', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-d', database, ...args],
      { encoding: 'utf8' },
    )
  } catch (error) {
    if (allowFailure) return `${error.stdout || ''}\n${error.stderr || ''}`
    throw error
  }
}

function recreate(database) {
  psql('postgres', ['-c', `DROP DATABASE IF EXISTS ${database}`])
  psql('postgres', ['-c', `CREATE DATABASE ${database}`])
}

function scalar(database, sql) {
  const out = psql(database, ['-t', '-A', '-c', sql])
  return out.trim()
}

function applyMigration(database) {
  psql(database, ['-f', migration.pathname])
}

const emptyDb = 'migration_legacy_empty_9777'
const dataDb = 'migration_legacy_data_9777'
const dupDb = 'migration_pricing_dups_9777'

recreate(emptyDb)
psql(emptyDb, ['-f', schema.pathname])
applyMigration(emptyDb)
applyMigration(emptyDb)
assert.equal(scalar(emptyDb, `SELECT count(*) FROM public.pos_vendas`), '0')
assert.equal(scalar(emptyDb, `SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'produtos' AND column_name = 'bar_id'`), '0')
assert.equal(scalar(emptyDb, `SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('deduct_stock', 'create_order')`), '0')

recreate(dataDb)
psql(dataDb, ['-f', schema.pathname])
psql(dataDb, ['-f', seed.pathname])
applyMigration(dataDb)

assert.equal(scalar(dataDb, `SELECT valor::text || '|' || descricao || '|' || (bar_id IS NULL)::text || '|' || (operational_day IS NULL)::text FROM public.caixa_movimentos WHERE id = '55555555-5555-4555-8555-555555555555'`), '12345|historical-jbm|true|true')
assert.equal(scalar(dataDb, `SELECT count(*) FROM public.estoque_movimentos`), '2')
assert.equal(scalar(dataDb, `SELECT estoque_atual::text FROM public.produtos WHERE id = '33333333-3333-4333-8333-333333333333'`), '7')
assert.equal(scalar(dataDb, `SELECT count(*) FROM public.pedidos`), '1')
assert.equal(scalar(dataDb, `SELECT count(*) FROM public.vendas`), '1')
assert.equal(scalar(dataDb, `SELECT string_agg(preco_drink::text, ',' ORDER BY preco_drink) FROM public.bar_pricing`), '1500,1800')
assert.equal(scalar(dataDb, `SELECT indexdef FROM pg_indexes WHERE indexname = 'bar_pricing_bar_produto_uidx'`).includes('UNIQUE'), true)
assert.equal(scalar(dataDb, `SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vendas' AND column_name IN ('forma_pagamento', 'mesa', 'status', 'origem')`), '0')
assert.equal(scalar(dataDb, `SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'caixa_movimentos' AND column_name IN ('bar_id', 'referencia_tipo', 'referencia_id', 'operational_day')`), '4')
assert.equal(scalar(dataDb, `SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.caixa_movimentos'::regclass`), 'true')
assert.equal(scalar(dataDb, `SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.vendas'::regclass`), 'false')
assert.equal(scalar(dataDb, `SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.pedidos'::regclass`), 'false')
assert.equal(scalar(dataDb, `SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.perfis'::regclass`), 'false')
assert.equal(scalar(dataDb, `SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.produtos'::regclass`), 'false')

psql(dataDb, ['-c', `INSERT INTO public.pos_vendas (id, bar_id, data, total) VALUES ('21212121-2121-4212-8212-212121212121', '11111111-1111-4111-8111-111111111111', DATE '2026-01-20', 100)`])
psql(dataDb, ['-c', `INSERT INTO public.caixa_movimentos (id, tipo, valor, data, descricao, bar_id) VALUES ('23232323-2323-4232-8232-232323232323', 'entrada', 100, now(), 'bar-a-cash', '11111111-1111-4111-8111-111111111111')`])

function asRole(actor, sql) {
  const out = psql(dataDb, ['-t', '-A', '-c', `BEGIN; SELECT set_config('pos.test_actor', '${actor}', true); SET LOCAL ROLE authenticated; ${sql}; ROLLBACK;`])
  const lines = out.trim().split('\n').map(line => line.trim()).filter(line => /^\d+$/.test(line))
  assert.equal(lines.length, 1, out)
  return lines[0]
}

const jbm = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const caixaA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const gerenteB = '66666666-6666-4666-8666-666666666666'
const funcionario = '99999999-9999-4999-8999-999999999999'
const historical = `SELECT count(*) FROM public.caixa_movimentos WHERE id = '55555555-5555-4555-8555-555555555555'`
const barCash = `SELECT count(*) FROM public.caixa_movimentos WHERE id = '23232323-2323-4232-8232-232323232323'`
const sale = `SELECT count(*) FROM public.pos_vendas WHERE id = '21212121-2121-4212-8212-212121212121'`

assert.equal(asRole(jbm, historical), '1')
assert.equal(asRole(caixaA, historical), '0')
assert.equal(asRole(caixaA, barCash), '1')
assert.equal(asRole(gerenteB, barCash), '0')
assert.equal(asRole(gerenteB, sale), '0')
assert.equal(asRole(caixaA, sale), '1')
assert.equal(asRole(funcionario, historical), '0')
assert.equal(asRole(funcionario, sale), '0')

applyMigration(dataDb)
assert.equal(scalar(dataDb, `SELECT count(*) FROM public.caixa_movimentos`), '2')
assert.equal(scalar(dataDb, `SELECT count(*) FROM public.bar_pricing`), '2')
assert.equal(scalar(dataDb, historical), '1')

recreate(dupDb)
psql(dupDb, ['-f', schema.pathname])
psql(dupDb, ['-c', `
  CREATE TABLE public.bar_pricing (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bar_id uuid,
    produto_id uuid
  );
  INSERT INTO public.bar_pricing (bar_id, produto_id)
  SELECT '11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333'
  FROM generate_series(1, 2);
`])
const dupOut = psql(dupDb, ['-f', migration.pathname], true)
assert.match(dupOut, /BLOCKED: bar_pricing has 1 duplicate/)
assert.equal(scalar(dupDb, `SELECT count(*) FROM public.bar_pricing`), '2')
assert.equal(scalar(dupDb, `SELECT to_regclass('public.pos_vendas') IS NULL`), 't')

function checkPricing(database) {
  return spawnSync(process.execPath, ['scripts/checkBarPricingDuplicates.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, BAR_PRICING_CHECK_URL: `postgresql://ubuntu@/${database}?host=/var/run/postgresql` },
  })
}
const found = checkPricing(dupDb)
assert.equal(found.status, 2, found.stderr)
assert.match(found.stdout, /duplicate_groups: 1/)
assert.match(found.stdout, /11111111-1111-4111-8111-111111111111\t33333333-3333-4333-8333-333333333333\t2\t/)
assert.equal(scalar(dupDb, `SELECT count(*) FROM public.bar_pricing`), '2')
const clean = checkPricing(dataDb)
assert.equal(clean.status, 0, clean.stderr)
assert.match(clean.stdout, /duplicate_groups: 0/)

const source = readFileSync(migration, 'utf8')
assert.doesNotMatch(source, /UPDATE public\.caixa_movimentos\s+SET operational_day/i)
assert.doesNotMatch(source, /DELETE FROM public\.bar_pricing/i)

console.log('legacy migration postgres checks passed')
