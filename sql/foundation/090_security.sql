-- Applied after procurement and payroll so these bodies win.
-- HQ is an explicit platform_access row, not a side effect of role = jbm.

CREATE OR REPLACE FUNCTION public.user_can_access_bar(target_bar uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT target_bar IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.perfis p
      WHERE p.id = auth.uid()
        AND (
          (
            p.bar_id = target_bar
            AND p.role IN ('cliente', 'gerente', 'caixa', 'bar_staff', 'funcionario')
          )
          OR EXISTS (
            SELECT 1 FROM public.bar_memberships m
            WHERE m.user_id = p.id AND m.bar_id = target_bar AND m.revoked_at IS NULL
          )
          OR (
            p.role = 'admin'
            AND EXISTS (
              SELECT 1 FROM public.platform_access a
              WHERE a.user_id = p.id AND a.scope = 'hq' AND a.revoked_at IS NULL
            )
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.user_can_access_bar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_access_bar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_jbm()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.perfis p
    JOIN public.platform_access a ON a.user_id = p.id
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'jbm')
      AND a.scope = 'hq'
      AND a.revoked_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.is_jbm() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_jbm() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_procurement_hq()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_jbm();
$$;

REVOKE ALL ON FUNCTION public.is_procurement_hq() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_procurement_hq() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_payroll_hq()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_jbm();
$$;

REVOKE ALL ON FUNCTION public.is_payroll_hq() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_payroll_hq() TO authenticated;

INSERT INTO public.schema_install (id, version)
VALUES (1, 'foundation-1')
ON CONFLICT (id) DO UPDATE
SET version = EXCLUDED.version, installed_at = now();

-- Tenant tables created in this foundation. Later modules already enable their own RLS.
ALTER TABLE public.bars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.perfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bar_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendas_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_vendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_vendas_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sale_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caixa_movimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_movimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_clock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_closings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bar_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bar_guests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.bars FORCE ROW LEVEL SECURITY;
ALTER TABLE public.perfis FORCE ROW LEVEL SECURITY;
ALTER TABLE public.produtos FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bar_catalog FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendas FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendas_itens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pos_vendas FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pos_vendas_itens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sale_payments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.caixa_movimentos FORCE ROW LEVEL SECURITY;
ALTER TABLE public.estoque_movimentos FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos_itens FORCE ROW LEVEL SECURITY;
ALTER TABLE public.time_clock FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cash_closings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.faturas FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bars_tenant ON public.bars;
CREATE POLICY bars_tenant ON public.bars
  FOR ALL TO authenticated
  USING (
    public.user_can_access_bar(id)
    OR public.is_jbm()
  )
  WITH CHECK (
    public.user_can_access_bar(id)
    OR public.is_jbm()
  );

DROP POLICY IF EXISTS perfis_self ON public.perfis;
CREATE POLICY perfis_self ON public.perfis
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.is_jbm()
    OR (bar_id IS NOT NULL AND public.user_can_access_bar(bar_id))
  );

DROP POLICY IF EXISTS produtos_tenant ON public.produtos;
CREATE POLICY produtos_tenant ON public.produtos
  FOR SELECT TO authenticated
  USING (
    NOT EXISTS (
      SELECT 1 FROM public.perfis p
      WHERE p.id = auth.uid() AND p.role = 'fornecedor'
    )
    AND (
      bar_id IS NULL
      OR public.user_can_access_bar(bar_id)
      OR public.is_jbm()
    )
  );

DROP POLICY IF EXISTS bar_catalog_tenant ON public.bar_catalog;
CREATE POLICY bar_catalog_tenant ON public.bar_catalog
  FOR ALL TO authenticated
  USING (public.user_can_access_bar(bar_id) OR public.is_jbm())
  WITH CHECK (public.user_can_access_bar(bar_id) OR public.is_jbm());

DROP POLICY IF EXISTS vendas_tenant ON public.vendas;
CREATE POLICY vendas_tenant ON public.vendas
  FOR ALL TO authenticated
  USING (public.user_can_access_bar(bar_id) OR public.is_jbm())
  WITH CHECK (public.user_can_access_bar(bar_id) OR public.is_jbm());

DROP POLICY IF EXISTS vendas_itens_tenant ON public.vendas_itens;
CREATE POLICY vendas_itens_tenant ON public.vendas_itens
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vendas v
      WHERE v.id = venda_id AND (public.user_can_access_bar(v.bar_id) OR public.is_jbm())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.vendas v
      WHERE v.id = venda_id AND (public.user_can_access_bar(v.bar_id) OR public.is_jbm())
    )
  );

DROP POLICY IF EXISTS pos_vendas_tenant ON public.pos_vendas;
CREATE POLICY pos_vendas_tenant ON public.pos_vendas
  FOR SELECT TO authenticated
  USING (public.user_can_access_bar(bar_id) OR public.is_jbm());

DROP POLICY IF EXISTS pos_vendas_itens_tenant ON public.pos_vendas_itens;
CREATE POLICY pos_vendas_itens_tenant ON public.pos_vendas_itens
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pos_vendas v
      WHERE v.id = pos_venda_id AND (public.user_can_access_bar(v.bar_id) OR public.is_jbm())
    )
  );

DROP POLICY IF EXISTS payments_tenant ON public.pos_sale_payments;
CREATE POLICY payments_tenant ON public.pos_sale_payments
  FOR SELECT TO authenticated
  USING (public.user_can_access_bar(bar_id) OR public.is_jbm());

DROP POLICY IF EXISTS caixa_tenant ON public.caixa_movimentos;
CREATE POLICY caixa_tenant ON public.caixa_movimentos
  FOR SELECT TO authenticated
  USING (public.user_can_access_bar(bar_id) OR public.is_jbm());

DROP POLICY IF EXISTS estoque_tenant ON public.estoque_movimentos;
CREATE POLICY estoque_tenant ON public.estoque_movimentos
  FOR SELECT TO authenticated
  USING (public.user_can_access_bar(bar_id) OR public.is_jbm());

DROP POLICY IF EXISTS pedidos_tenant ON public.pedidos;
CREATE POLICY pedidos_tenant ON public.pedidos
  FOR ALL TO authenticated
  USING (public.user_can_access_bar(bar_id) OR public.is_jbm())
  WITH CHECK (public.user_can_access_bar(bar_id) OR public.is_jbm());

DROP POLICY IF EXISTS pedidos_itens_tenant ON public.pedidos_itens;
CREATE POLICY pedidos_itens_tenant ON public.pedidos_itens
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE p.id = pedido_id AND (public.user_can_access_bar(p.bar_id) OR public.is_jbm())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE p.id = pedido_id AND (public.user_can_access_bar(p.bar_id) OR public.is_jbm())
    )
  );

DROP POLICY IF EXISTS clock_tenant ON public.time_clock;
CREATE POLICY clock_tenant ON public.time_clock
  FOR SELECT TO authenticated
  USING (
    staff_id = auth.uid()
    OR public.is_jbm()
    OR (
      public.user_can_access_bar(bar_id)
      AND EXISTS (
        SELECT 1 FROM public.perfis p
        WHERE p.id = auth.uid() AND p.role IN ('admin', 'gerente', 'cliente')
      )
    )
  );

DROP POLICY IF EXISTS cash_close_tenant ON public.cash_closings;
CREATE POLICY cash_close_tenant ON public.cash_closings
  FOR SELECT TO authenticated
  USING (public.user_can_access_bar(bar_id) OR public.is_jbm());

DROP POLICY IF EXISTS faturas_tenant ON public.faturas;
CREATE POLICY faturas_tenant ON public.faturas
  FOR SELECT TO authenticated
  USING (bar_id IS NOT NULL AND (public.user_can_access_bar(bar_id) OR public.is_jbm()));

DROP POLICY IF EXISTS spaces_tenant ON public.bar_spaces;
CREATE POLICY spaces_tenant ON public.bar_spaces
  FOR ALL TO authenticated
  USING (public.user_can_access_bar(bar_id) OR public.is_jbm())
  WITH CHECK (public.user_can_access_bar(bar_id) OR public.is_jbm());

DROP POLICY IF EXISTS guests_tenant ON public.bar_guests;
CREATE POLICY guests_tenant ON public.bar_guests
  FOR ALL TO authenticated
  USING (public.user_can_access_bar(bar_id) OR public.is_jbm())
  WITH CHECK (public.user_can_access_bar(bar_id) OR public.is_jbm());

GRANT SELECT ON public.produtos_public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bars TO authenticated;
GRANT SELECT ON public.perfis TO authenticated;
GRANT SELECT ON public.produtos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bar_catalog TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendas_itens TO authenticated;
GRANT SELECT ON public.pos_vendas TO authenticated;
GRANT SELECT ON public.pos_vendas_itens TO authenticated;
GRANT SELECT ON public.pos_sale_payments TO authenticated;
GRANT SELECT ON public.caixa_movimentos TO authenticated;
GRANT SELECT ON public.estoque_movimentos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedidos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedidos_itens TO authenticated;
GRANT SELECT ON public.time_clock TO authenticated;
GRANT SELECT ON public.cash_closings TO authenticated;
GRANT SELECT ON public.faturas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bar_spaces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bar_guests TO authenticated;
GRANT SELECT ON public.schema_install TO authenticated;
GRANT SELECT ON public.supplier_users TO authenticated;

-- Cost stays off the supplier-facing view. Direct produtos.custo is still
-- selected by manager screens; fornecedor has no row access via produtos_tenant.
REVOKE ALL ON FUNCTION public.is_jbm() FROM anon;
REVOKE ALL ON FUNCTION public.user_can_access_bar(uuid) FROM anon;
