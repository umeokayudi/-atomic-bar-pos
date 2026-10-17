// One-time copy of the bar's JSON tables into Postgres (api/_liveImport.js), against a fake Supabase client.
import assert from 'node:assert/strict'
import { cleanLegacyRow, importLegacyOnce, legacyUuid, resetImportState } from '../api/_liveImport.js'

let passed = 0
async function test(name, fn) {
  resetImportState()
  await fn()
  passed++
  console.log(`ok ${passed} - ${name}`)
}

/** Fake client: `pg` maps table -> { rows, columns } (missing key = no table); `files` maps storage path -> JSON text. */
function fakeAdmin({ pg = {}, files = {}, storageDown = false } = {}) {
  const calls = { upserts: [], uploads: [] }
  const missing = t => ({ data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${t}' in the schema cache` } })
  const admin = {
    calls,
    from(table) {
      return {
        select() {
          return { limit: async () => (pg[table] ? { data: pg[table].rows.slice(0, 1), error: null } : missing(table)) }
        },
        async upsert(input, opts) {
          if (!pg[table]) return missing(table)
          const list = Array.isArray(input) ? input : [input]
          calls.upserts.push({ table, n: list.length, opts })
          for (const r of list) {
            const bad = Object.keys(r).find(k => !pg[table].columns.includes(k))
            if (bad) return { error: { code: 'PGRST204', message: `Could not find the '${bad}' column of '${table}' in the schema cache` } }
            if (pg[table].fk && !pg[pg[table].fk.table].rows.some(p => p.id === r[pg[table].fk.col])) {
              return { error: { code: '23503', message: 'violates foreign key constraint' } }
            }
          }
          for (const r of list) if (!pg[table].rows.some(x => x.id === r.id)) pg[table].rows.push(r)
          return { error: null }
        },
      }
    },
    storage: {
      from() {
        return {
          async download(path) {
            if (storageDown) return { data: null, error: { message: 'JWT expired' } }
            if (!(path in files)) return { data: null, error: { message: 'Object not found' } }
            return { data: { text: async () => files[path] }, error: null }
          },
          async upload(path, body) {
            if (storageDown) return { error: { message: 'JWT expired' } }
            files[path] = body.toString()
            calls.uploads.push(path)
            return { error: null }
          },
        }
      },
    },
  }
  return admin
}

const BAR = 'b23a5f97-ad4c-4c2a-baa6-72a0d3ba85b9'
const SALE = '11111111-1111-4111-8111-111111111111'
const opts = { bucket: 'system-private' }

await test('copies JSON rows into an empty Postgres table and leaves a marker', async () => {
  const pg = { vip_members: { rows: [], columns: ['id', 'bar_id', 'nome', 'criado_em'] } }
  const files = { 'bar-live/vip_members.json': JSON.stringify({ rows: [{ id: '22222222-2222-4222-8222-222222222222', bar_id: BAR, nome: 'Tanaka', criado_em: '2026-09-18' }] }) }
  const admin = fakeAdmin({ pg, files })
  const r = await importLegacyOnce(admin, 'vip_members', opts)
  assert.equal(r.total, 1)
  assert.equal(r.ok, 1)
  assert.equal(pg.vip_members.rows.length, 1)
  assert.ok(files['bar-live/_imported/vip_members.json'])
  assert.ok(files['bar-live/vip_members.json'], 'JSON file stays as backup')
})

await test('runs once: a second call does nothing', async () => {
  const pg = { vip_members: { rows: [], columns: ['id', 'bar_id', 'nome'] } }
  const files = { 'bar-live/vip_members.json': JSON.stringify([{ id: '22222222-2222-4222-8222-222222222222', bar_id: BAR, nome: 'A' }]) }
  const admin = fakeAdmin({ pg, files })
  await importLegacyOnce(admin, 'vip_members', opts)
  assert.equal(await importLegacyOnce(admin, 'vip_members', opts), null)
  resetImportState()
  assert.equal(await importLegacyOnce(admin, 'vip_members', opts), null, 'marker in Storage stops a new server instance too')
  assert.equal(admin.calls.upserts.length, 1)
})

await test('copies the sale before its lines (foreign key)', async () => {
  const pg = {
    pos_vendas: { rows: [], columns: ['id', 'bar_id', 'total'] },
    pos_vendas_itens: { rows: [], columns: ['id', 'pos_venda_id', 'nome', 'qtd', 'preco_unitario'], fk: { table: 'pos_vendas', col: 'pos_venda_id' } },
  }
  const files = {
    'bar-live/pos_vendas.json': JSON.stringify([{ id: SALE, bar_id: BAR, total: 2000 }]),
    'bar-live/pos_vendas_itens.json': JSON.stringify([{ id: '33333333-3333-4333-8333-333333333333', pos_venda_id: SALE, nome: 'Highball', qtd: 2, preco_unitario: 1000 }]),
  }
  const admin = fakeAdmin({ pg, files })
  const r = await importLegacyOnce(admin, 'pos_vendas_itens', opts)
  assert.equal(r.ok, 1)
  assert.equal(pg.pos_vendas.rows.length, 1)
  assert.equal(pg.pos_vendas_itens.rows.length, 1)
})

await test('drops columns Postgres does not have instead of failing', async () => {
  const pg = { bar_spaces: { rows: [], columns: ['id', 'bar_id', 'nome'] } }
  const files = { 'bar-live/bar_spaces.json': JSON.stringify([{ id: '44444444-4444-4444-8444-444444444444', bar_id: BAR, nome: 'T1', cor_extra: 'red' }]) }
  const r = await importLegacyOnce(fakeAdmin({ pg, files }), 'bar_spaces', opts)
  assert.equal(r.ok, 1)
  assert.deepEqual(r.dropped, ['cor_extra'])
})

await test('fallback ids become the same uuid in the row and in references to it', async () => {
  const sale = cleanLegacyRow({ id: 'live-1-abc', bar_id: BAR })
  const line = cleanLegacyRow({ id: 'live-2-def', pos_venda_id: 'live-1-abc' })
  assert.match(sale.id, /^[0-9a-f-]{36}$/)
  assert.equal(line.pos_venda_id, sale.id)
  assert.equal(sale.bar_id, BAR)
  assert.equal(legacyUuid('x'), legacyUuid('x'))
})

await test('no Postgres table yet: nothing copied, no marker', async () => {
  const files = { 'bar-live/pos_shifts.json': '[]' }
  const admin = fakeAdmin({ files })
  assert.equal(await importLegacyOnce(admin, 'pos_shifts', opts), null)
  assert.equal(admin.calls.uploads.length, 0)
})

await test('Storage unreadable: no marker, so it tries again later', async () => {
  const pg = { vip_members: { rows: [], columns: ['id', 'bar_id', 'nome'] } }
  const admin = fakeAdmin({ pg, storageDown: true })
  assert.equal(await importLegacyOnce(admin, 'vip_members', opts), null)
  assert.equal(admin.calls.upserts.length, 0)
})

await test('no JSON file: marks the table done with nothing copied', async () => {
  const pg = { pos_shifts: { rows: [], columns: ['id'] } }
  const files = {}
  const r = await importLegacyOnce(fakeAdmin({ pg, files }), 'pos_shifts', opts)
  assert.equal(r.total, 0)
  assert.ok(files['bar-live/_imported/pos_shifts.json'])
})

await test('a row that cannot be copied is reported and the rest still go in', async () => {
  const pg = {
    pos_vendas: { rows: [{ id: SALE }], columns: ['id', 'bar_id', 'total'] },
    pos_vendas_itens: { rows: [], columns: ['id', 'pos_venda_id', 'nome'], fk: { table: 'pos_vendas', col: 'pos_venda_id' } },
  }
  const files = {
    'bar-live/_imported/pos_vendas.json': '{}',
    'bar-live/pos_vendas_itens.json': JSON.stringify([
      { id: '55555555-5555-4555-8555-555555555555', pos_venda_id: SALE, nome: 'ok' },
      { id: '66666666-6666-4666-8666-666666666666', pos_venda_id: '77777777-7777-4777-8777-777777777777', nome: 'orphan' },
    ]),
  }
  const r = await importLegacyOnce(fakeAdmin({ pg, files }), 'pos_vendas_itens', opts)
  assert.equal(r.ok, 1)
  assert.equal(r.failed.length, 1)
  assert.equal(r.failed[0].id, '66666666-6666-4666-8666-666666666666')
})

console.log(`\n${passed} passed`)
