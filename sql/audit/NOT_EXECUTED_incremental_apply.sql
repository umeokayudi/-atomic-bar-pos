-- NOT EXECUTED.
-- This file is a refusal, not a migration.
-- Applying sql/install_fresh.sql, sql/foundation/090_security.sql, or the module
-- files to an existing Supabase project would replace function bodies and named
-- policies. The live catalog has not been read. There is no down migration.
-- Running this file raises and writes nothing.

DO $$
BEGIN
  RAISE EXCEPTION
    'incremental apply to an existing Supabase project is blocked until a read-only catalog diff is reviewed';
END $$;
