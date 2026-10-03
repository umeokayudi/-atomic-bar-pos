# Test results

Staging-prep pass on branch `cursor/staging-homologation-prep-9d4b`, local PostgreSQL 16. Databases: `atomic_bar_foundation_test` and `atomic_bar_pos_test`. No Supabase host was used. Homologation was not performed.

| Command | Result |
|---|---|
| `npm run test:foundation` | passed. Fresh install, second install, `verify_schema.sql` `SUMMARY\|OK`. Denied voids return NULL, leave the sale unchanged, and commit a `denied` row. An explicit rollback drops an in-flight denial. Applied void still rolls back with the sale. Two partial voids then a rejected third. Till net 800 against gross 4200. JBM net 1000 against gross 1400 |
| `POS_PG_TEST_URL` pointing at local `atomic_bar_pos_test` as `atomic_tester`, then `npm run test:pos:pg` | passed on a newly created database. Two cashier denials return NULL and do not change the sale. The gerente partial refund still applies |
| `npm run test:books` | passed. Normal sale, voided sale, and partial void. Till and JBM are not added |
| `npm run test:pos` | passed |
| `npm run test:procurement` | passed (36) |
| `npm run test:payroll` | passed |
| `npm run test:analytics` | passed |
| `npm run test:reports` | passed |
| `npm run test:readiness` | passed |
| `npm run test:supabase` | passed |
| `npm run test:demo` | passed. The browser demo ledger was not rewritten |
| `npm run test:ai` | passed |
| `VERCEL_ENV=preview npm run build` | passed. Existing Vite CJS `import.meta` warnings and the chunk-size warning remain |

Not executed: SQL against hosted Supabase, the protected project refs, deploy, and merge.

The local install is reproducible: `npm run test:foundation` drops `atomic_bar_foundation_test`, installs into that empty database, installs again, and checks `SUMMARY|OK`.
