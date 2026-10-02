# Fresh install

## Prerequisites

PostgreSQL 14 or newer. `psql`. An empty database. Do not use project refs `ojirgkqtqvugqktyuhem` or `fxsakrshmldmkdmbevna`. Do not point this script at a hosted Supabase URL.

On a disposable local cluster the install creates `anon`, `authenticated`, and `service_role` when they are missing, and `auth.uid()` when that function is missing. On Supabase those objects already exist and are left in place. This script does not insert `auth.users` rows and does not set passwords.

## Command

From the repository root:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/install_fresh.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/verify_schema.sql
```

`DATABASE_URL` for automated tests must name a database that ends with `_test`.

Order inside `sql/install_fresh.sql`:

1. `sql/foundation/001_extensions_and_auth.sql`
2. `sql/foundation/002_identity_and_bars.sql`
3. `sql/foundation/003_operational_catalog.sql`
4. `migration.sql`
5. `sql/pos_sale_security.sql`
6. `sql/supplier_fulfillment.sql`
7. `sql/procurement.sql`
8. `sql/pos_floor.sql`
9. `sql/payroll.sql`
10. `sql/foundation/080_operations.sql`
11. `sql/foundation/090_security.sql`

Running the file again is supported. Do not run `sql/supplier_fulfillment.sql` alone after `sql/procurement.sql`.

`sql/master_schema.sql` still starts at `migration.sql` and stops on an empty database. Use `sql/install_fresh.sql` for a clean install.

## Local test

```bash
npm run test:foundation
```

With no `POS_PG_TEST_URL`, that command creates `atomic_bar_foundation_test` through the local `postgres` peer account and connects as `atomic_tester`. That password exists only on that disposable cluster.

To point the POS floor tests at another disposable database:

```bash
POS_PG_TEST_URL=postgres://.../atomic_bar_pos_test npm run test:pos:pg
```

## Staging

Create an empty Supabase project that is not one of the two protected refs. Paste each file from the order above into the SQL editor, one file at a time. Then run `sql/verify_schema.sql`. The summary row must be `SUMMARY` / `OK`. This repository has not been applied to a Supabase project.

## Rollback

There is no down migration. Drop the disposable database. Do not drop a database that already holds bar data.

## Install version

`public.schema_install.version` is `foundation-1` after a successful run.
