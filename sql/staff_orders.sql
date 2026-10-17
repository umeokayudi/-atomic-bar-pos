-- JBMTech: orders / instructions from the owner or manager to each staff member, shown to staff as alerts.
-- Project ojirgkqtqvugqktyuhem. NOT applied by the app or by CI: run it in staging first, then production.
--
-- Order:   independent (re-declares the two bar-access helpers exactly as sql/floor_comandas.sql does).
-- Nature:  additive. CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION. No existing table or row is touched.
-- Access:  managers (cliente/gerente of that bar, or admin/jbm) create, read, update and delete orders of their bar.
--          A staff member reads only the orders addressed to them and can only move their status
--          (sent -> seen -> done); the trigger below refuses any other change from staff.
-- Until this runs, the app falls back to the existing `notificacoes` table (bell), as BarOrdersTab already does.
-- Rollback: see the end of this file.

CREATE OR REPLACE FUNCTION public.jbm_can_access_bar(p_bar uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_bar IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.perfis p
    WHERE p.id = auth.uid()
      AND (p.role IN ('admin', 'jbm')
           OR (p.bar_id = p_bar AND p.role IN ('cliente', 'gerente', 'caixa', 'bar_staff')))
  );
$$;

CREATE OR REPLACE FUNCTION public.jbm_can_manage_bar(p_bar uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_bar IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.perfis p
    WHERE p.id = auth.uid()
      AND (p.role IN ('admin', 'jbm')
           OR (p.bar_id = p_bar AND p.role IN ('cliente', 'gerente')))
  );
$$;

REVOKE ALL ON FUNCTION public.jbm_can_access_bar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jbm_can_manage_bar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.jbm_can_access_bar(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jbm_can_manage_bar(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.staff_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL,
  staff_nome text,
  from_id uuid DEFAULT auth.uid(),
  from_nome text,
  mensagem text NOT NULL CHECK (char_length(mensagem) BETWEEN 1 AND 500),
  prioridade text NOT NULL DEFAULT 'normal' CHECK (prioridade IN ('normal', 'urgent')),
  due_at timestamptz,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'seen', 'done', 'cancelled')),
  seen_at timestamptz,
  done_at timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_orders_bar_idx ON public.staff_orders (bar_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS staff_orders_staff_idx ON public.staff_orders (staff_id, status);

ALTER TABLE public.staff_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_orders FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_orders TO authenticated;

DROP POLICY IF EXISTS staff_orders_manage ON public.staff_orders;
CREATE POLICY staff_orders_manage ON public.staff_orders FOR ALL TO authenticated
  USING (public.jbm_can_manage_bar(bar_id)) WITH CHECK (public.jbm_can_manage_bar(bar_id));

DROP POLICY IF EXISTS staff_orders_mine_read ON public.staff_orders;
CREATE POLICY staff_orders_mine_read ON public.staff_orders FOR SELECT TO authenticated
  USING (staff_id = auth.uid());

DROP POLICY IF EXISTS staff_orders_mine_status ON public.staff_orders;
CREATE POLICY staff_orders_mine_status ON public.staff_orders FOR UPDATE TO authenticated
  USING (staff_id = auth.uid()) WITH CHECK (staff_id = auth.uid());

-- Staff may only change status (and its timestamps); everything else stays as the manager wrote it.
CREATE OR REPLACE FUNCTION public.staff_orders_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.jbm_can_manage_bar(OLD.bar_id) THEN
    RETURN NEW;
  END IF;
  IF NEW.bar_id IS DISTINCT FROM OLD.bar_id OR NEW.staff_id IS DISTINCT FROM OLD.staff_id
     OR NEW.mensagem IS DISTINCT FROM OLD.mensagem OR NEW.prioridade IS DISTINCT FROM OLD.prioridade
     OR NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.from_id IS DISTINCT FROM OLD.from_id
     OR NEW.from_nome IS DISTINCT FROM OLD.from_nome OR NEW.staff_nome IS DISTINCT FROM OLD.staff_nome
     OR NEW.criado_em IS DISTINCT FROM OLD.criado_em THEN
    RAISE EXCEPTION 'staff can only update the status of an order' USING ERRCODE = '42501';
  END IF;
  IF NEW.status NOT IN ('seen', 'done') THEN
    RAISE EXCEPTION 'invalid status' USING ERRCODE = '22023';
  END IF;
  IF NEW.status = 'seen' AND NEW.seen_at IS NULL THEN NEW.seen_at := now(); END IF;
  IF NEW.status = 'done' AND NEW.done_at IS NULL THEN NEW.done_at := now(); END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_orders_guard ON public.staff_orders;
CREATE TRIGGER staff_orders_guard BEFORE UPDATE ON public.staff_orders
  FOR EACH ROW EXECUTE FUNCTION public.staff_orders_guard();

-- Optional: live alerts without waiting for the 20 s poll.
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_orders;

-- ─── rollback ──────────────────────────────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS staff_orders_guard ON public.staff_orders;
-- DROP FUNCTION IF EXISTS public.staff_orders_guard();
-- DROP TABLE IF EXISTS public.staff_orders;
-- (keep jbm_can_access_bar / jbm_can_manage_bar: sql/floor_comandas.sql uses them too)
