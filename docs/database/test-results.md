# Test results

Risk-close pass on branch `cursor/foundation-risk-close-9d4b`, local PostgreSQL 16. Databases: `atomic_bar_foundation_test` and `atomic_bar_pos_test`. No Supabase host was used.

| Command | Result |
|---|---|
| `npm run test:foundation` | passed. Fresh install, second install, `verify_schema.sql` `SUMMARY\|OK`. Includes denied void rows that survive the aborted statement, no caller update of `pos_void_audit`, applied void rolled back with the sale, two partial voids then a rejected third, till net 800 against gross 4200, JBM net 1000 against gross 1400, missing global and bar-scoped prices, zero price, ambiguous price, fulfillment select without update, and supplier isolation |
| `POS_PG_TEST_URL=postgres://atomic_tester@127.0.0.1:5432/atomic_bar_pos_test npm run test:pos:pg` | passed on a newly created database. Two cashier denials are stored. The gerente partial refund still applies |
| `npm run test:pos` | passed |
| `npm run test:procurement` | passed (36) |
| `npm run test:payroll` | passed |
| `npm run test:analytics` | passed |
| `npm run test:reports` | passed |
| `npm run test:readiness` | passed |
| `npm run test:supabase` | passed |
| `VERCEL_ENV=preview npm run build` | passed. Existing Vite CJS `import.meta` warnings and the chunk-size warning remain |

Not executed: SQL against hosted Supabase, the protected project refs, deploy, and merge.

The local install is reproducible: `npm run test:foundation` drops `atomic_bar_foundation_test`, installs into that empty database, installs again, and checks `SUMMARY|OK`.
