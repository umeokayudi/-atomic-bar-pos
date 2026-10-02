# Staging readiness checklist

No database was contacted while this checklist was written. The browser demo remains the running mode until every item below is done by the operator.

## Required Supabase setup

Create a new project whose ref is not `ojirgkqtqvugqktyuhem` and not `fxsakrshmldmkdmbevna`.

Do not reuse either protected project, and do not copy their service-role keys.

The SQL in this repository does not create the legacy catalog. These tables must already exist on the new project before the migration files will apply: `bars`, `perfis`, `produtos`, `pedidos`, `pedidos_itens`, `vendas`, `vendas_itens`, `pos_vendas`, `pos_vendas_itens`, `caixa_movimentos`, `fornecedores`, `estoque_movimentos`, `time_clock`.

There is no `organizations` table. Isolation is `perfis.bar_id` plus `user_can_access_bar`. `admin` can access every bar. `jbm` can call `pos_require_bar` across bars. A supplier is not a bar role in that function.

Reviewed and still open before the first write:

- `pos_tickets.bar_id`, `pos_bottles.bar_id`, and `pos_idempotency.bar_id` are not foreign keys. Add those constraints on the staging project after `bars` exists, or a bad bar id can be stored.
- POS row-level security is `SELECT` only. Writes go through `SECURITY DEFINER` functions. Do not use the service role for sales, cash, clock, or stock.
- `requireStaffOrTrustedOrigin` can treat a known browser origin as trusted without a user. The staging command contract rejects that path.
- `pos_floor.sql` has not been applied anywhere. `docs/database-deployment.md` says the same.

## Required Vercel Preview variables

Set these on Preview only. Do not change Production.

- `VITE_DEPLOY_CHANNEL=preview`
- `VITE_SUPABASE_URL=https://<new-ref>.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = the new project's anon key, whose JWT `ref` equals `<new-ref>`
- `VITE_ATOMIC_STAGING_AUTHORIZED=1` so the browser bundle may leave the demo
- `ATOMIC_STAGING_AUTHORIZED=1` so the server may pass `assertServerMayConnect`
- `VERCEL_ENV=preview` is set by Vercel for preview deployments

Leave Production's variables as they are. A build with no `VITE_DEPLOY_CHANNEL` stays in `LOCAL_DEMO` and does not receive the drinks URL.

`SUPABASE_SERVICE_ROLE_KEY` for the new project belongs only in the operator's migration shell. It must not be the drinks service role, and it must not be shipped to the browser.

## Migration order

Run by hand on the new project only, one file at a time, after the legacy catalog exists:

1. `migration.sql`
2. `sql/pos_sale_security.sql`
3. `sql/supplier_fulfillment.sql`
4. `sql/procurement.sql`
5. `sql/pos_floor.sql`
6. `sql/payroll.sql`
7. `sql/verify_schema.sql` as a read

Do not run `seed_usuarios.sql`, `RESET_UMEOKAGROUP.sql`, or `NOVO_BAR.sql`.

The files are not one transaction. Stop at the first error.

## Authentication setup

Create staging users in the new project's Auth. Insert matching `perfis` rows with `id = auth.uid()` and a real `bar_id`.

Roles used by the contract:

| Command | Server role |
| --- | --- |
| `pos-sale` | gerente, admin, cliente, caixa, bar_staff |
| `discount` | gerente, admin, cliente |
| `cash-payment`, `cash-movement`, `cash-close` | gerente, admin, cliente, caixa |
| `clock` | funcionario, bar_staff, gerente, admin |
| `purchase-request` | gerente, admin |
| `supplier-status`, `stock-receipt` | fornecedor or admin; receipt also allows a purchase role |

`src/lib/stagingOperations.js` copies the role and bar from the server profile. A different role or bar in the JSON body is rejected. `clientTotal` is dropped. Prices come from the server catalog.

The handler still returns `STAGING_NOT_CONNECTED` when no store is passed. `assertMayWrite` also throws that code after the checklist passes, because no Supabase writer is attached.

## Validation procedure

Before any connection:

- `npm run test:readiness`
- `npm run test:supabase`
- Confirm `describeRuntime` on the preview env reports `runtime: STAGING` and `writes: false`.
- Confirm a request whose URL or key contains either protected ref stays `LOCAL_DEMO`.
- Confirm `VITE_DEPLOY_CHANNEL=production` together with `VERCEL_ENV=preview` stays `LOCAL_DEMO`.

After the operator connects the writer, and not before:

- Repeat one idempotency key and expect one sale.
- Sell the last unit twice and expect the second attempt to leave stock unchanged.
- Pay the same sale twice and expect `DUPLICATE_PAYMENT`.
- Close the drawer and compare variance with float + cash in − cash out.
- Clock in twice and expect `DUPLICATE_CLOCK`.
- Receive the same delivery twice and expect stock to increase once.
- Call the same command as `fornecedor` against another bar and expect `ISOLATION`.

## Rollback procedure

Unset `ATOMIC_STAGING_AUTHORIZED`, `VITE_ATOMIC_STAGING_AUTHORIZED`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` on Preview. The app returns to the browser ledger.

If a migration fails, stop. Do not run the next file. Drop the new project if `sql/verify_schema.sql` is not `OK` and the operator does not want to repair it. Do not point Preview at either protected project to "roll back".

## Remaining blockers

- No isolated project exists in this workspace.
- No writer is attached. Operational commands do not open a socket.
- The legacy catalog is not in the migration files, so an empty project cannot host the floor yet.
- POS bar columns still need foreign keys.
- Direct client writes must stay denied. Only the reviewed RPCs should mutate stock and cash.
- Payment capture and payroll posting are out of scope until those providers exist on the staging project.
- The local demo ledger is unchanged and is the only functional book until the steps above are done.
