/**
 * Read-only list of bar_pricing rows that share (bar_id, produto_id).
 * Does not change any row.
 *
 *   BAR_PRICING_CHECK_URL=postgres://.../name_test node scripts/checkBarPricingDuplicates.mjs
 *
 * A Supabase host is refused. This script is a precheck, not a migration.
 * Without BAR_PRICING_CHECK_URL it prints that nothing was checked and exits 0.
 * Exit 2 means duplicate groups were found. Exit 3 means the table shape cannot be grouped.
 */
import pg from 'pg'

const url = process.env.BAR_PRICING_CHECK_URL
if (!url) {
  console.log('bar_pricing duplicate check skipped (BAR_PRICING_CHECK_URL is not set)')
  process.exit(0)
}
if (/supabase\.co/i.test(url)) {
  console.error('refusing a Supabase host')
  process.exit(1)
}

const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  const exists = await client.query(`SELECT to_regclass('public.bar_pricing') AS rel`)
  if (!exists.rows[0].rel) {
    console.log('duplicate_groups: 0')
    console.log('bar_pricing is absent')
    process.exit(0)
  }
  const columns = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bar_pricing'
  `)
  const names = new Set(columns.rows.map(row => row.column_name))
  if (!names.has('bar_id') || !names.has('produto_id') || !names.has('id')) {
    console.error('BLOCKED: bar_pricing is missing id, bar_id, or produto_id. No rows were changed.')
    process.exit(3)
  }
  const dupes = await client.query(`
    SELECT bar_id::text AS bar_id,
           produto_id::text AS produto_id,
           count(*)::int AS duplicate_rows,
           array_agg(id::text ORDER BY id::text) AS ids
    FROM public.bar_pricing
    GROUP BY bar_id, produto_id
    HAVING count(*) > 1
    ORDER BY 1, 2
  `)
  console.log(`duplicate_groups: ${dupes.rows.length}`)
  console.log('bar_id\tproduto_id\tduplicate_rows\tids')
  for (const row of dupes.rows) {
    console.log(`${row.bar_id}\t${row.produto_id}\t${row.duplicate_rows}\t${row.ids.join(',')}`)
  }
  process.exit(dupes.rows.length > 0 ? 2 : 0)
} finally {
  await client.end()
}
