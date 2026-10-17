-- Close the drinks database to anyone without a login, keep invoices per bar, and stop till/staff logins
-- from editing or deleting sales directly. Applied to production 2026-10-17 with the owner's go-ahead.
-- Additive and safe to run again. Rollback at the end.

-- 1) Tables that had RLS off (their "authenticated" policies were ignored, so the public anon key could read,
--    write and delete): turn RLS on. Logged-in users keep the same access.
ALTER TABLE public.vendas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendas_itens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produtos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_itens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caixa_movimentos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mesas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tabs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cast_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cast_comissoes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hourly_revenue    ENABLE ROW LEVEL SECURITY;

-- 2) "Open to everyone" policies (USING true) become "logged in only".
DROP POLICY IF EXISTS pedidos_open        ON public.pedidos;
DROP POLICY IF EXISTS pedido_itens_open   ON public.pedido_itens;
DROP POLICY IF EXISTS mesas_open          ON public.mesas;
DROP POLICY IF EXISTS tabs_open           ON public.tabs;
DROP POLICY IF EXISTS cast_members_open   ON public.cast_members;
DROP POLICY IF EXISTS cast_comissoes_open ON public.cast_comissoes;
DROP POLICY IF EXISTS hourly_open         ON public.hourly_revenue;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pedido_itens','mesas','tabs','cast_members','cast_comissoes','hourly_revenue'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'logged_in') THEN
      EXECUTE format('CREATE POLICY logged_in ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
    END IF;
  END LOOP;
END $$;

-- 3) JBM invoices, their payments and receipts: JBM (admin/jbm/staff) sees all; a bar sees only its own,
--    and only the owner or manager (not the till or staff logins).
CREATE OR REPLACE FUNCTION public.jbm_can_see_bar_money(p_bar uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis p
    WHERE p.id = auth.uid()
      AND (p.role IN ('admin', 'jbm', 'staff')
           OR (p_bar IS NOT NULL AND p.bar_id = p_bar AND p.role IN ('cliente', 'gerente')))
  );
$$;
REVOKE ALL ON FUNCTION public.jbm_can_see_bar_money(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.jbm_can_see_bar_money(uuid) TO authenticated;

DROP POLICY IF EXISTS read  ON public.faturas;
DROP POLICY IF EXISTS write ON public.faturas;
DROP POLICY IF EXISTS bar_money ON public.faturas;
CREATE POLICY bar_money ON public.faturas FOR ALL TO authenticated
  USING (public.jbm_can_see_bar_money(bar_id)) WITH CHECK (public.jbm_can_see_bar_money(bar_id));

DROP POLICY IF EXISTS read  ON public.ryoshusho;
DROP POLICY IF EXISTS write ON public.ryoshusho;
DROP POLICY IF EXISTS bar_money ON public.ryoshusho;
CREATE POLICY bar_money ON public.ryoshusho FOR ALL TO authenticated
  USING (public.jbm_can_see_bar_money(bar_id)) WITH CHECK (public.jbm_can_see_bar_money(bar_id));

DROP POLICY IF EXISTS read  ON public.fatura_pagamentos;
DROP POLICY IF EXISTS write ON public.fatura_pagamentos;
DROP POLICY IF EXISTS bar_money ON public.fatura_pagamentos;
CREATE POLICY bar_money ON public.fatura_pagamentos FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.faturas f WHERE f.id = fatura_id AND public.jbm_can_see_bar_money(f.bar_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.faturas f WHERE f.id = fatura_id AND public.jbm_can_see_bar_money(f.bar_id)));

-- 4) Till sales: till (caixa) and staff (bar_staff) logins may ring up sales and attach a guest/visit/tab, but
--    not change money, void, or delete, except their own sale from the last 10 minutes (stock-write rollback).
--    The server (service key) and the owner/manager are not limited. Same rule as api/_posSaleStamp.js.
CREATE OR REPLACE FUNCTION public.pos_sale_front_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_sale public.pos_vendas%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT role INTO v_role FROM public.perfis WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('caixa', 'bar_staff') THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_TABLE_NAME = 'pos_vendas' THEN
    IF TG_OP = 'INSERT' THEN
      IF COALESCE(NEW.total, 0) < 0 THEN RAISE EXCEPTION 'Only the owner or a manager can void a sale'; END IF;
      RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
      IF (NEW.total, NEW.subtotal, NEW.desconto_total, NEW.metodo_pagamento, NEW.refunded, NEW.card_fee,
          NEW.card_fee_reversed, NEW.comissao_valor, NEW.data, NEW.bar_id, NEW.obs, NEW.criado_por, NEW.drink_back_agent_id)
         IS DISTINCT FROM
         (OLD.total, OLD.subtotal, OLD.desconto_total, OLD.metodo_pagamento, OLD.refunded, OLD.card_fee,
          OLD.card_fee_reversed, OLD.comissao_valor, OLD.data, OLD.bar_id, OLD.obs, OLD.criado_por, OLD.drink_back_agent_id) THEN
        RAISE EXCEPTION 'Only the owner or a manager can change a sale';
      END IF;
      RETURN NEW;
    ELSE
      IF OLD.criado_por IS DISTINCT FROM auth.uid() OR OLD.criado_em < now() - interval '10 minutes' THEN
        RAISE EXCEPTION 'Only the owner or a manager can delete a sale';
      END IF;
      RETURN OLD;
    END IF;
  END IF;

  -- pos_vendas_itens: no edits; delete only with the parent sale rule above.
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Only the owner or a manager can change a sale'; END IF;
  IF TG_OP = 'DELETE' THEN
    SELECT * INTO v_sale FROM public.pos_vendas WHERE id = OLD.pos_venda_id;
    IF FOUND AND (v_sale.criado_por IS DISTINCT FROM auth.uid() OR v_sale.criado_em < now() - interval '10 minutes') THEN
      RAISE EXCEPTION 'Only the owner or a manager can delete a sale';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_vendas_front_guard ON public.pos_vendas;
CREATE TRIGGER pos_vendas_front_guard BEFORE INSERT OR UPDATE OR DELETE ON public.pos_vendas
  FOR EACH ROW EXECUTE FUNCTION public.pos_sale_front_guard();
DROP TRIGGER IF EXISTS pos_vendas_itens_front_guard ON public.pos_vendas_itens;
CREATE TRIGGER pos_vendas_itens_front_guard BEFORE UPDATE OR DELETE ON public.pos_vendas_itens
  FOR EACH ROW EXECUTE FUNCTION public.pos_sale_front_guard();

-- Rollback:
-- DROP TRIGGER pos_vendas_front_guard ON public.pos_vendas; DROP TRIGGER pos_vendas_itens_front_guard ON public.pos_vendas_itens;
-- DROP POLICY bar_money ON public.faturas / ryoshusho / fatura_pagamentos, then recreate "read"/"write" with
--   USING (auth.role() = 'authenticated');
-- ALTER TABLE <table> DISABLE ROW LEVEL SECURITY for the 11 tables in step 1 (not recommended).
