# Staging setup

Staging was not created. This workspace has no Supabase URL, anon key, service role, or `ATOMIC_STAGING_AUTHORIZED`. No project was created and no SQL was executed.

## Separation

| Mode | Data | When |
| --- | --- | --- |
| Local demo | Browser ledger only | Development, preview, or any unidentified channel without a complete isolated target |
| Preview | Isolated staging project only | `VERCEL_ENV=preview`, non-protected URL, complete anon key, `ATOMIC_STAGING_AUTHORIZED=1` |
| Production | Existing deployment, untouched | `VERCEL_ENV=production` only. This work does not change its variables and does not deploy |

Protected hosts remain refused outside production: `ojirgkqtqvugqktyuhem`, `fxsakrshmldmkdmbevna`.

`describeRuntime` in `src/lib/stagingGate.js` is the checklist. `assertMayWrite` throws `STAGING_REQUIRED` when the checklist fails, and `STAGING_NOT_CONNECTED` even when the checklist passes, because no writer is attached.

## Environment checklist

Set these on Vercel Preview only, after the operator creates the empty project. Do not put them on Production.

- `VERCEL_ENV=preview` (set by Vercel for preview deployments)
- `VITE_DEPLOY_CHANNEL=preview`
- `VITE_SUPABASE_URL` = `https://<new-ref>.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = that project's anon key
- `ATOMIC_STAGING_AUTHORIZED=1`
- `SUPABASE_SERVICE_ROLE_KEY` only in a private operator shell for migrations, never in the client bundle

Refuse the configuration when any of these are true:

- The environment is unidentified.
- The URL is missing or is not `https://<ref>.supabase.co`.
- The ref is either protected project.
- The anon key is missing, shorter than 80 characters, or contains a protected ref.
- `ATOMIC_STAGING_AUTHORIZED` is not `1`.
- The server environment is not preview.

The local demo does not read these variables. Clearing them returns the app to the browser ledger.

## Migration order

Run only against the new project, from the operator's machine, in this order:

1. `migration.sql`
2. `sql/pos_sale_security.sql`
3. `sql/supplier_fulfillment.sql`
4. `sql/procurement.sql`
5. `sql/pos_floor.sql`
6. `sql/payroll.sql`
7. `sql/verify_schema.sql` (read only)

Do not run `seed_usuarios.sql`, `RESET_UMEOKAGROUP.sql`, or `NOVO_BAR.sql`.

`npm run test:pos:pg` stays disabled until `POS_PG_TEST_URL` names a database that is not `supabase.co` and whose name ends in `_test`.

## Rollback

Before any migration, export nothing from production. On the new project:

- Apply the files in a transaction where the editor allows it, or stop at the first error.
- Drop the staging project if `verify_schema.sql` reports `MISSING` or `CONFLICT` and the operator does not want to repair it.
- Unset the preview variables and set `ATOMIC_STAGING_AUTHORIZED` empty. The app returns to the local demo and `assertMayWrite` refuses writes.

## Connection validation

`src/lib/supabaseTarget.js` refuses a server client when `VERCEL_ENV` is missing or is not `production` or `preview`. Preview still throws on an empty URL and on both protected projects. An unidentified browser channel resolves to local mode and does not receive the drinks URL.

No health check in this repository opens a socket. The operator's next check is to set the preview variables and confirm `describeRuntime` reports `operational: true` without this code creating a client.
