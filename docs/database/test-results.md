# Test results

Review pass on branch `cursor/foundation-review-9d4b`, local PostgreSQL 16. Databases: `atomic_bar_foundation_test` and `atomic_bar_pos_test`. No Supabase host was used.

| Command | Result |
|---|---|
| `npm run test:foundation` | passed. Includes a fresh install of `sql/install_fresh.sql`, cashier and funcionário void denied with `refunded` unchanged and no denial audit row, gerente void with one `pos_void_audit` row (`applied`), other-bar gerente, supplier, and JBM without HQ denied, HQ admin reaches `already void` on that sale, price precedence 3000 / 2500 / 1800, `price_conflict.diverges`, `resolve_bar_price` stays 1800, till indicator 2400 and JBM indicator 1000, unknown book rejected, no shared sale id, fulfillment grants and cross-bar alert isolation |
| Second `sql/install_fresh.sql` on the populated database, inside the same command | passed (`ON_ERROR_STOP`) |
| `sql/verify_schema.sql` after that second install | `SUMMARY\|OK` |
| `POS_PG_TEST_URL=postgres://atomic_tester@127.0.0.1:5432/atomic_bar_pos_test npm run test:pos:pg` | passed on a newly created database. Cashier void denied; gerente partial refund still applies |
| `npm run test:pos` | passed |
| `npm run test:readiness` | passed |
| `npm run test:supabase` | passed |
| `npm run test:demo` | passed |
| `npm run test:procurement` | passed (36) |
| `npm run test:payroll` | passed |
| `npm run test:legacy` | passed |
| `npm run test:analytics` | passed |
| `npm run test:reports` | passed |
| `npm run test:ai` | passed |
| `VERCEL_ENV=preview npm run build` | passed. Existing Vite CJS `import.meta` warnings and the chunk-size warning remain |

Not executed: any SQL against hosted Supabase, the two protected project refs, a staging apply, deploy, and merge.

`npm run test:procurement` and `npm run test:payroll` are in-memory checks of the JavaScript cores. The PostgreSQL procurement and payroll checks are inside `npm run test:foundation`.

The local install is reproducible: the foundation command drops `atomic_bar_foundation_test`, installs into that empty database, and the same script installs again before `verify_schema.sql`.
