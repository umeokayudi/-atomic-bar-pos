# Test results

Executed in this workspace against local PostgreSQL 16. Databases: `atomic_bar_foundation_test` and `atomic_bar_pos_test`. No Supabase host was used.

| Command | Result |
|---|---|
| `npm run test:foundation` | passed. Fresh install, failed-transaction rollback, tax, stock including a last-unit race, discount, split cash and card, duplicate payment key, duplicate close, cash drawer, cash close, refund, cross-bar isolation, JBM without HQ, JBM membership, HQ audit, supplier cost, clock punches, payroll isolation, procurement through bar confirmation |
| Repeat `sql/install_fresh.sql` on the same database | exit 0 |
| `sql/verify_schema.sql` | `SUMMARY OK`, 0 objects not PASS |
| `POS_PG_TEST_URL=.../atomic_bar_pos_test npm run test:pos:pg` | passed |
| `npm run test:readiness` | passed |
| `npm run test:supabase` | passed |
| `npm run test:demo` | passed |
| `npm run test:pos` | passed |
| `npm run test:procurement` | passed (36) |
| `npm run test:payroll` | passed |
| `npm run test:legacy` | passed |
| `VERCEL_ENV=preview npm run build` | passed. Existing Vite CJS `import.meta` warnings and the chunk-size warning remain |

Not run: a Supabase staging project, production SQL, and any test whose URL contains `supabase.co`.

`npm run test:procurement` and `npm run test:payroll` are in-memory checks of the JavaScript cores. The PostgreSQL procurement and payroll checks are inside `npm run test:foundation`.
