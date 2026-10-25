-- JBMTech: a bar's own purchases from its own suppliers ("Own orders" on the bar's Drink supply page).
-- Project ojirgkqtqvugqktyuhem. NOT applied by the app or by CI: run it in staging first, then production.
--
-- Order:   independent.
-- Nature:  additive. CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION. No existing table or row is touched.
-- Access:  only the owner/manager (cliente/gerente) of that bar reads and writes its rows.
--          JBM (admin/jbm) is left out on purpose: these orders stay in the bar and never reach JBM,
--          and nothing here touches pedidos, vendas, faturas or notificacoes.
-- Until this runs, the bar page shows "not set up yet" on the Own orders step and everything else works.
-- Rollback: see the end of this file.

CREATE OR REPLACE FUNCTION public.jbm_is_bar_manager_only(p_bar uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_bar IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.perfis p
    WHERE p.id = auth.uid()
      AND p.bar_id = p_bar
      AND p.role IN ('cliente', 'gerente')
  );
$$;

REVOKE ALL ON FUNCTION public.jbm_is_bar_manager_only(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.jbm_is_bar_manager_only(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.bar_own_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  fornecedor text NOT NULL CHECK (char_length(fornecedor) BETWEEN 1 AND 120),
  data date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Tokyo')::date,
  -- [{ "nome": "Heineken 330ml", "qtd": 24, "preco": 180 }]
  itens jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(itens) = 'array'),
  total numeric NOT NULL DEFAULT 0 CHECK (total >= 0),
  status text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'received', 'cancelled')),
  obs text CHECK (obs IS NULL OR char_length(obs) <= 500),
  criado_por uuid DEFAULT auth.uid(),
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bar_own_orders_bar_idx ON public.bar_own_orders (bar_id, data DESC);

ALTER TABLE public.bar_own_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bar_own_orders FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bar_own_orders TO authenticated;

DROP POLICY IF EXISTS bar_own_orders_bar ON public.bar_own_orders;
CREATE POLICY bar_own_orders_bar ON public.bar_own_orders FOR ALL TO authenticated
  USING (public.jbm_is_bar_manager_only(bar_id)) WITH CHECK (public.jbm_is_bar_manager_only(bar_id));

-- Rollback:
--   DROP TABLE IF EXISTS public.bar_own_orders;
--   DROP FUNCTION IF EXISTS public.jbm_is_bar_manager_only(uuid);
