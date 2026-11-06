-- JBMTech: the bar's drink queue (the barman's "Bar" screen).
-- Project ojirgkqtqvugqktyuhem.
--
-- Order:   after sql/floor_comandas.sql (uses public.jbm_can_access_bar / jbm_can_manage_bar).
-- Nature:  additive. One new table; no existing table or row is touched. Idempotent.
-- What:    every order sent from the till (a tab's Send, a counter sale) or from a waiter's panel becomes one ticket here.
--          The barman moves it: novo -> pronto (drink finished) -> entregue. Times are kept for the metrics
--          (chegou_em -> pronto_em = how long the drink took).
-- Access:  anyone working at the bar reads, adds and moves tickets; only owner/manager delete.
-- Rollback: DROP TABLE IF EXISTS public.pos_bar_fila;

CREATE TABLE IF NOT EXISTS public.pos_bar_fila (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  idem_key text NOT NULL,
  origem text NOT NULL DEFAULT 'tab' CHECK (origem IN ('tab', 'counter', 'staff')),
  comanda_id uuid,
  label text,
  itens jsonb NOT NULL DEFAULT '[]'::jsonb,
  qtd integer NOT NULL DEFAULT 0,
  pedido_por uuid DEFAULT auth.uid(),
  pedido_por_nome text,
  status text NOT NULL DEFAULT 'novo' CHECK (status IN ('novo', 'preparando', 'pronto', 'entregue', 'cancelado')),
  chegou_em timestamptz NOT NULL DEFAULT now(),
  iniciado_em timestamptz,
  pronto_em timestamptz,
  entregue_em timestamptz,
  feito_por uuid,
  feito_por_nome text,
  UNIQUE (bar_id, idem_key)
);

CREATE INDEX IF NOT EXISTS pos_bar_fila_open ON public.pos_bar_fila (bar_id, chegou_em) WHERE status IN ('novo', 'preparando', 'pronto');
CREATE INDEX IF NOT EXISTS pos_bar_fila_day ON public.pos_bar_fila (bar_id, chegou_em DESC);

ALTER TABLE public.pos_bar_fila ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_bar_fila FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_bar_fila TO authenticated;

DROP POLICY IF EXISTS pos_bar_fila_read ON public.pos_bar_fila;
CREATE POLICY pos_bar_fila_read ON public.pos_bar_fila FOR SELECT TO authenticated
  USING (public.jbm_can_access_bar(bar_id));

DROP POLICY IF EXISTS pos_bar_fila_add ON public.pos_bar_fila;
CREATE POLICY pos_bar_fila_add ON public.pos_bar_fila FOR INSERT TO authenticated
  WITH CHECK (public.jbm_can_access_bar(bar_id));

DROP POLICY IF EXISTS pos_bar_fila_move ON public.pos_bar_fila;
CREATE POLICY pos_bar_fila_move ON public.pos_bar_fila FOR UPDATE TO authenticated
  USING (public.jbm_can_access_bar(bar_id)) WITH CHECK (public.jbm_can_access_bar(bar_id));

DROP POLICY IF EXISTS pos_bar_fila_delete ON public.pos_bar_fila;
CREATE POLICY pos_bar_fila_delete ON public.pos_bar_fila FOR DELETE TO authenticated
  USING (public.jbm_can_manage_bar(bar_id));

-- Live updates on the barman's tablet (the screen also polls, so this is only a speed-up).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pos_bar_fila') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.pos_bar_fila';
  END IF;
END $$;
