-- NOT EXECUTED against any hosted Supabase project.
-- Read-only catalog preflight for a human operator, after a backup and a written
-- confirmation of the project ref. This file has no CREATE, ALTER, DROP, INSERT,
-- UPDATE, DELETE, GRANT, REVOKE, or TRUNCATE.
-- It does not prove that a later migration is safe. It only describes the catalog
-- that is visible to the role running it.
-- Do not run this on ojirgkqtqvugqktyuhem or fxsakrshmldmkdmbevna from this repository.

WITH wanted(object_name, object_kind) AS (
  VALUES
    ('bars', 'table'),
    ('perfis', 'table'),
    ('vendas', 'table'),
    ('pos_vendas', 'table'),
    ('caixa_movimentos', 'table'),
    ('estoque_movimentos', 'table'),
    ('pedidos', 'table'),
    ('produtos', 'table'),
    ('platform_access', 'table'),
    ('bar_memberships', 'table'),
    ('schema_install', 'table'),
    ('procurement_tasks', 'table'),
    ('jbm_financeiro', 'table'),
    ('hr_placements', 'table'),
    ('user_can_access_bar', 'function'),
    ('is_jbm', 'function'),
    ('pos_void_sale', 'function'),
    ('sales_indicator', 'function'),
    ('get_my_procurement_tasks', 'function')
),
presence AS (
  SELECT
    w.object_name,
    w.object_kind,
    CASE
      WHEN w.object_kind = 'table' AND EXISTS (
        SELECT 1 FROM information_schema.tables t
        WHERE t.table_schema = 'public' AND t.table_name = w.object_name
      ) THEN 'present'
      WHEN w.object_kind = 'function' AND EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = w.object_name
      ) THEN 'present'
      ELSE 'absent'
    END AS status
  FROM wanted w
)
SELECT 'preflight' AS section, object_name AS object, object_kind AS kind, status, '' AS detail
FROM presence
UNION ALL
SELECT
  'preflight',
  'server_version',
  'setting',
  'info',
  current_setting('server_version')
UNION ALL
SELECT
  'preflight',
  'current_database',
  'setting',
  'info',
  current_database()
UNION ALL
SELECT
  'preflight',
  'public_policy_count',
  'policy',
  'info',
  (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public')
UNION ALL
SELECT
  'preflight',
  'is_jbm_requires_platform_access',
  'function',
  CASE
    WHEN EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'is_jbm'
        AND pg_get_functiondef(p.oid) ILIKE '%platform_access%'
    ) THEN 'yes'
    WHEN EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'is_jbm'
    ) THEN 'no'
    ELSE 'absent'
  END,
  'yes means the repository body is already installed; no means a different body is live'
UNION ALL
SELECT
  'preflight',
  'mutation',
  'guard',
  'not_allowed',
  'this script does not change the catalog'
ORDER BY 1, 2;
