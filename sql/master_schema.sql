-- Install index for psql. This file does not repeat the schema.
--
-- The Supabase SQL editor does not run \ir. Pasting this file there
-- will stop on the first meta-command and will not create anything.
-- In that editor, paste each script from docs/database-deployment.md,
-- in that order, as its own query.
--
-- From the repository root, against a disposable database only:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/master_schema.sql
--
-- Do not point DATABASE_URL at ojirgkqtqvugqktyuhem or fxsakrshmldmkdmbevna.

\set ON_ERROR_STOP on
\ir ../migration.sql
\ir pos_sale_security.sql
\ir supplier_fulfillment.sql
\ir procurement.sql
\ir pos_floor.sql
\ir payroll.sql
