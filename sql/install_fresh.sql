-- Fresh install for an empty database.
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/install_fresh.sql
-- DATABASE_URL must be a disposable database whose name ends with _test
-- when this is used for automated tests. Do not point it at
-- ojirgkqtqvugqktyuhem or fxsakrshmldmkdmbevna.

\set ON_ERROR_STOP on
\ir foundation/001_extensions_and_auth.sql
\ir foundation/002_identity_and_bars.sql
\ir foundation/003_operational_catalog.sql
\ir ../migration.sql
\ir pos_sale_security.sql
\ir supplier_fulfillment.sql
\ir procurement.sql
\ir pos_floor.sql
\ir payroll.sql
\ir foundation/080_operations.sql
\ir foundation/090_security.sql
\ir foundation/095_review.sql
