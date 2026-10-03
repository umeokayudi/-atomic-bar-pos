# Test results

Homologation-blocker pass on branch `cursor/homologation-blockers-9d4b`, local PostgreSQL 16. Databases: `atomic_bar_foundation_test` and `atomic_bar_pos_test`. No Supabase host was used. Homologation was not performed.

| Command | Result |
|---|---|
| `npm run test:foundation` | passed. Fresh install, second install, `verify_schema.sql` `SUMMARY\|OK`. Denied void returns NULL and leaves sale total, void status, cash rows, and stock count unchanged. An explicit rollback drops an in-flight denial. Supplier and manager cannot call `get_my_procurement_tasks`. An employee sees only an assigned task on their own bar and a linked location. A foreign task and warehouse stay hidden. `receive_procurement` and `fallback_task` on that foreign task raise and leave quantity received at 0. Supplier tracking is audience `supplier` with null sale price. Another supplier is rejected. Confirmed procurement price stays 2500. Missing, zero, and ambiguous prices set `price_state` to `unavailable`, leave revenue and margin null, and the board still returns lanes |
| `POS_PG_TEST_URL` pointing at local `atomic_bar_pos_test` as `atomic_tester`, then `npm run test:pos:pg` | passed. Two cashier denials return NULL and do not change the sale. The gerente partial refund still applies |
| `npm run test:books` | passed. Normal sale, voided sale, and partial void. Till and JBM are not added. A missing bar price does not become 2.8 times the JBM unit. Confirmed POS uses drinks times `preco_drink`. Category share stays a number when the JBM total is null |
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

Not executed: SQL against hosted Supabase, the protected project refs, deploy, and merge. The local demo shell opened in a browser and stayed on the owner desk. The client price cards and the connected procurement board were not clicked there. Those paths were checked by `test:books` and `test:foundation`. The demo ledger was not rewritten.

The local install is reproducible: `npm run test:foundation` drops `atomic_bar_foundation_test`, installs into that empty database, installs again, and checks `SUMMARY|OK`.
