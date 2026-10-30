-- Audit log: who created, changed or deleted invoices, payments, receipts, products and purchases.
-- Written by database triggers, so every screen (and the AI) is covered without extra code.
-- Run once in Supabase → SQL Editor for project ojirgkqtqvugqktyuhem. Safe to run again.

CREATE TABLE IF NOT EXISTS public.audit_log (
  id bigserial PRIMARY KEY,
  criado_em timestamptz NOT NULL DEFAULT now(),
  user_id uuid DEFAULT auth.uid(),
  user_nome text,
  tabela text NOT NULL,
  registro_id text,
  acao text NOT NULL CHECK (acao IN ('insert', 'update', 'delete')),
  antes jsonb,
  depois jsonb
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Only JBM admins read it; nobody writes or deletes rows by hand (the trigger runs as owner).
DROP POLICY IF EXISTS audit_log_admin_read ON public.audit_log;
CREATE POLICY audit_log_admin_read ON public.audit_log
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.perfis p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

CREATE INDEX IF NOT EXISTS audit_log_when_idx ON public.audit_log (criado_em DESC);
CREATE INDEX IF NOT EXISTS audit_log_row_idx ON public.audit_log (tabela, registro_id);

CREATE OR REPLACE FUNCTION public.audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rid text;
  who text;
BEGIN
  rid := COALESCE(to_jsonb(NEW)->>'id', to_jsonb(OLD)->>'id');
  SELECT COALESCE(p.nome, p.email) INTO who FROM public.perfis p WHERE p.id = auth.uid();
  INSERT INTO public.audit_log (user_id, user_nome, tabela, registro_id, acao, antes, depois)
  VALUES (
    auth.uid(), who, TG_TABLE_NAME, rid, lower(TG_OP),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['faturas', 'fatura_pagamentos', 'ryoshusho', 'produtos', 'compras'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_%1$s ON public.%1$I', t);
      EXECUTE format('CREATE TRIGGER audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.audit_row()', t);
    END IF;
  END LOOP;
END $$;
