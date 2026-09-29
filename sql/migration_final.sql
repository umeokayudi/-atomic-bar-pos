-- Migration designed but not executed.
-- Do not run this file on ojirgkqtqvugqktyuhem or fxsakrshmldmkdmbevna
-- until a human has reviewed it on a disposable database.
--
-- One additive migration. It does not DROP tables, DELETE rows, or backfill history.
-- produtos stays a global catalog. vendas stays the JBM bill.
-- pos_vendas is the bar till.
--
-- Assumes these already exist: bars, perfis, produtos, pedidos, pedidos_itens,
-- vendas, vendas_itens, caixa_movimentos, estoque_movimentos, fornecedores.
--
-- Order:
--   1. identity helper, till tables, bar menu, floor shells, guests, time clock, cash columns
--   2. sql/supplier_fulfillment.sql
--   3. sql/procurement.sql   (replaces the fulfillment copies of is_jbm, supplier_advance, bar_confirm_delivery)
--   4. sql/pos_floor.sql     (without the caixa operational_day UPDATE)
--   5. sql/payroll.sql
--   6. sql/bar_employees.sql (replaces user_can_access_bar with the suspension check)
--   7. sql/pos_ux.sql
--   8. tenant policies for the tables this file creates that the scripts above do not lock
--
-- BLOCKED, and therefore not in this file:
--   - produtos.bar_id
--   - vendas.forma_pagamento, vendas.mesa, vendas.status, vendas.origem
--   - deduct_stock and create_order (they still filter produtos.bar_id)
--   - UPDATE of existing caixa_movimentos.operational_day
--   - ENABLE ROW LEVEL SECURITY on vendas, pedidos, perfis, produtos
--     (production policies were not read; turning RLS on there can lock the live app)
--   - a second time-clock shape with clock_in/clock_out/break columns
--     (the clock API writes one row per punch: tipo in|out, punched_at)
--   - payroll line type "transport" (the ledger has no writer for it)
--   - gross/net columns (payroll stores typed lines; the screen adds them up)

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
          p.role = 'admin'
          OR (
            p.bar_id = target_bar
            AND p.role IN ('cliente', 'gerente', 'caixa', 'bar_staff')
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.user_can_access_bar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_access_bar(uuid) TO authenticated;

-- Till book. Created before any ALTER in the floor script.
CREATE TABLE IF NOT EXISTS public.pos_vendas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  data date NOT NULL,
  subtotal integer NOT NULL DEFAULT 0,
  desconto_total integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  metodo_pagamento text,
  tipo text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  obs text,
  vip_member_id uuid,
  discount_code_id uuid,
  drink_back_agent_id uuid,
  comissao_valor integer NOT NULL DEFAULT 0,
  comissao_estornada integer NOT NULL DEFAULT 0,
  void_status text,
  refunded integer NOT NULL DEFAULT 0,
  card_fee integer NOT NULL DEFAULT 0,
  card_fee_reversed integer NOT NULL DEFAULT 0,
  space_id uuid,
  guest_id uuid,
  visit_id uuid
);

CREATE TABLE IF NOT EXISTS public.pos_vendas_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_venda_id uuid NOT NULL REFERENCES public.pos_vendas(id),
  drink_menu_id uuid,
  produto_id uuid,
  nome text,
  qtd integer NOT NULL CHECK (qtd > 0),
  preco_unitario integer NOT NULL DEFAULT 0,
  preco_lista integer,
  tipo_preco text,
  desconto_valor integer NOT NULL DEFAULT 0,
  for_cast boolean NOT NULL DEFAULT false,
  comissao_valor integer NOT NULL DEFAULT 0,
  refunded_qtd integer NOT NULL DEFAULT 0,
  stock_mode text
);

CREATE INDEX IF NOT EXISTS pos_vendas_bar_data_idx ON public.pos_vendas (bar_id, data);

-- Guest drink name for one bar. The bottle SKU stays on produtos.
CREATE TABLE IF NOT EXISTS public.drink_menu (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  nome text NOT NULL,
  categoria text,
  preco_venda integer,
  custo numeric,
  margem numeric,
  preco_desconto integer,
  custom boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.drink_menu ADD COLUMN IF NOT EXISTS categoria text;
ALTER TABLE public.drink_menu ADD COLUMN IF NOT EXISTS preco_venda integer;
ALTER TABLE public.drink_menu ADD COLUMN IF NOT EXISTS custo numeric;
ALTER TABLE public.drink_menu ADD COLUMN IF NOT EXISTS margem numeric;
ALTER TABLE public.drink_menu ADD COLUMN IF NOT EXISTS preco_desconto integer;
ALTER TABLE public.drink_menu ADD COLUMN IF NOT EXISTS custom boolean DEFAULT false;
ALTER TABLE public.drink_menu ADD COLUMN IF NOT EXISTS ativo boolean DEFAULT true;

-- Per-bar shot price. Not the JBM wholesale price (that is bar_product_prices).
CREATE TABLE IF NOT EXISTS public.bar_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  drinks_por_garrafa integer,
  preco_drink integer,
  UNIQUE (bar_id, produto_id)
);

ALTER TABLE public.bar_pricing ADD COLUMN IF NOT EXISTS drinks_por_garrafa integer;
ALTER TABLE public.bar_pricing ADD COLUMN IF NOT EXISTS preco_drink integer;
-- If the table already existed, CREATE TABLE skipped the UNIQUE clause.
-- This index fails if two rows already share the same bar and product. That is a stop, not a delete.
CREATE UNIQUE INDEX IF NOT EXISTS bar_pricing_bar_produto_uidx
  ON public.bar_pricing (bar_id, produto_id);

CREATE TABLE IF NOT EXISTS public.bar_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  nome text NOT NULL,
  tipo text,
  zona text,
  capacidade integer,
  ordem integer NOT NULL DEFAULT 0,
  notas text,
  ativo boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.bar_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  nome text NOT NULL,
  telefone text,
  line_id text,
  email text,
  aniversario date,
  preferencias text,
  alergias text,
  notas text,
  preferred_host text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  vip_member_id uuid,
  ativo boolean NOT NULL DEFAULT true,
  atualizado_em timestamptz
);

CREATE TABLE IF NOT EXISTS public.bar_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  space_id uuid REFERENCES public.bar_spaces(id),
  guest_id uuid REFERENCES public.bar_guests(id),
  status text NOT NULL DEFAULT 'seated',
  party_size integer,
  inicio timestamptz NOT NULL DEFAULT now(),
  fim timestamptz,
  host_nome text,
  pos_venda_id uuid REFERENCES public.pos_vendas(id),
  criado_por uuid
);

-- One row per punch. tipo in starts a shift. tipo out ends it.
-- Break is not a column: the clock API does not write one.
CREATE TABLE IF NOT EXISTS public.time_clock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  staff_id uuid NOT NULL REFERENCES public.perfis(id),
  tipo text NOT NULL CHECK (tipo IN ('in', 'out')),
  punched_at timestamptz NOT NULL DEFAULT now(),
  lat numeric,
  lng numeric,
  accuracy_m numeric,
  distance_m integer,
  tablet_ok boolean,
  origem text
);

CREATE INDEX IF NOT EXISTS time_clock_staff_idx ON public.time_clock (bar_id, staff_id, punched_at DESC);

CREATE OR REPLACE FUNCTION public.time_clock_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  last_tipo text;
  next_tipo text;
BEGIN
  SELECT t.tipo INTO last_tipo
  FROM public.time_clock t
  WHERE t.staff_id = NEW.staff_id
    AND t.bar_id = NEW.bar_id
    AND t.punched_at <= NEW.punched_at
    AND t.id IS DISTINCT FROM NEW.id
  ORDER BY t.punched_at DESC, t.id DESC
  LIMIT 1;
  SELECT t.tipo INTO next_tipo
  FROM public.time_clock t
  WHERE t.staff_id = NEW.staff_id
    AND t.bar_id = NEW.bar_id
    AND t.punched_at > NEW.punched_at
    AND t.id IS DISTINCT FROM NEW.id
  ORDER BY t.punched_at ASC, t.id ASC
  LIMIT 1;
  IF NEW.tipo = 'in' AND last_tipo = 'in' THEN
    RAISE EXCEPTION 'already clocked in';
  END IF;
  IF NEW.tipo = 'in' AND next_tipo IS NOT NULL THEN
    RAISE EXCEPTION 'overlaps an open shift';
  END IF;
  IF NEW.tipo = 'out' AND last_tipo IS DISTINCT FROM 'in' THEN
    RAISE EXCEPTION 'not clocked in';
  END IF;
  IF NEW.tipo = 'out' AND next_tipo = 'out' THEN
    RAISE EXCEPTION 'overlaps an open shift';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS time_clock_guard ON public.time_clock;
CREATE TRIGGER time_clock_guard
  BEFORE INSERT ON public.time_clock
  FOR EACH ROW
  EXECUTE FUNCTION public.time_clock_guard();

-- Cash columns. Nullable bar_id: JBM cash rows have no bar. No backfill.
ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS bar_id uuid;
ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS referencia_tipo text;
ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS referencia_id uuid;
ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS operational_day date;

ALTER TABLE public.estoque_movimentos ADD COLUMN IF NOT EXISTS bar_id uuid;
ALTER TABLE public.estoque_movimentos ADD COLUMN IF NOT EXISTS criado_por uuid;
ALTER TABLE public.estoque_movimentos ADD COLUMN IF NOT EXISTS obs text;

-- Old commission list. Not a login.
CREATE TABLE IF NOT EXISTS public.cast_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  nome text NOT NULL,
  tipo text NOT NULL DEFAULT 'hostess',
  contrato text NOT NULL DEFAULT 'inhouse',
  turno text,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cast_comissoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cast_id uuid NOT NULL REFERENCES public.cast_members(id),
  venda_id uuid NOT NULL REFERENCES public.vendas(id),
  valor numeric(10,2) NOT NULL,
  data timestamptz NOT NULL DEFAULT now()
);



-- ===== sql/supplier_fulfillment.sql =====

-- Supplier fulfillment for drink orders.
-- Run once in the Supabase SQL editor (drinks project), BEFORE sql/procurement.sql.
-- Do not run this file again after procurement.sql. It would put back the older
-- supplier_advance, bar_confirm_delivery, and fulfillment_alerts policies.
-- Does not create a second bars/products/orders catalog.
-- Existing books stay: pedidos = the bar's drink order, fornecedores = suppliers,
-- produtos = products, pos_vendas = till, vendas/faturas = JBM bill.
-- No USING (true). No service_role grant.

-- ── helpers ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_jbm()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'jbm')
  );
$$;

REVOKE ALL ON FUNCTION public.is_jbm() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_jbm() TO authenticated;

CREATE OR REPLACE FUNCTION public.my_supplier_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT su.supplier_id
  FROM public.supplier_users su
  WHERE su.user_id = auth.uid()
    AND su.active;
$$;

REVOKE ALL ON FUNCTION public.my_supplier_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_supplier_ids() TO authenticated;

-- ── columns on the supplier the HQ already keeps ──────────────────────────

ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS ativo boolean DEFAULT true;
ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS default_lead_time_hours integer;
ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS cutoff_time time;
ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS delivery_days text;

-- ── tables ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.supplier_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'staff',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.supplier_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  supplier_sku text,
  purchase_price numeric,
  minimum_order_quantity integer NOT NULL DEFAULT 1,
  available boolean NOT NULL DEFAULT true,
  lead_time_hours integer,
  priority integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  region text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.supplier_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 100,
  is_primary boolean NOT NULL DEFAULT false,
  is_backup boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  region text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS public.pedido_fulfillment (
  pedido_id uuid PRIMARY KEY REFERENCES public.pedidos(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'submitted',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pedido_fulfillment_status_chk CHECK (status IN (
    'draft','submitted','routing','supplier_pending','supplier_confirmed',
    'in_fulfillment','ready_for_delivery','in_transit','delivered',
    'partially_delivered','completed','cancelled','exception'
  ))
);

CREATE TABLE IF NOT EXISTS public.order_supplier_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.fornecedores(id),
  status text NOT NULL DEFAULT 'pending',
  assigned_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  expected_delivery_at timestamptz,
  delivered_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, supplier_id),
  CONSTRAINT assignment_status_chk CHECK (status IN (
    'pending','accepted','rejected','purchasing','purchased','received',
    'preparing','ready','in_transit','delivered','partial','issue','cancelled'
  ))
);

CREATE TABLE IF NOT EXISTS public.order_supplier_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.order_supplier_assignments(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.pedidos_itens(id) ON DELETE CASCADE,
  quantity_requested integer NOT NULL CHECK (quantity_requested > 0),
  quantity_confirmed integer,
  quantity_purchased integer,
  quantity_delivered integer,
  supplier_purchase_price numeric,
  status text NOT NULL DEFAULT 'pending',
  issue_type text,
  issue_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, order_item_id)
);

CREATE TABLE IF NOT EXISTS public.fulfillment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  assignment_id uuid REFERENCES public.order_supplier_assignments(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_user_id uuid,
  actor_type text NOT NULL,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS fulfillment_events_milestone_uidx
  ON public.fulfillment_events (assignment_id, event_type)
  WHERE assignment_id IS NOT NULL
    AND event_type IN (
      'assigned','accepted','rejected','purchasing','purchased','received',
      'preparing','ready','in_transit','delivered'
    );

CREATE UNIQUE INDEX IF NOT EXISTS fulfillment_events_order_milestone_uidx
  ON public.fulfillment_events (order_id, event_type)
  WHERE assignment_id IS NULL
    AND event_type IN ('submitted','routed','completed','cancelled');

CREATE TABLE IF NOT EXISTS public.delivery_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.pedidos(id) ON DELETE CASCADE,
  assignment_id uuid REFERENCES public.order_supplier_assignments(id) ON DELETE SET NULL,
  confirmed_by uuid,
  status text NOT NULL CHECK (status IN ('received_all','partial','not_received')),
  quantity_expected integer,
  quantity_received integer,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.fornecedores(id),
  assignment_id uuid NOT NULL UNIQUE REFERENCES public.order_supplier_assignments(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  expected_at timestamptz,
  completed_at timestamptz,
  notes text
);

CREATE TABLE IF NOT EXISTS public.fulfillment_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.pedidos(id) ON DELETE CASCADE,
  assignment_id uuid,
  audience text NOT NULL CHECK (audience IN ('jbm','bar','supplier')),
  supplier_id uuid,
  bar_id uuid,
  event_type text NOT NULL,
  title text NOT NULL,
  body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pedidos_status_idx ON public.pedidos (status);
CREATE INDEX IF NOT EXISTS pedidos_bar_created_idx ON public.pedidos (bar_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS osa_supplier_status_idx ON public.order_supplier_assignments (supplier_id, status);
CREATE INDEX IF NOT EXISTS fe_order_idx ON public.fulfillment_events (order_id, created_at);
CREATE INDEX IF NOT EXISTS sp_product_idx ON public.supplier_products (product_id);
CREATE INDEX IF NOT EXISTS sp_supplier_idx ON public.supplier_products (supplier_id);
CREATE INDEX IF NOT EXISTS alerts_audience_idx ON public.fulfillment_alerts (audience, created_at DESC);

-- ── internal writers ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._fulfillment_audit(
  p_action text, p_entity text, p_id uuid, p_meta jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), p_action, p_entity, p_id, COALESCE(p_meta, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public._fulfillment_audit(text, text, uuid, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._fulfillment_alert(
  p_order uuid, p_assignment uuid, p_audience text, p_supplier uuid, p_bar uuid,
  p_type text, p_title text, p_body text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.fulfillment_alerts a
    WHERE a.order_id IS NOT DISTINCT FROM p_order
      AND a.event_type = p_type
      AND a.audience = p_audience
      AND a.created_at > now() - interval '12 hours'
      AND a.read_at IS NULL
  ) THEN
    RETURN;
  END IF;
  INSERT INTO public.fulfillment_alerts (
    order_id, assignment_id, audience, supplier_id, bar_id, event_type, title, body
  ) VALUES (p_order, p_assignment, p_audience, p_supplier, p_bar, p_type, p_title, p_body);
END;
$$;

REVOKE ALL ON FUNCTION public._fulfillment_alert(uuid, uuid, text, uuid, uuid, text, text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._touch_fulfillment(p_order uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.pedido_fulfillment (pedido_id, status)
  VALUES (p_order, p_status)
  ON CONFLICT (pedido_id) DO UPDATE
    SET status = EXCLUDED.status, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public._touch_fulfillment(uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._rollup_order_status(p_order uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  st text;
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.order_supplier_assignments a WHERE a.order_id = p_order)
      THEN 'submitted'
    WHEN EXISTS (SELECT 1 FROM public.order_supplier_assignments a WHERE a.order_id = p_order AND a.status = 'issue')
      THEN 'exception'
    WHEN EXISTS (SELECT 1 FROM public.order_supplier_assignments a WHERE a.order_id = p_order AND a.status = 'rejected')
      AND NOT EXISTS (SELECT 1 FROM public.order_supplier_assignments a WHERE a.order_id = p_order AND a.status NOT IN ('rejected','cancelled'))
      THEN 'exception'
    WHEN NOT EXISTS (
      SELECT 1 FROM public.order_supplier_assignments a
      WHERE a.order_id = p_order AND a.status NOT IN ('delivered','cancelled','rejected')
    ) THEN 'delivered'
    WHEN EXISTS (SELECT 1 FROM public.order_supplier_assignments a WHERE a.order_id = p_order AND a.status IN ('in_transit','partial'))
      THEN 'in_transit'
    WHEN EXISTS (SELECT 1 FROM public.order_supplier_assignments a WHERE a.order_id = p_order AND a.status = 'ready')
      THEN 'ready_for_delivery'
    WHEN EXISTS (SELECT 1 FROM public.order_supplier_assignments a WHERE a.order_id = p_order AND a.status IN ('purchasing','purchased','received','preparing'))
      THEN 'in_fulfillment'
    WHEN EXISTS (SELECT 1 FROM public.order_supplier_assignments a WHERE a.order_id = p_order AND a.status = 'accepted')
      THEN 'supplier_confirmed'
    ELSE 'supplier_pending'
  END INTO st;
  PERFORM public._touch_fulfillment(p_order, st);
  RETURN st;
END;
$$;

REVOKE ALL ON FUNCTION public._rollup_order_status(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fulfillment_next_status(curr text, action text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF action = 'issue' AND curr NOT IN ('delivered','cancelled','rejected') THEN
    RETURN 'issue';
  END IF;
  IF curr = 'pending' AND action = 'accept' THEN RETURN 'accepted'; END IF;
  IF curr = 'pending' AND action = 'reject' THEN RETURN 'rejected'; END IF;
  IF curr = 'issue' AND action = 'accept' THEN RETURN 'accepted'; END IF;
  IF curr = 'accepted' AND action = 'start_purchase' THEN RETURN 'purchasing'; END IF;
  IF curr = 'purchasing' AND action = 'purchased' THEN RETURN 'purchased'; END IF;
  IF curr = 'purchased' AND action = 'received' THEN RETURN 'received'; END IF;
  IF curr = 'received' AND action = 'preparing' THEN RETURN 'preparing'; END IF;
  IF curr = 'preparing' AND action = 'ready' THEN RETURN 'ready'; END IF;
  IF curr = 'ready' AND action = 'in_transit' THEN RETURN 'in_transit'; END IF;
  IF curr = 'in_transit' AND action = 'partial' THEN RETURN 'partial'; END IF;
  IF curr IN ('in_transit','partial') AND action = 'delivered' THEN RETURN 'delivered'; END IF;
  RAISE EXCEPTION 'invalid transition from % via %', curr, action;
END;
$$;

REVOKE ALL ON FUNCTION public.fulfillment_next_status(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fulfillment_next_status(text, text) TO authenticated;

-- ── route one order ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.route_pedido(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ped public.pedidos%ROWTYPE;
  item record;
  pick record;
  asg uuid;
  lead integer;
  routed integer := 0;
  missed integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO ped FROM public.pedidos WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;
  IF NOT (
    public.is_jbm()
    OR public.user_can_access_bar(ped.bar_id)
    OR EXISTS (
      SELECT 1 FROM public.order_supplier_assignments mine
      WHERE mine.order_id = p_order_id
        AND mine.supplier_id IN (SELECT public.my_supplier_ids())
    )
  ) THEN
    RAISE EXCEPTION 'bar not allowed';
  END IF;
  IF ped.status = 'cancelado' THEN
    RAISE EXCEPTION 'order cancelled';
  END IF;

  PERFORM public._touch_fulfillment(p_order_id, 'routing');

  INSERT INTO public.fulfillment_events (order_id, event_type, actor_user_id, actor_type, note)
  VALUES (p_order_id, 'submitted', auth.uid(), 'system', 'Order submitted')
  ON CONFLICT DO NOTHING;

  FOR item IN
    SELECT i.id, i.produto_id, i.qtd
    FROM public.pedidos_itens i
    WHERE i.pedido_id = p_order_id
  LOOP
    IF EXISTS (
      SELECT 1
      FROM public.order_supplier_items osi
      JOIN public.order_supplier_assignments a ON a.id = osi.assignment_id
      WHERE osi.order_item_id = item.id
        AND a.status NOT IN ('rejected','cancelled')
    ) THEN
      routed := routed + 1;
      CONTINUE;
    END IF;

    SELECT r.supplier_id,
           COALESCE(sp.lead_time_hours, f.default_lead_time_hours, 48) AS lead_h,
           sp.purchase_price
      INTO pick
    FROM public.supplier_routing_rules r
    JOIN public.fornecedores f ON f.id = r.supplier_id AND COALESCE(f.ativo, true)
    LEFT JOIN public.supplier_products sp
      ON sp.supplier_id = r.supplier_id
     AND sp.product_id = r.product_id
     AND sp.active
    WHERE r.product_id = item.produto_id
      AND r.active
      AND COALESCE(sp.available, true)
      AND item.qtd >= COALESCE(sp.minimum_order_quantity, 1)
      AND NOT EXISTS (
        SELECT 1 FROM public.order_supplier_assignments prev
        WHERE prev.order_id = p_order_id
          AND prev.supplier_id = r.supplier_id
          AND prev.status IN ('rejected','cancelled')
      )
    ORDER BY r.is_primary DESC,
             r.is_backup ASC,
             r.priority ASC,
             COALESCE(sp.lead_time_hours, f.default_lead_time_hours, 72) ASC,
             COALESCE(sp.purchase_price, 1e12) ASC
    LIMIT 1;

    IF pick.supplier_id IS NULL THEN
      missed := missed + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.order_supplier_assignments (order_id, supplier_id, status, expected_delivery_at)
    VALUES (p_order_id, pick.supplier_id, 'pending', now() + make_interval(hours => pick.lead_h))
    ON CONFLICT (order_id, supplier_id) DO UPDATE
      SET updated_at = now()
    RETURNING id INTO asg;

    INSERT INTO public.order_supplier_items (
      assignment_id, order_item_id, quantity_requested, supplier_purchase_price, status
    ) VALUES (asg, item.id, item.qtd, pick.purchase_price, 'pending')
    ON CONFLICT (assignment_id, order_item_id) DO NOTHING;

    INSERT INTO public.fulfillment_events (order_id, assignment_id, event_type, actor_user_id, actor_type, note, metadata)
    VALUES (
      p_order_id, asg, 'assigned', auth.uid(), 'jbm', 'Sent to supplier',
      jsonb_build_object('supplier_id', pick.supplier_id)
    )
    ON CONFLICT DO NOTHING;

    PERFORM public._fulfillment_alert(
      p_order_id, asg, 'supplier', pick.supplier_id, ped.bar_id,
      'supplier_order_created', 'New order', 'A bar order was routed to you.'
    );
    routed := routed + 1;
  END LOOP;

  IF missed > 0 AND routed = 0 THEN
    PERFORM public._touch_fulfillment(p_order_id, 'exception');
    PERFORM public._fulfillment_alert(
      p_order_id, NULL, 'jbm', NULL, ped.bar_id,
      'order_exception', 'No supplier', 'No active supplier can take this order.'
    );
  ELSE
    PERFORM public._rollup_order_status(p_order_id);
  END IF;

  IF routed > 0 AND ped.status = 'pendente' THEN
    UPDATE public.pedidos SET status = 'confirmado' WHERE id = p_order_id;
  END IF;

  PERFORM public._fulfillment_audit('route_pedido', 'pedidos', p_order_id,
    jsonb_build_object('routed', routed, 'missed', missed));

  RETURN jsonb_build_object('order_id', p_order_id, 'routed', routed, 'missed', missed);
END;
$$;

REVOKE ALL ON FUNCTION public.route_pedido(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.route_pedido(uuid) TO authenticated;

-- ── supplier step ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.supplier_advance(
  p_assignment_id uuid,
  p_action text,
  p_note text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  asg public.order_supplier_assignments%ROWTYPE;
  nxt text;
  ev text;
  line jsonb;
  item_id uuid;
  qty integer;
  ped_bar uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO asg FROM public.order_supplier_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment not found';
  END IF;
  IF NOT (public.is_jbm() OR asg.supplier_id IN (SELECT public.my_supplier_ids())) THEN
    RAISE EXCEPTION 'supplier not allowed';
  END IF;

  nxt := public.fulfillment_next_status(asg.status, p_action);
  ev := CASE p_action
    WHEN 'accept' THEN 'accepted'
    WHEN 'reject' THEN 'rejected'
    WHEN 'start_purchase' THEN 'purchasing'
    WHEN 'purchased' THEN 'purchased'
    WHEN 'received' THEN 'received'
    WHEN 'preparing' THEN 'preparing'
    WHEN 'ready' THEN 'ready'
    WHEN 'in_transit' THEN 'in_transit'
    WHEN 'partial' THEN 'partial'
    WHEN 'delivered' THEN 'delivered'
    ELSE 'issue'
  END;

  UPDATE public.order_supplier_assignments
  SET status = nxt,
      updated_at = now(),
      confirmed_at = CASE WHEN p_action = 'accept' THEN now() ELSE confirmed_at END,
      delivered_at = CASE WHEN p_action = 'delivered' THEN now() ELSE delivered_at END,
      expected_delivery_at = COALESCE(
        NULLIF(p_payload->>'expected_delivery_at','')::timestamptz,
        expected_delivery_at
      ),
      notes = COALESCE(p_note, notes)
  WHERE id = asg.id;

  IF p_action = 'start_purchase' THEN
    INSERT INTO public.supplier_purchase_requests (supplier_id, assignment_id, status, expected_at, notes)
    VALUES (asg.supplier_id, asg.id, 'open', asg.expected_delivery_at, p_note)
    ON CONFLICT (assignment_id) DO NOTHING;
  ELSIF p_action = 'purchased' THEN
    UPDATE public.supplier_purchase_requests
    SET status = 'purchased', completed_at = now(), notes = COALESCE(p_note, notes)
    WHERE assignment_id = asg.id;
  END IF;

  IF p_payload ? 'lines' THEN
    FOR line IN SELECT * FROM jsonb_array_elements(p_payload->'lines')
    LOOP
      item_id := NULLIF(line->>'order_item_id','')::uuid;
      qty := NULLIF(line->>'quantity','')::integer;
      UPDATE public.order_supplier_items
      SET quantity_confirmed = CASE WHEN p_action IN ('accept','issue') THEN COALESCE(qty, quantity_confirmed) ELSE quantity_confirmed END,
          quantity_purchased = CASE WHEN p_action = 'purchased' THEN COALESCE(qty, quantity_requested) ELSE quantity_purchased END,
          quantity_delivered = CASE WHEN p_action IN ('delivered','partial') THEN COALESCE(qty, quantity_requested) ELSE quantity_delivered END,
          issue_type = COALESCE(line->>'issue_type', issue_type),
          issue_note = COALESCE(line->>'issue_note', issue_note),
          status = nxt,
          updated_at = now()
      WHERE assignment_id = asg.id
        AND (item_id IS NULL OR order_item_id = item_id);
      PERFORM public._fulfillment_audit(
        'quantity_confirmed', 'order_supplier_items', asg.id,
        jsonb_build_object('order_item_id', item_id, 'quantity', qty, 'action', p_action)
      );
    END LOOP;
  ELSIF p_action = 'accept' THEN
    UPDATE public.order_supplier_items
    SET quantity_confirmed = quantity_requested, status = 'accepted', updated_at = now()
    WHERE assignment_id = asg.id AND quantity_confirmed IS NULL;
  END IF;

  INSERT INTO public.fulfillment_events (order_id, assignment_id, event_type, actor_user_id, actor_type, note, metadata)
  VALUES (asg.order_id, asg.id, ev, auth.uid(), CASE WHEN public.is_jbm() THEN 'jbm' ELSE 'supplier' END, p_note, COALESCE(p_payload, '{}'::jsonb) - 'lines')
  ON CONFLICT DO NOTHING;

  IF p_action = 'reject' THEN
    PERFORM public.route_pedido(asg.order_id);
    IF NOT EXISTS (
      SELECT 1 FROM public.order_supplier_assignments a
      WHERE a.order_id = asg.order_id AND a.status NOT IN ('rejected','cancelled')
    ) THEN
      PERFORM public._touch_fulfillment(asg.order_id, 'exception');
      SELECT bar_id INTO ped_bar FROM public.pedidos WHERE id = asg.order_id;
      PERFORM public._fulfillment_alert(asg.order_id, asg.id, 'jbm', NULL, ped_bar,
        'order_exception', 'Backup also refused', 'No supplier accepted this order.');
    END IF;
  ELSE
    PERFORM public._rollup_order_status(asg.order_id);
  END IF;

  IF p_action = 'issue' THEN
    SELECT bar_id INTO ped_bar FROM public.pedidos WHERE id = asg.order_id;
    PERFORM public._fulfillment_alert(asg.order_id, asg.id, 'jbm', asg.supplier_id, ped_bar,
      'supplier_issue', 'Supplier issue', COALESCE(p_note, 'The supplier reported a problem.'));
  ELSIF p_action = 'in_transit' THEN
    SELECT bar_id INTO ped_bar FROM public.pedidos WHERE id = asg.order_id;
    PERFORM public._fulfillment_alert(asg.order_id, asg.id, 'bar', NULL, ped_bar,
      'order_in_transit', 'On the way', 'Your drink order is in transit.');
  ELSIF p_action = 'delivered' THEN
    SELECT bar_id INTO ped_bar FROM public.pedidos WHERE id = asg.order_id;
    PERFORM public._fulfillment_alert(asg.order_id, asg.id, 'bar', NULL, ped_bar,
      'order_delivered', 'Delivered', 'Confirm what you received.');
  END IF;

  PERFORM public._fulfillment_audit('supplier_advance', 'order_supplier_assignments', asg.id,
    jsonb_build_object('from', asg.status, 'to', nxt, 'action', p_action));

  RETURN jsonb_build_object('assignment_id', asg.id, 'status', nxt);
END;
$$;

REVOKE ALL ON FUNCTION public.supplier_advance(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.supplier_advance(uuid, text, text, jsonb) TO authenticated;

-- ── bar confirms receipt. Stock moves only here. ──────────────────────────

CREATE OR REPLACE FUNCTION public.bar_confirm_delivery(
  p_order_id uuid,
  p_status text,
  p_received integer DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ped public.pedidos%ROWTYPE;
  expected integer;
  got integer;
  obs text;
  ff text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_status NOT IN ('received_all','partial','not_received') THEN
    RAISE EXCEPTION 'invalid confirmation';
  END IF;

  SELECT * INTO ped FROM public.pedidos WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;
  IF NOT public.user_can_access_bar(ped.bar_id) AND NOT public.is_jbm() THEN
    RAISE EXCEPTION 'bar not allowed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.delivery_confirmations d WHERE d.order_id = p_order_id) THEN
    RAISE EXCEPTION 'delivery already confirmed';
  END IF;

  SELECT COALESCE(SUM(i.qtd), 0) INTO expected
  FROM public.pedidos_itens i WHERE i.pedido_id = p_order_id;

  got := CASE p_status
    WHEN 'received_all' THEN expected
    WHEN 'not_received' THEN 0
    ELSE COALESCE(p_received, 0)
  END;

  INSERT INTO public.delivery_confirmations (
    order_id, confirmed_by, status, quantity_expected, quantity_received, note
  ) VALUES (p_order_id, auth.uid(), p_status, expected, got, p_note);

  obs := 'JBM delivery ' || left(p_order_id::text, 8);
  IF p_status = 'received_all' AND NOT EXISTS (
    SELECT 1 FROM public.estoque_movimentos m
    WHERE m.bar_id = ped.bar_id AND m.obs = obs
  ) THEN
    INSERT INTO public.estoque_movimentos (produto_id, bar_id, tipo, qtd, criado_por, obs)
    SELECT i.produto_id, ped.bar_id, 'entrada', i.qtd, auth.uid(), obs
    FROM public.pedidos_itens i
    WHERE i.pedido_id = p_order_id AND i.produto_id IS NOT NULL AND i.qtd > 0;
  END IF;

  IF p_status = 'received_all' THEN
    ff := 'completed';
    UPDATE public.pedidos SET status = 'entregue' WHERE id = p_order_id;
  ELSIF p_status = 'partial' THEN
    ff := 'partially_delivered';
    PERFORM public._fulfillment_alert(p_order_id, NULL, 'jbm', NULL, ped.bar_id,
      'order_exception', 'Partial receipt', COALESCE(p_note, 'The bar received less than ordered.'));
  ELSE
    ff := 'exception';
    PERFORM public._fulfillment_alert(p_order_id, NULL, 'jbm', NULL, ped.bar_id,
      'order_exception', 'Not received', COALESCE(p_note, 'The bar did not receive the order.'));
  END IF;

  PERFORM public._touch_fulfillment(p_order_id, ff);
  INSERT INTO public.fulfillment_events (order_id, event_type, actor_user_id, actor_type, note, metadata)
  VALUES (p_order_id, 'bar_confirmed', auth.uid(), 'bar', p_note,
    jsonb_build_object('status', p_status, 'expected', expected, 'received', got));

  PERFORM public._fulfillment_alert(p_order_id, NULL, 'jbm', NULL, ped.bar_id,
    'bar_delivery_confirmed', 'Bar confirmed', p_status);
  PERFORM public._fulfillment_audit('bar_confirm_delivery', 'pedidos', p_order_id,
    jsonb_build_object('status', p_status, 'expected', expected, 'received', got));

  RETURN jsonb_build_object('order_id', p_order_id, 'status', ff, 'received', got, 'expected', expected);
END;
$$;

REVOKE ALL ON FUNCTION public.bar_confirm_delivery(uuid, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bar_confirm_delivery(uuid, text, integer, text) TO authenticated;

-- ── tracking payload. Bar never sees purchase price or supplier name. ─────

CREATE OR REPLACE FUNCTION public.get_order_tracking(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ped public.pedidos%ROWTYPE;
  audience text;
  mine uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO ped FROM public.pedidos WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;

  IF public.is_jbm() THEN
    audience := 'jbm';
  ELSIF public.user_can_access_bar(ped.bar_id) THEN
    audience := 'bar';
  ELSIF EXISTS (
    SELECT 1 FROM public.order_supplier_assignments a
    WHERE a.order_id = p_order_id AND a.supplier_id IN (SELECT public.my_supplier_ids())
  ) THEN
    audience := 'supplier';
  ELSE
    RAISE EXCEPTION 'not allowed';
  END IF;

  SELECT supplier_id INTO mine
  FROM public.order_supplier_assignments
  WHERE order_id = p_order_id AND supplier_id IN (SELECT public.my_supplier_ids())
  LIMIT 1;

  RETURN jsonb_build_object(
    'order_id', ped.id,
    'bar_id', CASE WHEN audience = 'supplier' THEN NULL ELSE ped.bar_id END,
    'status', COALESCE((SELECT f.status FROM public.pedido_fulfillment f WHERE f.pedido_id = ped.id), 'submitted'),
    'legacy_status', ped.status,
    'total', CASE WHEN audience = 'supplier' THEN NULL ELSE ped.total_estimado END,
    'requested_delivery', ped.data_entrega_prevista,
    'audience', audience,
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id,
        'event_type', e.event_type,
        'note', CASE WHEN audience = 'bar' THEN NULL ELSE e.note END,
        'created_at', e.created_at,
        'actor_type', e.actor_type
      ) ORDER BY e.created_at)
      FROM public.fulfillment_events e
      WHERE e.order_id = ped.id
        AND (audience <> 'supplier' OR e.assignment_id IS NULL OR e.assignment_id IN (
          SELECT a.id FROM public.order_supplier_assignments a
          WHERE a.order_id = ped.id AND a.supplier_id = mine
        ))
    ), '[]'::jsonb),
    'assignments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id,
        'status', a.status,
        'expected_delivery_at', a.expected_delivery_at,
        'supplier_name', CASE WHEN audience = 'bar' THEN NULL ELSE f.nome END,
        'items', (
          SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'order_item_id', osi.order_item_id,
            'product', pr.nome,
            'quantity_requested', osi.quantity_requested,
            'quantity_confirmed', osi.quantity_confirmed,
            'quantity_delivered', osi.quantity_delivered,
            'issue_type', osi.issue_type,
            'issue_note', osi.issue_note,
            'purchase_price', CASE WHEN audience = 'jbm' THEN osi.supplier_purchase_price ELSE NULL END
          )), '[]'::jsonb)
          FROM public.order_supplier_items osi
          JOIN public.pedidos_itens pi ON pi.id = osi.order_item_id
          LEFT JOIN public.produtos pr ON pr.id = pi.produto_id
          WHERE osi.assignment_id = a.id
        )
      ))
      FROM public.order_supplier_assignments a
      JOIN public.fornecedores f ON f.id = a.supplier_id
      WHERE a.order_id = ped.id
        AND (audience <> 'supplier' OR a.supplier_id = mine)
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_order_tracking(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_order_tracking(uuid) TO authenticated;

-- Alerts only. Does not cancel or reassign by itself.
CREATE OR REPLACE FUNCTION public.scan_fulfillment_alerts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n integer := 0;
  rec record;
BEGIN
  IF NOT public.is_jbm() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  FOR rec IN
    SELECT a.id, a.order_id, a.supplier_id, p.bar_id
    FROM public.order_supplier_assignments a
    JOIN public.pedidos p ON p.id = a.order_id
    WHERE a.status = 'pending'
      AND a.assigned_at < now() - interval '12 hours'
  LOOP
    PERFORM public._fulfillment_alert(rec.order_id, rec.id, 'jbm', rec.supplier_id, rec.bar_id,
      'supplier_delay', 'Supplier has not confirmed', 'Still pending after 12 hours.');
    n := n + 1;
  END LOOP;

  FOR rec IN
    SELECT a.id, a.order_id, a.supplier_id, p.bar_id
    FROM public.order_supplier_assignments a
    JOIN public.pedidos p ON p.id = a.order_id
    WHERE a.status NOT IN ('delivered','rejected','cancelled')
      AND a.expected_delivery_at IS NOT NULL
      AND a.expected_delivery_at < now()
  LOOP
    PERFORM public._fulfillment_alert(rec.order_id, rec.id, 'jbm', rec.supplier_id, rec.bar_id,
      'supplier_delay', 'Delivery is late', 'Expected time has passed.');
    n := n + 1;
  END LOOP;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.scan_fulfillment_alerts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scan_fulfillment_alerts() TO authenticated;

-- ── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.supplier_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_fulfillment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_supplier_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_supplier_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fulfillment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_purchase_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fulfillment_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_users_jbm ON public.supplier_users;
CREATE POLICY supplier_users_jbm ON public.supplier_users
  FOR ALL TO authenticated
  USING (public.is_jbm()) WITH CHECK (public.is_jbm());

DROP POLICY IF EXISTS supplier_users_self ON public.supplier_users;
CREATE POLICY supplier_users_self ON public.supplier_users
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS supplier_products_jbm ON public.supplier_products;
CREATE POLICY supplier_products_jbm ON public.supplier_products
  FOR ALL TO authenticated
  USING (public.is_jbm()) WITH CHECK (public.is_jbm());

DROP POLICY IF EXISTS supplier_products_self ON public.supplier_products;
CREATE POLICY supplier_products_self ON public.supplier_products
  FOR SELECT TO authenticated
  USING (supplier_id IN (SELECT public.my_supplier_ids()));

DROP POLICY IF EXISTS routing_jbm ON public.supplier_routing_rules;
CREATE POLICY routing_jbm ON public.supplier_routing_rules
  FOR ALL TO authenticated
  USING (public.is_jbm()) WITH CHECK (public.is_jbm());

DROP POLICY IF EXISTS ff_jbm ON public.pedido_fulfillment;
CREATE POLICY ff_jbm ON public.pedido_fulfillment
  FOR SELECT TO authenticated
  USING (
    public.is_jbm()
    OR EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE p.id = pedido_id AND public.user_can_access_bar(p.bar_id)
    )
  );

DROP POLICY IF EXISTS asg_read ON public.order_supplier_assignments;
CREATE POLICY asg_read ON public.order_supplier_assignments
  FOR SELECT TO authenticated
  USING (
    public.is_jbm()
    OR supplier_id IN (SELECT public.my_supplier_ids())
  );

DROP POLICY IF EXISTS items_read ON public.order_supplier_items;
CREATE POLICY items_read ON public.order_supplier_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.order_supplier_assignments a
      WHERE a.id = assignment_id
        AND (public.is_jbm() OR a.supplier_id IN (SELECT public.my_supplier_ids()))
    )
  );

DROP POLICY IF EXISTS events_read ON public.fulfillment_events;
CREATE POLICY events_read ON public.fulfillment_events
  FOR SELECT TO authenticated
  USING (
    public.is_jbm()
    OR (
      assignment_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.order_supplier_assignments a
        WHERE a.id = assignment_id AND a.supplier_id IN (SELECT public.my_supplier_ids())
      )
    )
  );

DROP POLICY IF EXISTS confirm_read ON public.delivery_confirmations;
CREATE POLICY confirm_read ON public.delivery_confirmations
  FOR SELECT TO authenticated
  USING (
    public.is_jbm()
    OR EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE p.id = order_id AND public.user_can_access_bar(p.bar_id)
    )
  );

DROP POLICY IF EXISTS purchase_read ON public.supplier_purchase_requests;
CREATE POLICY purchase_read ON public.supplier_purchase_requests
  FOR SELECT TO authenticated
  USING (public.is_jbm() OR supplier_id IN (SELECT public.my_supplier_ids()));

DROP POLICY IF EXISTS alerts_read ON public.fulfillment_alerts;
CREATE POLICY alerts_read ON public.fulfillment_alerts
  FOR SELECT TO authenticated
  USING (
    (audience = 'jbm' AND public.is_jbm())
    OR (audience = 'supplier' AND supplier_id IN (SELECT public.my_supplier_ids()))
    OR (audience = 'bar' AND bar_id IS NOT NULL AND public.user_can_access_bar(bar_id))
  );

DROP POLICY IF EXISTS alerts_read_update ON public.fulfillment_alerts;
CREATE POLICY alerts_read_update ON public.fulfillment_alerts
  FOR UPDATE TO authenticated
  USING (
    (audience = 'jbm' AND public.is_jbm())
    OR (audience = 'supplier' AND supplier_id IN (SELECT public.my_supplier_ids()))
    OR (audience = 'bar' AND bar_id IS NOT NULL AND public.user_can_access_bar(bar_id))
  )
  WITH CHECK (
    (audience = 'jbm' AND public.is_jbm())
    OR (audience = 'supplier' AND supplier_id IN (SELECT public.my_supplier_ids()))
    OR (audience = 'bar' AND bar_id IS NOT NULL AND public.user_can_access_bar(bar_id))
  );

DROP POLICY IF EXISTS audit_jbm ON public.audit_logs;
CREATE POLICY audit_jbm ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_jbm());


-- ===== sql/procurement.sql =====

-- Procurement on top of the drink order that already exists.
-- Run in the Supabase SQL editor AFTER sql/supplier_fulfillment.sql
-- and sql/pos_sale_security.sql (user_can_access_bar).
-- Does not create a second bars, produtos or pedidos catalog.
-- Does not replace supplier portal tables. Supplier sources are mirrored
-- into order_supplier_assignments so the portal keeps working.
-- Policies name the role they allow. No grant of the service role. This file does not insert products,
-- orders, suppliers or sample prices.

-- ── access ────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_procurement_hq()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'jbm')
  );
$$;

REVOKE ALL ON FUNCTION public.is_procurement_hq() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_procurement_hq() TO authenticated;

-- Same gate as HQ. Employee (funcionario) is not JBM: they use their own tasks.
-- Re-declared here so a later run of this file wins over supplier_fulfillment.sql.
CREATE OR REPLACE FUNCTION public.is_jbm()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.perfis p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'jbm')
  );
$$;

REVOKE ALL ON FUNCTION public.is_jbm() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_jbm() TO authenticated;

-- ── human codes. UUID stays the primary key. ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.ops_counters (
  kind text NOT NULL,
  year integer NOT NULL,
  n integer NOT NULL,
  PRIMARY KEY (kind, year)
);

CREATE OR REPLACE FUNCTION public.next_ops_code(p_kind text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  y integer;
  n integer;
BEGIN
  IF p_kind NOT IN ('BAR', 'BUY', 'PUR', 'DEL', 'SUP') THEN
    RAISE EXCEPTION 'invalid code kind';
  END IF;
  y := EXTRACT(YEAR FROM timezone('Asia/Tokyo', now()))::integer;
  INSERT INTO public.ops_counters (kind, year, n)
  VALUES (p_kind, y, 1)
  ON CONFLICT (kind, year) DO UPDATE
    SET n = public.ops_counters.n + 1
  RETURNING public.ops_counters.n INTO n;
  RETURN p_kind || '-' || y::text || '-' || lpad(n::text, 5, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_ops_code(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.parse_iso_days(p_text text)
RETURNS integer[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_text IS NULL OR btrim(p_text) = '' THEN NULL
    ELSE (
      SELECT array_agg(v::integer)
      FROM regexp_split_to_table(p_text, '[^0-9]+') AS t(v)
      WHERE v ~ '^[1-7]$'
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.parse_iso_days(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parse_iso_days(text) TO authenticated;

-- Last safe instants, walked backward from the bar's requested time.
-- Hours come from the caller (settings + source). Tokyo, no DST.
CREATE OR REPLACE FUNCTION public.procurement_deadlines(
  p_need timestamptz,
  p_transport numeric,
  p_warehouse numeric,
  p_prep numeric,
  p_lead numeric,
  p_buffer numeric,
  p_cutoff time,
  p_days integer[],
  p_closures date[]
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  deliver_by timestamptz;
  depart_by timestamptz;
  consolidate_by timestamptz;
  ready_by timestamptz;
  buy_by timestamptz;
  guard integer := 0;
  local_ts timestamp;
  dow integer;
  cutoff time;
BEGIN
  IF p_need IS NULL THEN
    RETURN jsonb_build_object('buy_by', NULL);
  END IF;
  cutoff := COALESCE(p_cutoff, time '23:59');
  deliver_by := p_need - (COALESCE(p_buffer, 0) * interval '1 hour');
  depart_by := deliver_by - (COALESCE(p_transport, 0) * interval '1 hour');
  consolidate_by := depart_by - (COALESCE(p_warehouse, 0) * interval '1 hour');
  ready_by := consolidate_by - (COALESCE(p_prep, 0) * interval '1 hour');
  buy_by := ready_by - (COALESCE(p_lead, 0) * interval '1 hour');

  LOOP
    guard := guard + 1;
    EXIT WHEN guard > 21;
    local_ts := buy_by AT TIME ZONE 'Asia/Tokyo';
    dow := EXTRACT(ISODOW FROM local_ts)::integer;
    IF (
      (p_days IS NOT NULL AND cardinality(p_days) > 0 AND NOT (dow = ANY (p_days)))
      OR (p_closures IS NOT NULL AND local_ts::date = ANY (p_closures))
    ) THEN
      buy_by := ((local_ts::date - 1) + cutoff) AT TIME ZONE 'Asia/Tokyo';
      CONTINUE;
    END IF;
    IF local_ts::time > cutoff THEN
      buy_by := (local_ts::date + cutoff) AT TIME ZONE 'Asia/Tokyo';
      CONTINUE;
    END IF;
    EXIT;
  END LOOP;

  RETURN jsonb_build_object(
    'deliver_by', deliver_by,
    'depart_by', depart_by,
    'consolidate_by', consolidate_by,
    'ready_by', ready_by,
    'buy_by', buy_by
  );
END;
$$;

REVOKE ALL ON FUNCTION public.procurement_deadlines(timestamptz, numeric, numeric, numeric, numeric, numeric, time, integer[], date[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.procurement_deadlines(timestamptz, numeric, numeric, numeric, numeric, numeric, time, integer[], date[]) TO authenticated;

-- ── settings and places ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.procurement_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  safety_buffer_hours numeric NOT NULL DEFAULT 0,
  default_transport_hours numeric NOT NULL DEFAULT 0,
  default_warehouse_hours numeric NOT NULL DEFAULT 0,
  default_prep_hours numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.procurement_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ops_closures (
  on_date date PRIMARY KEY,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.procurement_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN (
    'SUPPLIER', 'ONLINE', 'PHYSICAL_STORE', 'EMPLOYEE', 'PARTNER', 'WAREHOUSE', 'DIRECT'
  )),
  company_name text,
  active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  default_lead_time_hours integer,
  cutoff_time time,
  delivery_days text,
  address text,
  purchase_url text,
  contact text,
  notes text,
  default_assignee uuid,
  fornecedor_id uuid UNIQUE REFERENCES public.fornecedores(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.procurement_source_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.procurement_sources(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  source_sku text,
  purchase_price numeric,
  minimum_quantity integer NOT NULL DEFAULT 1,
  available_qty integer,
  available boolean NOT NULL DEFAULT true,
  lead_time_hours integer,
  priority integer NOT NULL DEFAULT 100,
  purchase_url text,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.procurement_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.procurement_sources(id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 100,
  is_primary boolean NOT NULL DEFAULT false,
  is_backup boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  region text,
  destination_bar_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, source_id)
);

CREATE TABLE IF NOT EXISTS public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('BAR', 'WAREHOUSE', 'SUPPLIER', 'STORE', 'OTHER')),
  bar_id uuid,
  source_id uuid REFERENCES public.procurement_sources(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS locations_one_bar_idx
  ON public.locations (bar_id)
  WHERE type = 'BAR' AND bar_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.procurement_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_number text NOT NULL UNIQUE,
  order_id uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  order_item_id uuid NOT NULL REFERENCES public.pedidos_itens(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.procurement_sources(id),
  product_id uuid REFERENCES public.produtos(id),
  assignment_id uuid REFERENCES public.order_supplier_assignments(id) ON DELETE SET NULL,
  quantity_requested integer NOT NULL CHECK (quantity_requested > 0),
  quantity_allocated integer NOT NULL CHECK (quantity_allocated > 0),
  quantity_purchased integer NOT NULL DEFAULT 0,
  quantity_received integer NOT NULL DEFAULT 0,
  quantity_at_bar integer NOT NULL DEFAULT 0,
  procurement_method text,
  source_company text,
  purchase_url text,
  expected_unit_cost numeric,
  actual_unit_cost numeric,
  estimated_total_cost numeric,
  actual_total_cost numeric,
  requested_delivery_at timestamptz,
  buy_by_at timestamptz,
  depart_by_at timestamptz,
  assigned_to uuid,
  status text NOT NULL DEFAULT 'assigned',
  priority integer NOT NULL DEFAULT 100,
  notes text,
  proof_note text,
  external_reference text,
  late boolean NOT NULL DEFAULT false,
  destination_location_id uuid REFERENCES public.locations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT procurement_task_status_chk CHECK (status IN (
    'draft', 'planned', 'assigned', 'waiting_purchase', 'purchasing', 'purchased',
    'in_transit', 'received', 'partially_received', 'completed', 'cancelled', 'exception'
  ))
);

CREATE INDEX IF NOT EXISTS procurement_tasks_order_idx ON public.procurement_tasks (order_id, status);
CREATE INDEX IF NOT EXISTS procurement_tasks_assignee_idx ON public.procurement_tasks (assigned_to, status);
CREATE INDEX IF NOT EXISTS procurement_tasks_source_idx ON public.procurement_tasks (source_id, status);

DO $$
BEGIN
  ALTER TABLE public.procurement_tasks DROP CONSTRAINT IF EXISTS procurement_tasks_qty_chk;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'procurement_tasks_qty_chk'
  ) THEN
    ALTER TABLE public.procurement_tasks
      ADD CONSTRAINT procurement_tasks_qty_chk CHECK (
        quantity_purchased >= 0
        AND quantity_received >= 0
        AND quantity_at_bar >= 0
        AND quantity_allocated <= quantity_requested
        AND quantity_purchased <= quantity_allocated
        AND quantity_received <= quantity_purchased
        AND quantity_at_bar <= quantity_received
        AND (status <> 'purchased' OR quantity_purchased >= quantity_allocated)
        AND (status <> 'in_transit' OR quantity_purchased > 0)
        AND (status <> 'received' OR quantity_received > 0)
        AND (status <> 'partially_received' OR (quantity_received > 0 AND quantity_received < quantity_allocated))
        AND (status <> 'completed' OR quantity_at_bar >= quantity_allocated)
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.purchase_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code text NOT NULL UNIQUE,
  source_id uuid REFERENCES public.procurement_sources(id),
  buyer_user_id uuid,
  purchased_at timestamptz NOT NULL,
  freight numeric NOT NULL DEFAULT 0,
  fees numeric NOT NULL DEFAULT 0,
  external_reference text,
  receipt_note text,
  payment_method text,
  notes text,
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('draft', 'recorded')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES public.purchase_transactions(id) ON DELETE CASCADE,
  procurement_task_id uuid NOT NULL REFERENCES public.procurement_tasks(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.produtos(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_cost numeric NOT NULL CHECK (unit_cost > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code text NOT NULL UNIQUE,
  order_id uuid REFERENCES public.pedidos(id) ON DELETE CASCADE,
  from_location_id uuid REFERENCES public.locations(id),
  to_location_id uuid REFERENCES public.locations(id),
  responsible_user_id uuid,
  carrier text,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN (
    'planned', 'in_transit', 'delivered', 'partial', 'exception', 'cancelled'
  )),
  expected_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  tracking_ref text,
  notes text,
  logistics_cost numeric NOT NULL DEFAULT 0,
  bar_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.shipment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  procurement_task_id uuid NOT NULL REFERENCES public.procurement_tasks(id) ON DELETE CASCADE,
  quantity integer NOT NULL CHECK (quantity > 0),
  quantity_confirmed integer,
  UNIQUE (shipment_id, procurement_task_id)
);

-- Warehouse balance is the sum of these rows. Bar stock stays in estoque_movimentos.
CREATE TABLE IF NOT EXISTS public.procurement_stock_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id),
  procurement_task_id uuid NOT NULL REFERENCES public.procurement_tasks(id),
  product_id uuid REFERENCES public.produtos(id),
  shipment_id uuid REFERENCES public.shipments(id),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  quantity integer NOT NULL CHECK (quantity > 0),
  reason text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS procurement_stock_moves_loc_idx
  ON public.procurement_stock_moves (location_id, created_at);
CREATE INDEX IF NOT EXISTS procurement_stock_moves_task_idx
  ON public.procurement_stock_moves (procurement_task_id);

CREATE TABLE IF NOT EXISTS public.bar_product_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  sale_price numeric NOT NULL,
  minimum_quantity integer NOT NULL DEFAULT 1 CHECK (minimum_quantity > 0),
  valid_from timestamptz,
  valid_until timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bar_product_prices_uidx
  ON public.bar_product_prices (bar_id, product_id, minimum_quantity, COALESCE(valid_from, 'epoch'::timestamptz));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bar_product_prices_positive'
  ) THEN
    ALTER TABLE public.bar_product_prices
      ADD CONSTRAINT bar_product_prices_positive CHECK (sale_price > 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.replenishment_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  minimum_stock numeric,
  target_stock numeric,
  reorder_point numeric,
  safety_stock numeric,
  preferred_source_id uuid REFERENCES public.procurement_sources(id),
  lead_time_hours integer,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bar_id, product_id)
);

ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS public_code text;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS entrega_desejada timestamptz;

CREATE TABLE IF NOT EXISTS public.order_idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL,
  user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  order_id uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bar_id, user_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS pedidos_public_code_uidx
  ON public.pedidos (public_code) WHERE public_code IS NOT NULL;

ALTER TABLE public.supplier_purchase_requests ADD COLUMN IF NOT EXISTS public_code text;
ALTER TABLE public.fulfillment_alerts ADD COLUMN IF NOT EXISTS assignee_user_id uuid;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'fulfillment_alerts'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%audience%'
  LOOP
    EXECUTE format('ALTER TABLE public.fulfillment_alerts DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.fulfillment_alerts
  ADD CONSTRAINT fulfillment_alerts_audience_chk
  CHECK (audience IN ('jbm', 'bar', 'supplier', 'employee'));

-- ── copy the supplier catalog into generic sources. No new products. ──────

CREATE OR REPLACE FUNCTION public.sync_supplier_procurement()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.procurement_sources (
    name, type, company_name, active, priority, default_lead_time_hours,
    cutoff_time, delivery_days, contact, fornecedor_id
  )
  SELECT f.nome, 'SUPPLIER', f.nome, COALESCE(f.ativo, true), 100,
         f.default_lead_time_hours, f.cutoff_time, f.delivery_days, f.email, f.id
  FROM public.fornecedores f
  WHERE NOT EXISTS (
    SELECT 1 FROM public.procurement_sources s WHERE s.fornecedor_id = f.id
  );

  INSERT INTO public.procurement_source_products (
    source_id, product_id, source_sku, purchase_price, minimum_quantity,
    available, lead_time_hours, priority, active
  )
  SELECT s.id, sp.product_id, sp.supplier_sku, sp.purchase_price, sp.minimum_order_quantity,
         sp.available, sp.lead_time_hours, sp.priority, sp.active
  FROM public.supplier_products sp
  JOIN public.procurement_sources s ON s.fornecedor_id = sp.supplier_id
  ON CONFLICT (source_id, product_id) DO NOTHING;

  INSERT INTO public.procurement_routing_rules (
    product_id, source_id, priority, is_primary, is_backup, active, region
  )
  SELECT r.product_id, s.id, r.priority, r.is_primary, r.is_backup, r.active, r.region
  FROM public.supplier_routing_rules r
  JOIN public.procurement_sources s ON s.fornecedor_id = r.supplier_id
  ON CONFLICT (product_id, source_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_supplier_procurement() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.resolve_bar_price(
  p_bar uuid, p_product uuid, p_at timestamptz, p_qty integer
) RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  price numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.is_procurement_hq() OR public.user_can_access_bar(p_bar)) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  SELECT bp.sale_price INTO price
  FROM public.bar_product_prices bp
  WHERE bp.bar_id = p_bar
    AND bp.product_id = p_product
    AND bp.active
    AND (bp.valid_from IS NULL OR bp.valid_from <= COALESCE(p_at, now()))
    AND (bp.valid_until IS NULL OR bp.valid_until >= COALESCE(p_at, now()))
    AND bp.minimum_quantity <= GREATEST(COALESCE(p_qty, 1), 1)
  ORDER BY bp.minimum_quantity DESC, bp.valid_from DESC NULLS LAST
  LIMIT 1;
  IF price IS NOT NULL THEN
    RETURN price;
  END IF;
  SELECT pr.preco_venda INTO price FROM public.produtos pr WHERE pr.id = p_product;
  RETURN price;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_bar_price(uuid, uuid, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_bar_price(uuid, uuid, timestamptz, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public._ensure_bar_location(p_bar uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  loc uuid;
  bar_name text;
BEGIN
  SELECT id INTO loc FROM public.locations WHERE type = 'BAR' AND bar_id = p_bar LIMIT 1;
  IF loc IS NOT NULL THEN
    RETURN loc;
  END IF;
  SELECT nome INTO bar_name FROM public.bars WHERE id = p_bar;
  INSERT INTO public.locations (name, type, bar_id)
  VALUES (COALESCE(bar_name, 'Bar'), 'BAR', p_bar)
  RETURNING id INTO loc;
  RETURN loc;
END;
$$;

REVOKE ALL ON FUNCTION public._ensure_bar_location(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._ensure_source_location(p_source uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  loc uuid;
  src public.procurement_sources%ROWTYPE;
  kind text;
BEGIN
  SELECT id INTO loc FROM public.locations WHERE source_id = p_source AND type IN ('SUPPLIER', 'STORE', 'WAREHOUSE', 'OTHER') LIMIT 1;
  IF loc IS NOT NULL THEN
    RETURN loc;
  END IF;
  SELECT * INTO src FROM public.procurement_sources WHERE id = p_source;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  kind := CASE src.type
    WHEN 'SUPPLIER' THEN 'SUPPLIER'
    WHEN 'WAREHOUSE' THEN 'WAREHOUSE'
    WHEN 'PHYSICAL_STORE' THEN 'STORE'
    ELSE 'OTHER'
  END;
  INSERT INTO public.locations (name, type, source_id, address)
  VALUES (src.name, kind, src.id, src.address)
  RETURNING id INTO loc;
  RETURN loc;
END;
$$;

REVOKE ALL ON FUNCTION public._ensure_source_location(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._order_fully_at_bar(p_order uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.pedidos_itens i
    WHERE i.pedido_id = p_order
      AND i.qtd > COALESCE((
        SELECT SUM(t.quantity_at_bar)
        FROM public.procurement_tasks t
        WHERE t.order_item_id = i.id
          AND t.status <> 'cancelled'
      ), 0)
  )
  AND EXISTS (SELECT 1 FROM public.pedidos_itens i WHERE i.pedido_id = p_order);
$$;

REVOKE ALL ON FUNCTION public._order_fully_at_bar(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public._close_order_if_covered(p_order uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ped public.pedidos%ROWTYPE;
  expected integer;
BEGIN
  IF NOT public._order_fully_at_bar(p_order) THEN
    RETURN false;
  END IF;
  SELECT * INTO ped FROM public.pedidos WHERE id = p_order FOR UPDATE;
  UPDATE public.procurement_tasks
  SET status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now()
  WHERE order_id = p_order
    AND status NOT IN ('cancelled', 'completed')
    AND quantity_at_bar >= quantity_allocated;
  PERFORM public._touch_fulfillment(p_order, 'completed');
  UPDATE public.pedidos SET status = 'entregue' WHERE id = p_order;
  SELECT COALESCE(SUM(i.qtd), 0) INTO expected FROM public.pedidos_itens i WHERE i.pedido_id = p_order;
  INSERT INTO public.delivery_confirmations (
    order_id, confirmed_by, status, quantity_expected, quantity_received, note
  )
  SELECT p_order, auth.uid(), 'received_all', expected, expected, 'Covered by procurement shipments'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.delivery_confirmations d WHERE d.order_id = p_order
  );
  INSERT INTO public.fulfillment_events (order_id, event_type, actor_user_id, actor_type, note)
  VALUES (p_order, 'bar_confirmed', auth.uid(), 'bar', 'Quantity at the bar covers the order')
  ON CONFLICT DO NOTHING;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public._close_order_if_covered(uuid) FROM PUBLIC;

-- ── plan: split a bar order into procurement tasks ─────────────────────────

CREATE OR REPLACE FUNCTION public.plan_procurement(p_order_id uuid, p_need timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ped public.pedidos%ROWTYPE;
  item record;
  pick record;
  st public.procurement_settings%ROWTYPE;
  v_need timestamptz;
  v_closures date[];
  remaining integer;
  cap integer;
  asg uuid;
  loc uuid;
  has_feasible boolean;
  meets boolean;
  is_late boolean;
  task_id uuid;
  unmet integer := 0;
  made integer := 0;
  code text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO ped FROM public.pedidos WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;
  IF NOT (public.is_procurement_hq() OR public.user_can_access_bar(ped.bar_id)) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF ped.status = 'cancelado' THEN
    RAISE EXCEPTION 'order cancelled';
  END IF;

  PERFORM public.sync_supplier_procurement();
  SELECT * INTO st FROM public.procurement_settings WHERE id = 1;
  SELECT COALESCE(array_agg(on_date), ARRAY[]::date[]) INTO v_closures FROM public.ops_closures;
  loc := public._ensure_bar_location(ped.bar_id);

  v_need := COALESCE(
    p_need,
    ped.entrega_desejada,
    CASE
      WHEN ped.data_entrega_prevista IS NOT NULL
        THEN (ped.data_entrega_prevista::timestamp + time '18:00') AT TIME ZONE 'Asia/Tokyo'
      ELSE NULL
    END
  );
  IF p_need IS NOT NULL THEN
    UPDATE public.pedidos SET entrega_desejada = p_need WHERE id = ped.id;
  END IF;
  IF ped.public_code IS NULL THEN
    code := public.next_ops_code('BAR');
    UPDATE public.pedidos SET public_code = code WHERE id = ped.id;
    ped.public_code := code;
  END IF;

  -- Keep tasks for supplier work that route_pedido already created.
  FOR pick IN
    SELECT a.id AS assignment_id, a.supplier_id, a.status AS assignment_status,
           osi.order_item_id, osi.quantity_requested, osi.supplier_purchase_price,
           pi.produto_id, s.id AS source_id, s.name AS source_name, s.type AS source_type
    FROM public.order_supplier_items osi
    JOIN public.order_supplier_assignments a ON a.id = osi.assignment_id
    JOIN public.pedidos_itens pi ON pi.id = osi.order_item_id
    JOIN public.procurement_sources s ON s.fornecedor_id = a.supplier_id
    WHERE a.order_id = p_order_id
      AND a.status NOT IN ('rejected', 'cancelled')
      AND NOT EXISTS (
        SELECT 1 FROM public.procurement_tasks t
        WHERE t.assignment_id = a.id AND t.order_item_id = osi.order_item_id
      )
  LOOP
    INSERT INTO public.procurement_tasks (
      task_number, order_id, order_item_id, source_id, product_id, assignment_id,
      quantity_requested, quantity_allocated, procurement_method, source_company,
      expected_unit_cost, estimated_total_cost, requested_delivery_at,
      destination_location_id, status
    ) VALUES (
      public.next_ops_code('BUY'), p_order_id, pick.order_item_id, pick.source_id, pick.produto_id,
      pick.assignment_id, pick.quantity_requested, pick.quantity_requested, 'SUPPLIER', pick.source_name,
      pick.supplier_purchase_price,
      CASE WHEN pick.supplier_purchase_price IS NULL THEN NULL ELSE pick.supplier_purchase_price * pick.quantity_requested END,
      v_need, loc,
      CASE pick.assignment_status
        WHEN 'pending' THEN 'assigned'
        WHEN 'accepted' THEN 'waiting_purchase'
        WHEN 'purchasing' THEN 'purchasing'
        WHEN 'purchased' THEN 'purchasing'
        WHEN 'in_transit' THEN 'purchasing'
        WHEN 'delivered' THEN 'purchasing'
        WHEN 'partial' THEN 'purchasing'
        WHEN 'issue' THEN 'exception'
        ELSE 'assigned'
      END
    );
    made := made + 1;
  END LOOP;

  PERFORM public._touch_fulfillment(p_order_id, 'routing');

  FOR item IN
    SELECT i.id, i.produto_id, i.qtd
    FROM public.pedidos_itens i
    WHERE i.pedido_id = p_order_id
      AND i.produto_id IS NOT NULL
      AND i.qtd > 0
  LOOP
    SELECT item.qtd - COALESCE(SUM(t.quantity_allocated), 0)
      INTO remaining
    FROM public.procurement_tasks t
    WHERE t.order_item_id = item.id
      AND t.status <> 'cancelled';
    IF remaining <= 0 THEN
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.procurement_routing_rules r
      JOIN public.procurement_sources s ON s.id = r.source_id AND s.active
      LEFT JOIN public.procurement_source_products sp
        ON sp.source_id = s.id AND sp.product_id = item.produto_id AND sp.active
      WHERE r.product_id = item.produto_id
        AND r.active
        AND COALESCE(sp.available, true)
        AND (
          v_need IS NULL
          OR (
            public.procurement_deadlines(
              v_need,
              st.default_transport_hours,
              st.default_warehouse_hours,
              st.default_prep_hours,
              COALESCE(sp.lead_time_hours, s.default_lead_time_hours, 0),
              st.safety_buffer_hours,
              s.cutoff_time,
              public.parse_iso_days(s.delivery_days),
              v_closures
            )->>'buy_by'
          )::timestamptz >= now()
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.procurement_tasks prev
          WHERE prev.order_item_id = item.id
            AND prev.source_id = s.id
            AND prev.status IN ('cancelled', 'exception')
        )
    ) INTO has_feasible;

    FOR pick IN
      SELECT s.id AS source_id, s.type, s.fornecedor_id, s.name, s.company_name,
             s.default_assignee, COALESCE(sp.purchase_url, s.purchase_url) AS purchase_url,
             sp.purchase_price,
             COALESCE(sp.lead_time_hours, s.default_lead_time_hours, 0) AS lead_h,
             COALESCE(sp.minimum_quantity, 1) AS moq,
             sp.available_qty,
             COALESCE(r.is_primary, false) AS is_primary,
             COALESCE(r.is_backup, false) AS is_backup,
             COALESCE(r.priority, s.priority, 100) AS prio,
             public.procurement_deadlines(
               v_need, st.default_transport_hours, st.default_warehouse_hours, st.default_prep_hours,
               COALESCE(sp.lead_time_hours, s.default_lead_time_hours, 0), st.safety_buffer_hours,
               s.cutoff_time, public.parse_iso_days(s.delivery_days), v_closures
             ) AS deadlines
      FROM public.procurement_routing_rules r
      JOIN public.procurement_sources s ON s.id = r.source_id AND s.active
      LEFT JOIN public.procurement_source_products sp
        ON sp.source_id = s.id AND sp.product_id = item.produto_id AND sp.active
      WHERE r.product_id = item.produto_id
        AND r.active
        AND (r.destination_bar_id IS NULL OR r.destination_bar_id = ped.bar_id)
        AND COALESCE(sp.available, true)
        AND NOT EXISTS (
          SELECT 1 FROM public.procurement_tasks prev
          WHERE prev.order_item_id = item.id
            AND prev.source_id = s.id
            AND prev.status IN ('cancelled', 'exception')
        )
      ORDER BY
        CASE
          WHEN v_need IS NULL OR (
            public.procurement_deadlines(
              v_need, st.default_transport_hours, st.default_warehouse_hours, st.default_prep_hours,
              COALESCE(sp.lead_time_hours, s.default_lead_time_hours, 0), st.safety_buffer_hours,
              s.cutoff_time, public.parse_iso_days(s.delivery_days), v_closures
            )->>'buy_by'
          )::timestamptz >= now() THEN 0 ELSE 1
        END,
        r.is_primary DESC,
        r.is_backup ASC,
        COALESCE(r.priority, s.priority, 100) ASC,
        COALESCE(sp.lead_time_hours, s.default_lead_time_hours, 0) ASC,
        COALESCE(sp.purchase_price, 1e12) ASC
    LOOP
      EXIT WHEN remaining <= 0;
      meets := v_need IS NULL OR (pick.deadlines->>'buy_by')::timestamptz >= now();
      IF has_feasible AND NOT meets THEN
        CONTINUE;
      END IF;
      cap := remaining;
      IF pick.available_qty IS NOT NULL THEN
        cap := LEAST(cap, pick.available_qty);
      END IF;
      IF cap < pick.moq OR cap <= 0 THEN
        CONTINUE;
      END IF;
      is_late := NOT has_feasible;
      asg := NULL;
      IF pick.type = 'SUPPLIER' AND pick.fornecedor_id IS NOT NULL THEN
        INSERT INTO public.order_supplier_assignments (order_id, supplier_id, status, expected_delivery_at)
        VALUES (p_order_id, pick.fornecedor_id, 'pending', v_need)
        ON CONFLICT (order_id, supplier_id) DO UPDATE SET updated_at = now()
        RETURNING id INTO asg;
        INSERT INTO public.order_supplier_items (
          assignment_id, order_item_id, quantity_requested, supplier_purchase_price, status
        ) VALUES (asg, item.id, cap, pick.purchase_price, 'pending')
        ON CONFLICT (assignment_id, order_item_id) DO UPDATE
          SET quantity_requested = public.order_supplier_items.quantity_requested + EXCLUDED.quantity_requested,
              supplier_purchase_price = COALESCE(public.order_supplier_items.supplier_purchase_price, EXCLUDED.supplier_purchase_price),
              updated_at = now();
        INSERT INTO public.fulfillment_events (
          order_id, assignment_id, event_type, actor_user_id, actor_type, note, metadata
        ) VALUES (
          p_order_id, asg, 'assigned', auth.uid(), 'jbm', 'Procurement split',
          jsonb_build_object('quantity', cap, 'source_id', pick.source_id)
        ) ON CONFLICT DO NOTHING;
        PERFORM public._fulfillment_alert(
          p_order_id, asg, 'supplier', pick.fornecedor_id, ped.bar_id,
          'supplier_order_created', 'New order', 'A bar order was routed to you.'
        );
      END IF;

      INSERT INTO public.procurement_tasks (
        task_number, order_id, order_item_id, source_id, product_id, assignment_id,
        quantity_requested, quantity_allocated, procurement_method, source_company,
        purchase_url, expected_unit_cost, estimated_total_cost, requested_delivery_at,
        buy_by_at, depart_by_at, assigned_to, status, late, destination_location_id, priority
      ) VALUES (
        public.next_ops_code('BUY'), p_order_id, item.id, pick.source_id, item.produto_id, asg,
        cap, cap, pick.type, COALESCE(pick.company_name, pick.name), pick.purchase_url,
        pick.purchase_price,
        CASE WHEN pick.purchase_price IS NULL THEN NULL ELSE pick.purchase_price * cap END,
        v_need, NULLIF(pick.deadlines->>'buy_by', '')::timestamptz,
        NULLIF(pick.deadlines->>'depart_by', '')::timestamptz,
        pick.default_assignee,
        CASE WHEN is_late THEN 'exception' ELSE 'assigned' END,
        is_late, loc, pick.prio
      ) RETURNING id INTO task_id;
      made := made + 1;
      remaining := remaining - cap;
      IF is_late THEN
        PERFORM public._fulfillment_alert(
          p_order_id, asg, 'jbm', pick.fornecedor_id, ped.bar_id,
          'order_exception', 'Deadline missed', 'No source can buy in time. Fallback is available.'
        );
      ELSIF pick.default_assignee IS NOT NULL THEN
        INSERT INTO public.fulfillment_alerts (
          order_id, assignment_id, audience, bar_id, assignee_user_id, event_type, title, body
        ) VALUES (
          p_order_id, asg, 'employee', ped.bar_id, pick.default_assignee,
          'buy_assigned', 'Purchase task', 'A procurement task was assigned to you.'
        );
      END IF;
    END LOOP;

    IF remaining > 0 THEN
      unmet := unmet + remaining;
    END IF;
  END LOOP;

  IF unmet > 0 THEN
    PERFORM public._touch_fulfillment(p_order_id, 'exception');
    PERFORM public._fulfillment_alert(
      p_order_id, NULL, 'jbm', NULL, ped.bar_id,
      'order_exception', 'Quantity still open',
      'Part of the order has no source. The order stays pending.'
    );
  ELSE
    PERFORM public._rollup_order_status(p_order_id);
  END IF;

  IF made > 0 AND unmet = 0 AND ped.status = 'pendente' THEN
    UPDATE public.pedidos SET status = 'confirmado' WHERE id = ped.id;
  END IF;

  PERFORM public._fulfillment_audit('plan_procurement', 'pedidos', p_order_id,
    jsonb_build_object('made', made, 'unmet', unmet));

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'public_code', (SELECT public_code FROM public.pedidos WHERE id = p_order_id),
    'made', made,
    'unmet', unmet,
    'tasks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id,
        'task_number', t.task_number,
        'quantity', t.quantity_allocated,
        'status', t.status,
        'late', t.late,
        'method', CASE WHEN public.is_procurement_hq() OR t.assigned_to = auth.uid() THEN t.procurement_method ELSE NULL END
      ) ORDER BY t.task_number)
      FROM public.procurement_tasks t
      WHERE t.order_id = p_order_id
        AND t.status <> 'cancelled'
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.plan_procurement(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.plan_procurement(uuid, timestamptz) TO authenticated;

-- One transaction: bar order, line prices, procurement tasks and deadlines.
DROP FUNCTION IF EXISTS public.submit_bar_order(uuid, timestamptz, text, jsonb);

CREATE OR REPLACE FUNCTION public.submit_bar_order(
  p_bar_id uuid,
  p_need timestamptz,
  p_obs text,
  p_items jsonb,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  line jsonb;
  pid uuid;
  qty integer;
  price numeric;
  order_id uuid;
  total numeric := 0;
  need_day date;
  idem text;
  existing uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.is_procurement_hq() OR public.user_can_access_bar(p_bar_id)) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  idem := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  IF idem IS NOT NULL AND char_length(idem) > 128 THEN
    RAISE EXCEPTION 'invalid idempotency key';
  END IF;
  IF idem IS NOT NULL THEN
    SELECT k.order_id INTO existing
    FROM public.order_idempotency_keys k
    WHERE k.bar_id = p_bar_id
      AND k.user_id = auth.uid()
      AND k.idempotency_key = idem;
    IF existing IS NOT NULL THEN
      RETURN jsonb_build_object(
        'order_id', existing,
        'public_code', (SELECT p.public_code FROM public.pedidos p WHERE p.id = existing),
        'replayed', true,
        'total', (SELECT p.total_estimado FROM public.pedidos p WHERE p.id = existing)
      );
    END IF;
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'order needs items';
  END IF;

  need_day := CASE
    WHEN p_need IS NULL THEN NULL
    ELSE (p_need AT TIME ZONE 'Asia/Tokyo')::date
  END;

  INSERT INTO public.pedidos (
    bar_id, criado_por, status, data_pedido, data_entrega_prevista, obs, total_estimado, entrega_desejada
  ) VALUES (
    p_bar_id, auth.uid(), 'pendente',
    (timezone('Asia/Tokyo', now()))::date,
    need_day,
    NULLIF(btrim(COALESCE(p_obs, '')), ''),
    0,
    p_need
  ) RETURNING id INTO order_id;

  FOR line IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    pid := NULLIF(line->>'produto_id', '')::uuid;
    qty := NULLIF(line->>'qtd', '')::integer;
    IF pid IS NULL OR qty IS NULL OR qty <= 0 THEN
      RAISE EXCEPTION 'invalid order line';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.produtos pr WHERE pr.id = pid) THEN
      RAISE EXCEPTION 'product not found';
    END IF;
    price := public.resolve_bar_price(p_bar_id, pid, COALESCE(p_need, now()), qty);
    IF price IS NULL OR price <= 0 THEN
      RAISE EXCEPTION 'sale price not configured for product % and bar %', pid, p_bar_id;
    END IF;
    INSERT INTO public.pedidos_itens (pedido_id, produto_id, qtd, preco_unitario)
    VALUES (order_id, pid, qty, price);
    total := total + price * qty;
  END LOOP;

  UPDATE public.pedidos SET total_estimado = total WHERE id = order_id;
  IF idem IS NOT NULL THEN
    INSERT INTO public.order_idempotency_keys (bar_id, user_id, idempotency_key, order_id)
    VALUES (p_bar_id, auth.uid(), idem, order_id);
  END IF;
  RETURN public.plan_procurement(order_id, p_need) || jsonb_build_object('total', total, 'replayed', false);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_bar_order(uuid, timestamptz, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_bar_order(uuid, timestamptz, text, jsonb, text) TO authenticated;

-- JBM only. Purchase + freight + fees + logistics share, against the bar sale price.
CREATE OR REPLACE FUNCTION public.task_economics(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task public.procurement_tasks%ROWTYPE;
  ped_bar uuid;
  purchase numeric := 0;
  freight numeric := 0;
  fees numeric := 0;
  logistics numeric := 0;
  sale numeric;
  qty integer;
BEGIN
  IF NOT public.is_procurement_hq() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  SELECT * INTO task FROM public.procurement_tasks WHERE id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found';
  END IF;
  SELECT bar_id INTO ped_bar FROM public.pedidos WHERE id = task.order_id;
  SELECT COALESCE(SUM(l.quantity * l.unit_cost), 0) INTO purchase
  FROM public.purchase_lines l WHERE l.procurement_task_id = task.id;
  SELECT COALESCE(SUM(p.freight), 0), COALESCE(SUM(p.fees), 0)
    INTO freight, fees
  FROM public.purchase_transactions p
  JOIN public.purchase_lines l ON l.purchase_id = p.id
  WHERE l.procurement_task_id = task.id;
  SELECT COALESCE(SUM(
    s.logistics_cost * si.quantity / NULLIF((
      SELECT SUM(all_items.quantity) FROM public.shipment_items all_items WHERE all_items.shipment_id = s.id
    ), 0)
  ), 0) INTO logistics
  FROM public.shipment_items si
  JOIN public.shipments s ON s.id = si.shipment_id
  WHERE si.procurement_task_id = task.id
    AND s.status <> 'cancelled';
  qty := task.quantity_allocated;
  sale := public.resolve_bar_price(ped_bar, task.product_id, COALESCE(task.requested_delivery_at, now()), qty);
  RETURN jsonb_build_object(
    'task_id', task.id,
    'task_number', task.task_number,
    'quantity', qty,
    'purchase_cost', purchase,
    'freight', freight,
    'fees', fees,
    'logistics_cost', logistics,
    'real_cost', purchase + freight + fees + logistics,
    'sale_price', sale,
    'revenue', COALESCE(sale, 0) * qty,
    'margin', COALESCE(sale, 0) * qty - (purchase + freight + fees + logistics)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.task_economics(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.task_economics(uuid) TO authenticated;

-- ── purchase record. Status purchased requires this row. ───────────────────

CREATE OR REPLACE FUNCTION public.record_purchase(p_task_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task public.procurement_tasks%ROWTYPE;
  src public.procurement_sources%ROWTYPE;
  qty integer;
  unit_cost numeric;
  buyer uuid;
  bought timestamptz;
  freight numeric;
  fees numeric;
  purchase_id uuid;
  code text;
  sum_qty integer;
  sum_cost numeric;
  sum_freight numeric;
  sum_fees numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO task FROM public.procurement_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found';
  END IF;
  SELECT * INTO src FROM public.procurement_sources WHERE id = task.source_id;
  IF NOT (
    public.is_procurement_hq()
    OR task.assigned_to = auth.uid()
    OR (src.fornecedor_id IS NOT NULL AND src.fornecedor_id IN (SELECT public.my_supplier_ids()))
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF task.status IN ('completed', 'cancelled', 'purchased', 'received', 'in_transit') THEN
    RAISE EXCEPTION 'task is not open for purchase';
  END IF;

  qty := COALESCE(NULLIF(p_payload->>'quantity', '')::integer, task.quantity_allocated - task.quantity_purchased);
  unit_cost := NULLIF(p_payload->>'unit_cost', '')::numeric;
  buyer := COALESCE(NULLIF(p_payload->>'buyer_user_id', '')::uuid, auth.uid());
  bought := COALESCE(NULLIF(p_payload->>'purchased_at', '')::timestamptz, now());
  freight := COALESCE(NULLIF(p_payload->>'freight', '')::numeric, 0);
  fees := COALESCE(NULLIF(p_payload->>'fees', '')::numeric, 0);
  IF NOT public.is_procurement_hq() THEN
    IF COALESCE(NULLIF(p_payload->>'freight', '')::numeric, 0) <> 0
       OR COALESCE(NULLIF(p_payload->>'fees', '')::numeric, 0) <> 0 THEN
      RAISE EXCEPTION 'not allowed';
    END IF;
    freight := 0;
    fees := 0;
    buyer := auth.uid();
    IF task.expected_unit_cost IS NULL OR task.expected_unit_cost <= 0 THEN
      RAISE EXCEPTION 'unit cost is fixed for this task';
    END IF;
    IF unit_cost IS NOT NULL AND unit_cost IS DISTINCT FROM task.expected_unit_cost THEN
      RAISE EXCEPTION 'unit cost is fixed for this task';
    END IF;
    unit_cost := task.expected_unit_cost;
  ELSIF unit_cost IS NULL THEN
    unit_cost := task.expected_unit_cost;
  END IF;
  IF qty IS NULL OR qty <= 0 OR unit_cost IS NULL OR unit_cost <= 0 OR buyer IS NULL OR bought IS NULL OR task.source_id IS NULL THEN
    RAISE EXCEPTION 'purchase needs buyer, time, source, quantity and unit cost';
  END IF;
  IF NOT public.is_procurement_hq() AND buyer <> auth.uid() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF task.quantity_purchased + qty > task.quantity_allocated THEN
    RAISE EXCEPTION 'quantity exceeds the task';
  END IF;

  code := public.next_ops_code('PUR');
  INSERT INTO public.purchase_transactions (
    public_code, source_id, buyer_user_id, purchased_at, freight, fees,
    external_reference, receipt_note, payment_method, notes
  ) VALUES (
    code, task.source_id, buyer, bought, freight, fees,
    NULLIF(p_payload->>'external_reference', ''),
    NULLIF(p_payload->>'receipt_note', ''),
    NULLIF(p_payload->>'payment_method', ''),
    NULLIF(p_payload->>'notes', '')
  ) RETURNING id INTO purchase_id;

  INSERT INTO public.purchase_lines (purchase_id, procurement_task_id, product_id, quantity, unit_cost)
  VALUES (purchase_id, task.id, task.product_id, qty, unit_cost);

  SELECT COALESCE(SUM(l.quantity), 0), COALESCE(SUM(l.quantity * l.unit_cost), 0)
    INTO sum_qty, sum_cost
  FROM public.purchase_lines l
  WHERE l.procurement_task_id = task.id;
  SELECT COALESCE(SUM(p.freight), 0), COALESCE(SUM(p.fees), 0)
    INTO sum_freight, sum_fees
  FROM public.purchase_transactions p
  JOIN public.purchase_lines l ON l.purchase_id = p.id
  WHERE l.procurement_task_id = task.id;

  UPDATE public.procurement_tasks
  SET quantity_purchased = sum_qty,
      actual_unit_cost = CASE WHEN sum_qty > 0 THEN sum_cost / sum_qty ELSE NULL END,
      actual_total_cost = sum_cost + sum_freight + sum_fees,
      external_reference = COALESCE(NULLIF(p_payload->>'external_reference', ''), external_reference),
      proof_note = COALESCE(NULLIF(p_payload->>'receipt_note', ''), proof_note),
      status = CASE WHEN sum_qty >= quantity_allocated THEN 'purchased' ELSE 'purchasing' END,
      updated_at = now()
  WHERE id = task.id;

  PERFORM public._fulfillment_audit('record_purchase', 'procurement_tasks', task.id,
    jsonb_build_object('purchase', code, 'quantity', qty, 'unit_cost', unit_cost));

  RETURN jsonb_build_object('purchase_id', purchase_id, 'public_code', code, 'quantity_purchased', sum_qty);
END;
$$;

REVOKE ALL ON FUNCTION public.record_purchase(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_purchase(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public._stock_move(
  p_location uuid, p_task uuid, p_product uuid, p_direction text, p_qty integer, p_reason text, p_shipment uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_qty IS NULL OR p_qty <= 0 OR p_location IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.procurement_stock_moves (
    location_id, procurement_task_id, product_id, shipment_id, direction, quantity, reason, created_by
  ) VALUES (
    p_location, p_task, p_product, p_shipment, p_direction, p_qty, p_reason, auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public._stock_move(uuid, uuid, uuid, text, integer, text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.receive_procurement(
  p_task_id uuid, p_location_id uuid, p_qty integer, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task public.procurement_tasks%ROWTYPE;
  loc public.locations%ROWTYPE;
  next_qty integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO task FROM public.procurement_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found';
  END IF;
  SELECT * INTO loc FROM public.locations WHERE id = p_location_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'location not found';
  END IF;
  IF NOT (public.is_procurement_hq() OR task.assigned_to = auth.uid()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF loc.type = 'BAR' THEN
    RAISE EXCEPTION 'bar stock is confirmed by the bar on a shipment';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'quantity required';
  END IF;
  IF task.quantity_purchased <= 0 THEN
    RAISE EXCEPTION 'purchase record required before receipt';
  END IF;
  IF task.quantity_received + p_qty > task.quantity_purchased THEN
    RAISE EXCEPTION 'received exceeds purchased';
  END IF;
  next_qty := task.quantity_received + p_qty;
  UPDATE public.procurement_tasks
  SET quantity_received = next_qty,
      status = CASE WHEN next_qty >= quantity_allocated THEN 'received' ELSE 'partially_received' END,
      notes = COALESCE(p_note, notes),
      updated_at = now()
  WHERE id = task.id;
  PERFORM public._stock_move(loc.id, task.id, task.product_id, 'in', p_qty, 'receive', NULL);
  PERFORM public._fulfillment_audit('receive_procurement', 'procurement_tasks', task.id,
    jsonb_build_object('location_id', p_location_id, 'quantity', p_qty));
  RETURN jsonb_build_object('task_id', task.id, 'quantity_received', next_qty, 'at_bar', task.quantity_at_bar);
END;
$$;

REVOKE ALL ON FUNCTION public.receive_procurement(uuid, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receive_procurement(uuid, uuid, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_shipment(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ship uuid;
  code text;
  line jsonb;
  task public.procurement_tasks%ROWTYPE;
  qty integer;
  already integer;
  available integer;
  from_id uuid;
  to_id uuid;
  order_id uuid;
  origin public.locations%ROWTYPE;
  dest public.locations%ROWTYPE;
  ped_bar uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_procurement_hq() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  from_id := NULLIF(p_payload->>'from_location_id', '')::uuid;
  to_id := NULLIF(p_payload->>'to_location_id', '')::uuid;
  IF from_id IS NULL OR to_id IS NULL THEN
    RAISE EXCEPTION 'origin and destination are required';
  END IF;
  IF p_payload->'items' IS NULL OR jsonb_array_length(p_payload->'items') = 0 THEN
    RAISE EXCEPTION 'shipment needs items';
  END IF;
  SELECT * INTO origin FROM public.locations WHERE id = from_id AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'location is not active';
  END IF;
  SELECT * INTO dest FROM public.locations WHERE id = to_id AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'location is not active';
  END IF;
  IF origin.type = 'BAR' AND dest.type = 'BAR' THEN
    RAISE EXCEPTION 'shipment between bars is not allowed';
  END IF;

  FOR line IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    SELECT * INTO task FROM public.procurement_tasks WHERE id = NULLIF(line->>'task_id', '')::uuid FOR UPDATE;
    IF NOT FOUND OR task.status = 'cancelled' THEN
      RAISE EXCEPTION 'task not found';
    END IF;
    IF order_id IS NULL THEN
      order_id := task.order_id;
    ELSIF task.order_id IS DISTINCT FROM order_id THEN
      RAISE EXCEPTION 'shipment tasks must belong to the same order';
    END IF;
    qty := NULLIF(line->>'quantity', '')::integer;
    IF qty IS NULL OR qty <= 0 THEN
      RAISE EXCEPTION 'quantity required';
    END IF;
    SELECT COALESCE(SUM(si.quantity), 0) INTO already
    FROM public.shipment_items si
    JOIN public.shipments s ON s.id = si.shipment_id
    WHERE si.procurement_task_id = task.id
      AND s.status <> 'cancelled';
    IF origin.type = 'WAREHOUSE' THEN
      available := task.quantity_received - already;
    ELSE
      available := task.quantity_purchased - already;
    END IF;
    IF qty > available THEN
      RAISE EXCEPTION 'shipment quantity exceeds what was purchased';
    END IF;
  END LOOP;

  SELECT bar_id INTO ped_bar FROM public.pedidos WHERE id = order_id;
  IF dest.type = 'BAR' AND dest.bar_id IS DISTINCT FROM ped_bar THEN
    RAISE EXCEPTION 'shipment destination bar does not match order bar';
  END IF;

  code := public.next_ops_code('DEL');
  INSERT INTO public.shipments (
    public_code, order_id, from_location_id, to_location_id, responsible_user_id,
    carrier, expected_at, tracking_ref, notes, logistics_cost
  ) VALUES (
    code, order_id, from_id, to_id,
    NULLIF(p_payload->>'responsible_user_id', '')::uuid,
    NULLIF(p_payload->>'carrier', ''),
    NULLIF(p_payload->>'expected_at', '')::timestamptz,
    NULLIF(p_payload->>'tracking_ref', ''),
    NULLIF(p_payload->>'notes', ''),
    COALESCE(NULLIF(p_payload->>'logistics_cost', '')::numeric, 0)
  ) RETURNING id INTO ship;

  FOR line IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    INSERT INTO public.shipment_items (shipment_id, procurement_task_id, quantity)
    VALUES (
      ship,
      NULLIF(line->>'task_id', '')::uuid,
      NULLIF(line->>'quantity', '')::integer
    );
  END LOOP;

  PERFORM public._fulfillment_audit('create_shipment', 'shipments', ship, jsonb_build_object('code', code));
  RETURN jsonb_build_object('shipment_id', ship, 'public_code', code);
END;
$$;

REVOKE ALL ON FUNCTION public.create_shipment(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_shipment(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.advance_shipment(p_shipment_id uuid, p_action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ship public.shipments%ROWTYPE;
  dest public.locations%ROWTYPE;
  origin public.locations%ROWTYPE;
  item record;
  next_qty integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.is_procurement_hq() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  SELECT * INTO ship FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment not found';
  END IF;
  SELECT * INTO dest FROM public.locations WHERE id = ship.to_location_id;
  SELECT * INTO origin FROM public.locations WHERE id = ship.from_location_id;

  IF p_action = 'depart' THEN
    IF ship.status <> 'planned' THEN
      RAISE EXCEPTION 'invalid transition';
    END IF;
    UPDATE public.shipments SET status = 'in_transit', shipped_at = now(), updated_at = now() WHERE id = ship.id;
    UPDATE public.procurement_tasks t
    SET status = 'in_transit', updated_at = now()
    WHERE t.id IN (SELECT procurement_task_id FROM public.shipment_items WHERE shipment_id = ship.id)
      AND t.status IN ('purchased', 'received', 'partially_received');
    IF origin.type = 'WAREHOUSE' THEN
      FOR item IN
        SELECT si.quantity, si.procurement_task_id, t.product_id
        FROM public.shipment_items si
        JOIN public.procurement_tasks t ON t.id = si.procurement_task_id
        WHERE si.shipment_id = ship.id
      LOOP
        PERFORM public._stock_move(origin.id, item.procurement_task_id, item.product_id, 'out', item.quantity, 'depart', ship.id);
      END LOOP;
    END IF;
  ELSIF p_action = 'deliver' THEN
    IF ship.status <> 'in_transit' THEN
      RAISE EXCEPTION 'invalid transition';
    END IF;
    UPDATE public.shipments SET status = 'delivered', delivered_at = now(), updated_at = now() WHERE id = ship.id;
    IF dest.type IS DISTINCT FROM 'BAR' THEN
      FOR item IN
        SELECT si.quantity, si.procurement_task_id, t.product_id, t.quantity_purchased, t.quantity_received, t.quantity_allocated
        FROM public.shipment_items si
        JOIN public.procurement_tasks t ON t.id = si.procurement_task_id
        WHERE si.shipment_id = ship.id
        FOR UPDATE OF t
      LOOP
        IF item.quantity_purchased <= 0 THEN
          RAISE EXCEPTION 'purchase record required before receipt';
        END IF;
        IF item.quantity_received + item.quantity > item.quantity_purchased THEN
          RAISE EXCEPTION 'received exceeds purchased';
        END IF;
        next_qty := item.quantity_received + item.quantity;
        UPDATE public.procurement_tasks
        SET quantity_received = next_qty,
            status = CASE
              WHEN next_qty >= quantity_allocated THEN 'received'
              ELSE 'partially_received'
            END,
            updated_at = now()
        WHERE id = item.procurement_task_id;
        PERFORM public._stock_move(dest.id, item.procurement_task_id, item.product_id, 'in', item.quantity, 'deliver', ship.id);
      END LOOP;
    ELSIF dest.bar_id IS NOT NULL THEN
      PERFORM public._fulfillment_alert(
        ship.order_id, NULL, 'bar', NULL, dest.bar_id,
        'order_delivered', 'Delivered', 'Confirm what arrived.'
      );
    END IF;
  ELSIF p_action = 'exception' THEN
    UPDATE public.shipments SET status = 'exception', updated_at = now() WHERE id = ship.id;
  ELSIF p_action = 'cancel' THEN
    IF ship.status = 'delivered' THEN
      RAISE EXCEPTION 'invalid transition';
    END IF;
    IF ship.status = 'in_transit' AND origin.type = 'WAREHOUSE' THEN
      FOR item IN
        SELECT si.quantity, si.procurement_task_id, t.product_id
        FROM public.shipment_items si
        JOIN public.procurement_tasks t ON t.id = si.procurement_task_id
        WHERE si.shipment_id = ship.id
      LOOP
        PERFORM public._stock_move(origin.id, item.procurement_task_id, item.product_id, 'in', item.quantity, 'cancel', ship.id);
      END LOOP;
    END IF;
    UPDATE public.shipments SET status = 'cancelled', updated_at = now() WHERE id = ship.id;
  ELSE
    RAISE EXCEPTION 'invalid transition';
  END IF;

  PERFORM public._fulfillment_audit('advance_shipment', 'shipments', ship.id, jsonb_build_object('action', p_action));
  RETURN jsonb_build_object('shipment_id', ship.id, 'action', p_action);
END;
$$;

REVOKE ALL ON FUNCTION public.advance_shipment(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_shipment(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_bar_shipment(
  p_shipment_id uuid, p_status text, p_lines jsonb DEFAULT '[]'::jsonb, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ship public.shipments%ROWTYPE;
  dest public.locations%ROWTYPE;
  origin public.locations%ROWTYPE;
  item record;
  task public.procurement_tasks%ROWTYPE;
  got integer;
  obs text;
  ped uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_status NOT IN ('received', 'partial', 'not_received') THEN
    RAISE EXCEPTION 'invalid confirmation';
  END IF;
  SELECT * INTO ship FROM public.shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment not found';
  END IF;
  IF ship.bar_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'delivery already confirmed';
  END IF;
  IF ship.status <> 'delivered' THEN
    RAISE EXCEPTION 'shipment is not delivered';
  END IF;
  SELECT * INTO dest FROM public.locations WHERE id = ship.to_location_id;
  SELECT * INTO origin FROM public.locations WHERE id = ship.from_location_id;
  IF dest.type IS DISTINCT FROM 'BAR' OR dest.bar_id IS NULL THEN
    RAISE EXCEPTION 'this shipment is not for a bar';
  END IF;
  IF origin.type = 'BAR' THEN
    RAISE EXCEPTION 'shipment between bars is not allowed';
  END IF;
  IF NOT (public.user_can_access_bar(dest.bar_id) OR public.is_procurement_hq()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  obs := 'JBM ship ' || left(ship.id::text, 8);
  FOR item IN
    SELECT si.procurement_task_id, si.quantity, t.product_id, t.order_id, t.quantity_allocated, t.quantity_at_bar
    FROM public.shipment_items si
    JOIN public.procurement_tasks t ON t.id = si.procurement_task_id
    WHERE si.shipment_id = ship.id
  LOOP
    got := CASE p_status
      WHEN 'received' THEN item.quantity
      WHEN 'not_received' THEN 0
      ELSE COALESCE((
        SELECT NULLIF(line->>'quantity', '')::integer
        FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) line
        WHERE NULLIF(line->>'task_id', '')::uuid = item.procurement_task_id
        LIMIT 1
      ), 0)
    END;
    IF got < 0 OR got > item.quantity THEN
      RAISE EXCEPTION 'confirmed quantity is outside the shipment';
    END IF;
    SELECT * INTO task FROM public.procurement_tasks WHERE id = item.procurement_task_id FOR UPDATE;
    IF origin.type = 'WAREHOUSE' THEN
      IF task.quantity_at_bar + got > task.quantity_received THEN
        RAISE EXCEPTION 'at bar exceeds received';
      END IF;
      UPDATE public.procurement_tasks
      SET quantity_at_bar = quantity_at_bar + got, updated_at = now()
      WHERE id = task.id;
    ELSE
      IF task.quantity_received + got > task.quantity_purchased THEN
        RAISE EXCEPTION 'received exceeds purchased';
      END IF;
      UPDATE public.procurement_tasks
      SET quantity_received = quantity_received + got,
          quantity_at_bar = quantity_at_bar + got,
          updated_at = now()
      WHERE id = task.id;
    END IF;
    UPDATE public.shipment_items
    SET quantity_confirmed = got
    WHERE shipment_id = ship.id AND procurement_task_id = item.procurement_task_id;
    ped := item.order_id;
    IF got > 0 AND item.product_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.estoque_movimentos m
      WHERE m.bar_id = dest.bar_id
        AND m.produto_id = item.product_id
        AND m.obs = obs || ' ' || left(item.procurement_task_id::text, 8)
    ) THEN
      INSERT INTO public.estoque_movimentos (produto_id, bar_id, tipo, qtd, criado_por, obs)
      VALUES (item.product_id, dest.bar_id, 'entrada', got, auth.uid(), obs || ' ' || left(item.procurement_task_id::text, 8));
    END IF;
  END LOOP;

  UPDATE public.shipments
  SET bar_confirmed_at = now(),
      status = CASE WHEN p_status = 'partial' THEN 'partial' ELSE status END,
      notes = COALESCE(p_note, notes),
      updated_at = now()
  WHERE id = ship.id;

  IF p_status <> 'received' THEN
    PERFORM public._fulfillment_alert(ped, NULL, 'jbm', NULL, dest.bar_id,
      'order_exception', 'Partial receipt', COALESCE(p_note, 'The bar did not confirm the full shipment.'));
    PERFORM public._touch_fulfillment(ped, CASE WHEN p_status = 'not_received' THEN 'exception' ELSE 'partially_delivered' END);
  END IF;

  PERFORM public._close_order_if_covered(ped);
  PERFORM public._fulfillment_audit('confirm_bar_shipment', 'shipments', ship.id,
    jsonb_build_object('status', p_status));
  RETURN jsonb_build_object('shipment_id', ship.id, 'status', p_status);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_bar_shipment(uuid, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_bar_shipment(uuid, text, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fallback_task(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task public.procurement_tasks%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO task FROM public.procurement_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found';
  END IF;
  IF NOT (public.is_procurement_hq() OR task.assigned_to = auth.uid()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF task.status NOT IN ('draft', 'planned', 'assigned', 'waiting_purchase', 'purchasing', 'exception')
     OR task.quantity_purchased > 0
     OR task.quantity_received > 0
     OR task.quantity_at_bar > 0
     OR EXISTS (
       SELECT 1
       FROM public.shipment_items si
       JOIN public.shipments s ON s.id = si.shipment_id
       WHERE si.procurement_task_id = task.id
         AND s.status <> 'cancelled'
     )
     OR EXISTS (
       SELECT 1 FROM public.purchase_lines l WHERE l.procurement_task_id = task.id
     )
     OR EXISTS (
       SELECT 1 FROM public.procurement_stock_moves m WHERE m.procurement_task_id = task.id
     ) THEN
    RAISE EXCEPTION 'cannot fallback a task after purchase or shipment';
  END IF;
  UPDATE public.procurement_tasks
  SET status = 'cancelled', updated_at = now()
  WHERE id = task.id;
  PERFORM public._fulfillment_audit('fallback_task', 'procurement_tasks', task.id,
    jsonb_build_object('status', 'cancelled'));
  IF task.assignment_id IS NOT NULL THEN
    UPDATE public.order_supplier_assignments
    SET status = 'cancelled', updated_at = now()
    WHERE id = task.assignment_id
      AND status NOT IN ('delivered', 'cancelled');
  END IF;
  PERFORM public._fulfillment_alert(
    task.order_id, task.assignment_id, 'jbm', NULL, (SELECT bar_id FROM public.pedidos WHERE id = task.order_id),
    'order_exception', 'Fallback', 'A procurement task was released so another source can take it.'
  );
  RETURN public.plan_procurement(task.order_id, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.fallback_task(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fallback_task(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.flag_deadline_exception(p_task_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task public.procurement_tasks%ROWTYPE;
  ped_bar uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO task FROM public.procurement_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found';
  END IF;
  IF NOT (
    public.is_procurement_hq()
    OR task.assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.procurement_sources s
      WHERE s.id = task.source_id
        AND s.fornecedor_id IN (SELECT public.my_supplier_ids())
    )
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF task.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid transition';
  END IF;
  UPDATE public.procurement_tasks
  SET status = 'exception', late = true, notes = COALESCE(p_note, notes), updated_at = now()
  WHERE id = task.id;
  SELECT bar_id INTO ped_bar FROM public.pedidos WHERE id = task.order_id;
  PERFORM public._touch_fulfillment(task.order_id, 'exception');
  PERFORM public._fulfillment_alert(task.order_id, task.assignment_id, 'jbm', NULL, ped_bar,
    'order_exception', 'Deadline missed', COALESCE(p_note, 'The source cannot meet the requested time.'));
  PERFORM public._fulfillment_audit('flag_deadline_exception', 'procurement_tasks', task.id,
    jsonb_build_object('note', p_note));
  RETURN jsonb_build_object('task_id', task.id, 'status', 'exception');
END;
$$;

REVOKE ALL ON FUNCTION public.flag_deadline_exception(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.flag_deadline_exception(uuid, text) TO authenticated;

-- Release only the units that were never purchased. Purchase rows stay.
CREATE OR REPLACE FUNCTION public.release_open_quantity(p_task_id uuid, p_qty integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task public.procurement_tasks%ROWTYPE;
  new_alloc integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'quantity required';
  END IF;
  SELECT * INTO task FROM public.procurement_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task not found';
  END IF;
  IF NOT (public.is_procurement_hq() OR task.assigned_to = auth.uid()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF task.quantity_purchased > 0 AND p_qty > task.quantity_allocated - task.quantity_purchased THEN
    RAISE EXCEPTION 'quantity exceeds the task';
  END IF;
  IF task.status IN ('completed', 'cancelled', 'in_transit', 'received')
     OR task.quantity_received > 0
     OR task.quantity_at_bar > 0 THEN
    RAISE EXCEPTION 'cannot fallback a task after purchase or shipment';
  END IF;
  IF p_qty > task.quantity_allocated - task.quantity_purchased THEN
    RAISE EXCEPTION 'quantity exceeds the task';
  END IF;
  IF p_qty = task.quantity_allocated AND task.quantity_purchased = 0 THEN
    RETURN public.fallback_task(p_task_id);
  END IF;
  new_alloc := task.quantity_allocated - p_qty;
  UPDATE public.procurement_tasks
  SET quantity_allocated = new_alloc,
      quantity_requested = new_alloc,
      status = CASE WHEN task.quantity_purchased >= new_alloc THEN 'purchased' ELSE status END,
      updated_at = now()
  WHERE id = task.id;
  PERFORM public._fulfillment_audit('release_open_quantity', 'procurement_tasks', task.id,
    jsonb_build_object('released', p_qty, 'allocated', new_alloc));
  RETURN public.plan_procurement(task.order_id, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.release_open_quantity(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_open_quantity(uuid, integer) TO authenticated;

-- ── reads ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_procurement_tracking(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ped public.pedidos%ROWTYPE;
  audience text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO ped FROM public.pedidos WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;
  IF public.is_procurement_hq() THEN
    audience := 'jbm';
  ELSIF public.user_can_access_bar(ped.bar_id) THEN
    audience := 'bar';
  ELSIF EXISTS (
    SELECT 1
    FROM public.procurement_tasks t
    JOIN public.procurement_sources s ON s.id = t.source_id
    WHERE t.order_id = p_order_id
      AND s.fornecedor_id IN (SELECT public.my_supplier_ids())
  ) THEN
    audience := 'supplier';
  ELSIF EXISTS (
    SELECT 1 FROM public.procurement_tasks t
    WHERE t.order_id = p_order_id AND t.assigned_to = auth.uid()
  ) THEN
    audience := 'employee';
  ELSE
    RAISE EXCEPTION 'not allowed';
  END IF;

  RETURN jsonb_build_object(
    'order_id', ped.id,
    'public_code', ped.public_code,
    'audience', audience,
    'requested_delivery', COALESCE(ped.entrega_desejada, ped.data_entrega_prevista),
    'lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'order_item_id', i.id,
        'product', pr.nome,
        'quantity', CASE
          WHEN audience = 'supplier' THEN COALESCE((
            SELECT SUM(t.quantity_allocated)
            FROM public.procurement_tasks t
            JOIN public.procurement_sources s ON s.id = t.source_id
            WHERE t.order_item_id = i.id
              AND t.status <> 'cancelled'
              AND s.fornecedor_id IN (SELECT public.my_supplier_ids())
          ), 0)
          WHEN audience = 'employee' THEN COALESCE((
            SELECT SUM(t.quantity_allocated)
            FROM public.procurement_tasks t
            WHERE t.order_item_id = i.id
              AND t.status <> 'cancelled'
              AND t.assigned_to = auth.uid()
          ), 0)
          ELSE i.qtd
        END,
        'at_bar', CASE
          WHEN audience = 'supplier' THEN NULL
          WHEN audience = 'employee' THEN COALESCE((
            SELECT SUM(t.quantity_at_bar)
            FROM public.procurement_tasks t
            WHERE t.order_item_id = i.id
              AND t.status <> 'cancelled'
              AND t.assigned_to = auth.uid()
          ), 0)
          ELSE COALESCE((
            SELECT SUM(t.quantity_at_bar) FROM public.procurement_tasks t
            WHERE t.order_item_id = i.id AND t.status <> 'cancelled'
          ), 0)
        END,
        'sale_price', CASE
          WHEN audience IN ('jbm', 'bar') THEN public.resolve_bar_price(ped.bar_id, i.produto_id, now(), i.qtd)
          ELSE NULL
        END,
        'tasks', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', t.id,
            'assignment_id', t.assignment_id,
            'task_number', t.task_number,
            'quantity', t.quantity_allocated,
            'status', t.status,
            'late', t.late,
            'buy_by_at', CASE WHEN audience = 'bar' THEN NULL ELSE t.buy_by_at END,
            'method', CASE WHEN audience IN ('bar', 'supplier') THEN NULL ELSE t.procurement_method END,
            'source_name', CASE WHEN audience = 'jbm' THEN t.source_company ELSE NULL END,
            'expected_unit_cost', CASE
              WHEN audience = 'jbm' THEN t.expected_unit_cost
              WHEN audience = 'employee' AND t.assigned_to = auth.uid() THEN t.expected_unit_cost
              ELSE NULL
            END,
            'actual_total_cost', CASE WHEN audience = 'jbm' THEN t.actual_total_cost ELSE NULL END,
            'supplier_assignment_status', CASE
              WHEN audience IN ('jbm', 'supplier') THEN (
                SELECT a.status FROM public.order_supplier_assignments a WHERE a.id = t.assignment_id
              )
              ELSE NULL
            END,
            'supplier_marked_delivered', COALESCE((
              SELECT a.status IN ('delivered', 'in_transit', 'partial')
              FROM public.order_supplier_assignments a WHERE a.id = t.assignment_id
            ), false),
            'stock_received', t.quantity_received > 0
          ) ORDER BY t.task_number)
          FROM public.procurement_tasks t
          LEFT JOIN public.procurement_sources s ON s.id = t.source_id
          WHERE t.order_item_id = i.id
            AND t.status <> 'cancelled'
            AND (
              audience = 'jbm'
              OR audience = 'bar'
              OR (audience = 'employee' AND t.assigned_to = auth.uid())
              OR (audience = 'supplier' AND s.fornecedor_id IN (SELECT public.my_supplier_ids()))
            )
        ), '[]'::jsonb)
      ))
      FROM public.pedidos_itens i
      LEFT JOIN public.produtos pr ON pr.id = i.produto_id
      WHERE i.pedido_id = ped.id
        AND (
          audience IN ('jbm', 'bar')
          OR (
            audience = 'supplier'
            AND EXISTS (
              SELECT 1
              FROM public.procurement_tasks t
              JOIN public.procurement_sources s ON s.id = t.source_id
              WHERE t.order_item_id = i.id
                AND t.status <> 'cancelled'
                AND s.fornecedor_id IN (SELECT public.my_supplier_ids())
            )
          )
          OR (
            audience = 'employee'
            AND EXISTS (
              SELECT 1
              FROM public.procurement_tasks t
              WHERE t.order_item_id = i.id
                AND t.status <> 'cancelled'
                AND t.assigned_to = auth.uid()
            )
          )
        )
    ), '[]'::jsonb),
    'shipments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id,
        'code', s.public_code,
        'status', s.status,
        'expected_at', s.expected_at,
        'logistics_cost', CASE WHEN audience = 'jbm' THEN s.logistics_cost ELSE NULL END
      ) ORDER BY s.created_at)
      FROM public.shipments s
      LEFT JOIN public.locations dest ON dest.id = s.to_location_id
      WHERE s.order_id = ped.id
        AND s.status <> 'cancelled'
        AND (
          audience = 'jbm'
          OR (audience = 'bar' AND dest.bar_id = ped.bar_id)
          OR (
            audience = 'employee'
            AND EXISTS (
              SELECT 1
              FROM public.shipment_items si
              JOIN public.procurement_tasks mine ON mine.id = si.procurement_task_id
              WHERE si.shipment_id = s.id
                AND mine.assigned_to = auth.uid()
            )
          )
        )
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_procurement_tracking(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_procurement_tracking(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_procurement_board()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today date;
  tomorrow date;
BEGIN
  IF NOT public.is_procurement_hq() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  today := timezone('Asia/Tokyo', now())::date;
  tomorrow := today + 1;
  RETURN jsonb_build_object(
    'late', COALESCE((SELECT jsonb_agg(t.id) FROM public.procurement_tasks t WHERE t.status NOT IN ('completed','cancelled','received','partially_received') AND t.buy_by_at < now()), '[]'::jsonb),
    'due_today', COALESCE((SELECT jsonb_agg(t.id) FROM public.procurement_tasks t WHERE t.status NOT IN ('completed','cancelled') AND timezone('Asia/Tokyo', t.buy_by_at)::date = today), '[]'::jsonb),
    'due_tomorrow', COALESCE((SELECT jsonb_agg(t.id) FROM public.procurement_tasks t WHERE t.status NOT IN ('completed','cancelled') AND timezone('Asia/Tokyo', t.buy_by_at)::date = tomorrow), '[]'::jsonb),
    'waiting_purchase', COALESCE((SELECT jsonb_agg(t.id) FROM public.procurement_tasks t WHERE t.status IN ('assigned','waiting_purchase','purchasing')), '[]'::jsonb),
    'waiting_supplier', COALESCE((SELECT jsonb_agg(t.id) FROM public.procurement_tasks t WHERE t.procurement_method = 'SUPPLIER' AND t.status IN ('assigned','waiting_purchase')), '[]'::jsonb),
    'waiting_employee', COALESCE((SELECT jsonb_agg(t.id) FROM public.procurement_tasks t WHERE t.assigned_to IS NOT NULL AND t.procurement_method IN ('EMPLOYEE','ONLINE','PHYSICAL_STORE','DIRECT') AND t.status IN ('assigned','waiting_purchase','purchasing')), '[]'::jsonb),
    'purchased', COALESCE((SELECT jsonb_agg(t.id) FROM public.procurement_tasks t WHERE t.status = 'purchased'), '[]'::jsonb),
    'in_transit', COALESCE((SELECT jsonb_agg(t.id) FROM public.procurement_tasks t WHERE t.status = 'in_transit'), '[]'::jsonb),
    'awaiting_receipt', COALESCE((SELECT jsonb_agg(t.id) FROM public.procurement_tasks t WHERE t.status IN ('purchased','in_transit','partially_received')), '[]'::jsonb),
    'problem', COALESCE((SELECT jsonb_agg(t.id) FROM public.procurement_tasks t WHERE t.status = 'exception' OR t.late), '[]'::jsonb),
    'delivery_today', COALESCE((SELECT jsonb_agg(s.id) FROM public.shipments s WHERE s.status NOT IN ('cancelled','delivered') AND timezone('Asia/Tokyo', s.expected_at)::date = today), '[]'::jsonb),
    'incomplete', COALESCE((SELECT jsonb_agg(t.id) FROM public.procurement_tasks t WHERE t.status NOT IN ('completed','cancelled') AND t.quantity_at_bar < t.quantity_allocated), '[]'::jsonb),
    'economics', (
      SELECT jsonb_build_object(
        'revenue', COALESCE(SUM(COALESCE(public.resolve_bar_price(p.bar_id, t.product_id, COALESCE(t.requested_delivery_at, now()), t.quantity_allocated), 0) * t.quantity_allocated), 0),
        'purchase_cost', COALESCE(SUM(costs.purchase), 0),
        'freight', COALESCE(SUM(costs.freight), 0),
        'fees', COALESCE(SUM(costs.fees), 0),
        'logistics_cost', COALESCE(SUM(costs.logistics), 0),
        'margin', COALESCE(SUM(
          COALESCE(public.resolve_bar_price(p.bar_id, t.product_id, COALESCE(t.requested_delivery_at, now()), t.quantity_allocated), 0) * t.quantity_allocated
          - COALESCE(costs.purchase, 0) - COALESCE(costs.freight, 0) - COALESCE(costs.fees, 0) - COALESCE(costs.logistics, 0)
        ), 0)
      )
      FROM public.procurement_tasks t
      JOIN public.pedidos p ON p.id = t.order_id
      LEFT JOIN LATERAL (
        SELECT
          (SELECT COALESCE(SUM(l.quantity * l.unit_cost), 0) FROM public.purchase_lines l WHERE l.procurement_task_id = t.id) AS purchase,
          (SELECT COALESCE(SUM(pt.freight), 0)
            FROM public.purchase_transactions pt
            JOIN public.purchase_lines l ON l.purchase_id = pt.id
            WHERE l.procurement_task_id = t.id) AS freight,
          (SELECT COALESCE(SUM(pt.fees), 0)
            FROM public.purchase_transactions pt
            JOIN public.purchase_lines l ON l.purchase_id = pt.id
            WHERE l.procurement_task_id = t.id) AS fees,
          (SELECT COALESCE(SUM(
              s.logistics_cost * si.quantity / NULLIF((
                SELECT SUM(all_items.quantity) FROM public.shipment_items all_items WHERE all_items.shipment_id = s.id
              ), 0)
            ), 0)
            FROM public.shipment_items si
            JOIN public.shipments s ON s.id = si.shipment_id
            WHERE si.procurement_task_id = t.id
              AND s.status <> 'cancelled') AS logistics
      ) costs ON true
      WHERE t.status <> 'cancelled'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_procurement_board() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_procurement_board() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_procurement_tasks_hq()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_procurement_hq() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', t.id,
      'task_number', t.task_number,
      'order_id', t.order_id,
      'status', t.status,
      'quantity_allocated', t.quantity_allocated,
      'quantity_purchased', t.quantity_purchased,
      'quantity_received', t.quantity_received,
      'quantity_at_bar', t.quantity_at_bar,
      'procurement_method', t.procurement_method,
      'source_company', t.source_company,
      'late', t.late,
      'buy_by_at', t.buy_by_at,
      'supplier_assignment_status', a.status
    ) ORDER BY t.created_at DESC)
    FROM public.procurement_tasks t
    LEFT JOIN public.order_supplier_assignments a ON a.id = t.assignment_id
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_procurement_tasks_hq() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_procurement_tasks_hq() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_procurement_tasks()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.perfis p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'jbm', 'funcionario')
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  RETURN jsonb_build_object(
    'tasks', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', t.id,
      'task_number', t.task_number,
      'order_id', t.order_id,
      'status', t.status,
      'quantity_allocated', t.quantity_allocated,
      'quantity_purchased', t.quantity_purchased,
      'quantity_received', t.quantity_received,
      'quantity_at_bar', t.quantity_at_bar,
      'method', t.procurement_method,
      'source_name', t.source_company,
      'purchase_url', t.purchase_url,
      'expected_unit_cost', t.expected_unit_cost,
      'buy_by_at', t.buy_by_at,
      'requested_delivery_at', t.requested_delivery_at,
      'product_id', t.product_id,
      'source_id', t.source_id
    ) ORDER BY t.buy_by_at NULLS LAST)
    FROM public.procurement_tasks t
    WHERE t.assigned_to = auth.uid()
      AND t.status NOT IN ('cancelled', 'completed')
  ), '[]'::jsonb),
    'locations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'type', l.type) ORDER BY l.name)
      FROM public.locations l
      WHERE l.active AND l.type IN ('WAREHOUSE', 'STORE', 'SUPPLIER', 'OTHER')
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_procurement_tasks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_procurement_tasks() TO authenticated;

-- Supplier portal still calls supplier_advance. When a procurement task is
-- linked, reject replans the remainder and purchased requires a cost.
CREATE OR REPLACE FUNCTION public.supplier_advance(
  p_assignment_id uuid,
  p_action text,
  p_note text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  asg public.order_supplier_assignments%ROWTYPE;
  nxt text;
  ev text;
  line jsonb;
  item_id uuid;
  qty integer;
  ped_bar uuid;
  task record;
  linked boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO asg FROM public.order_supplier_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment not found';
  END IF;
  IF NOT (public.is_jbm() OR asg.supplier_id IN (SELECT public.my_supplier_ids())) THEN
    RAISE EXCEPTION 'supplier not allowed';
  END IF;

  nxt := public.fulfillment_next_status(asg.status, p_action);
  ev := CASE p_action
    WHEN 'accept' THEN 'accepted'
    WHEN 'reject' THEN 'rejected'
    WHEN 'start_purchase' THEN 'purchasing'
    WHEN 'purchased' THEN 'purchased'
    WHEN 'received' THEN 'received'
    WHEN 'preparing' THEN 'preparing'
    WHEN 'ready' THEN 'ready'
    WHEN 'in_transit' THEN 'in_transit'
    WHEN 'partial' THEN 'partial'
    WHEN 'delivered' THEN 'delivered'
    ELSE 'issue'
  END;

  UPDATE public.order_supplier_assignments
  SET status = nxt,
      updated_at = now(),
      confirmed_at = CASE WHEN p_action = 'accept' THEN now() ELSE confirmed_at END,
      delivered_at = CASE WHEN p_action = 'delivered' THEN now() ELSE delivered_at END,
      expected_delivery_at = COALESCE(
        NULLIF(p_payload->>'expected_delivery_at','')::timestamptz,
        expected_delivery_at
      ),
      notes = COALESCE(p_note, notes)
  WHERE id = asg.id;

  IF p_action = 'start_purchase' THEN
    INSERT INTO public.supplier_purchase_requests (supplier_id, assignment_id, status, expected_at, notes, public_code)
    VALUES (asg.supplier_id, asg.id, 'open', asg.expected_delivery_at, p_note, public.next_ops_code('SUP'))
    ON CONFLICT (assignment_id) DO UPDATE
      SET public_code = COALESCE(public.supplier_purchase_requests.public_code, EXCLUDED.public_code);
  ELSIF p_action = 'purchased' THEN
    UPDATE public.supplier_purchase_requests
    SET status = 'purchased', completed_at = now(), notes = COALESCE(p_note, notes)
    WHERE assignment_id = asg.id;
  END IF;

  IF p_payload ? 'lines' THEN
    FOR line IN SELECT * FROM jsonb_array_elements(p_payload->'lines')
    LOOP
      item_id := NULLIF(line->>'order_item_id','')::uuid;
      qty := NULLIF(line->>'quantity','')::integer;
      UPDATE public.order_supplier_items
      SET quantity_confirmed = CASE WHEN p_action IN ('accept','issue') THEN COALESCE(qty, quantity_confirmed) ELSE quantity_confirmed END,
          quantity_purchased = CASE WHEN p_action = 'purchased' THEN COALESCE(qty, quantity_requested) ELSE quantity_purchased END,
          quantity_delivered = CASE WHEN p_action IN ('delivered','partial') THEN COALESCE(qty, quantity_requested) ELSE quantity_delivered END,
          issue_type = COALESCE(line->>'issue_type', issue_type),
          issue_note = COALESCE(line->>'issue_note', issue_note),
          status = nxt,
          updated_at = now()
      WHERE assignment_id = asg.id
        AND (item_id IS NULL OR order_item_id = item_id);
    END LOOP;
  ELSIF p_action = 'accept' THEN
    UPDATE public.order_supplier_items
    SET quantity_confirmed = quantity_requested, status = 'accepted', updated_at = now()
    WHERE assignment_id = asg.id AND quantity_confirmed IS NULL;
  END IF;

  INSERT INTO public.fulfillment_events (order_id, assignment_id, event_type, actor_user_id, actor_type, note, metadata)
  VALUES (asg.order_id, asg.id, ev, auth.uid(), CASE WHEN public.is_jbm() THEN 'jbm' ELSE 'supplier' END, p_note, COALESCE(p_payload, '{}'::jsonb) - 'lines')
  ON CONFLICT DO NOTHING;

  SELECT EXISTS (SELECT 1 FROM public.procurement_tasks t WHERE t.assignment_id = asg.id) INTO linked;

  IF linked AND p_action = 'purchased' THEN
    FOR task IN
      SELECT t.id, t.quantity_allocated, t.quantity_purchased, t.expected_unit_cost
      FROM public.procurement_tasks t
      WHERE t.assignment_id = asg.id
        AND t.status NOT IN ('cancelled', 'completed', 'purchased')
    LOOP
      PERFORM public.record_purchase(task.id, jsonb_build_object(
        'quantity', task.quantity_allocated - task.quantity_purchased,
        'unit_cost', COALESCE(NULLIF(p_payload->>'unit_cost', '')::numeric, task.expected_unit_cost),
        'receipt_note', p_note,
        'external_reference', p_payload->>'external_reference',
        'purchased_at', COALESCE(NULLIF(p_payload->>'purchased_at', '')::timestamptz, now())
      ));
    END LOOP;
  ELSIF linked AND p_action = 'reject' THEN
    IF EXISTS (
      SELECT 1 FROM public.procurement_tasks t
      WHERE t.assignment_id = asg.id
        AND t.status <> 'cancelled'
        AND (
          t.quantity_purchased > 0
          OR t.quantity_received > 0
          OR t.quantity_at_bar > 0
          OR t.status NOT IN ('draft', 'planned', 'assigned', 'waiting_purchase', 'purchasing', 'exception')
          OR EXISTS (SELECT 1 FROM public.purchase_lines l WHERE l.procurement_task_id = t.id)
          OR EXISTS (SELECT 1 FROM public.procurement_stock_moves m WHERE m.procurement_task_id = t.id)
          OR EXISTS (
            SELECT 1 FROM public.shipment_items si
            JOIN public.shipments s ON s.id = si.shipment_id
            WHERE si.procurement_task_id = t.id AND s.status <> 'cancelled'
          )
        )
    ) THEN
      RAISE EXCEPTION 'cannot fallback a task after purchase or shipment';
    END IF;
    UPDATE public.procurement_tasks
    SET status = 'cancelled', updated_at = now()
    WHERE assignment_id = asg.id AND status NOT IN ('completed', 'cancelled');
  ELSIF linked AND p_action = 'issue' THEN
    UPDATE public.procurement_tasks
    SET status = 'exception', late = true, notes = COALESCE(p_note, notes), updated_at = now()
    WHERE assignment_id = asg.id AND status NOT IN ('completed', 'cancelled');
  ELSIF linked AND p_action = 'accept' THEN
    UPDATE public.procurement_tasks
    SET status = 'waiting_purchase', updated_at = now()
    WHERE assignment_id = asg.id AND status IN ('assigned', 'exception', 'planned');
  ELSIF linked AND p_action = 'start_purchase' THEN
    UPDATE public.procurement_tasks
    SET status = 'purchasing', updated_at = now()
    WHERE assignment_id = asg.id AND status IN ('assigned', 'waiting_purchase');
  END IF;
  -- in_transit, delivered, partial and received change only the assignment.
  -- They do not change quantity_received, stock, estoque_movimentos or pedidos.status.

  IF linked AND p_action = 'accept' THEN
    PERFORM public.flag_deadline_exception(t.id, 'Accepted after the requested delivery')
    FROM public.procurement_tasks t
    JOIN public.pedidos p ON p.id = t.order_id
    WHERE t.assignment_id = asg.id
      AND t.status NOT IN ('completed', 'cancelled')
      AND COALESCE(p.entrega_desejada, (p.data_entrega_prevista::timestamp + time '18:00') AT TIME ZONE 'Asia/Tokyo')
          < COALESCE(NULLIF(p_payload->>'expected_delivery_at','')::timestamptz, asg.expected_delivery_at, now());
  END IF;

  IF p_action = 'reject' THEN
    IF linked THEN
      PERFORM public.plan_procurement(asg.order_id, NULL);
    ELSE
      PERFORM public.route_pedido(asg.order_id);
      IF NOT EXISTS (
        SELECT 1 FROM public.order_supplier_assignments a
        WHERE a.order_id = asg.order_id AND a.status NOT IN ('rejected','cancelled')
      ) THEN
        PERFORM public._touch_fulfillment(asg.order_id, 'exception');
        SELECT bar_id INTO ped_bar FROM public.pedidos WHERE id = asg.order_id;
        PERFORM public._fulfillment_alert(asg.order_id, asg.id, 'jbm', NULL, ped_bar,
          'order_exception', 'Backup also refused', 'No supplier accepted this order.');
      END IF;
    END IF;
  ELSE
    PERFORM public._rollup_order_status(asg.order_id);
  END IF;

  IF p_action = 'issue' THEN
    SELECT bar_id INTO ped_bar FROM public.pedidos WHERE id = asg.order_id;
    PERFORM public._fulfillment_alert(asg.order_id, asg.id, 'jbm', asg.supplier_id, ped_bar,
      'supplier_issue', 'Supplier issue', COALESCE(p_note, 'The supplier reported a problem.'));
  ELSIF p_action = 'in_transit' THEN
    SELECT bar_id INTO ped_bar FROM public.pedidos WHERE id = asg.order_id;
    PERFORM public._fulfillment_alert(asg.order_id, asg.id, 'bar', NULL, ped_bar,
      'order_in_transit', 'On the way', 'Your drink order is in transit.');
  ELSIF p_action = 'delivered' THEN
    SELECT bar_id INTO ped_bar FROM public.pedidos WHERE id = asg.order_id;
    PERFORM public._fulfillment_alert(asg.order_id, asg.id, 'bar', NULL, ped_bar,
      'order_delivered', 'Delivered', 'Confirm what you received.');
  END IF;

  PERFORM public._fulfillment_audit('supplier_advance', 'order_supplier_assignments', asg.id,
    jsonb_build_object('from', asg.status, 'to', nxt, 'action', p_action));

  RETURN jsonb_build_object('assignment_id', asg.id, 'status', nxt);
END;
$$;

-- Legacy bar confirmation. Procurement tasks use confirm_bar_shipment instead,
-- so this path cannot stock the bar twice or mark the order delivered early.
CREATE OR REPLACE FUNCTION public.bar_confirm_delivery(
  p_order_id uuid,
  p_status text,
  p_received integer DEFAULT NULL,
  p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ped public.pedidos%ROWTYPE;
  expected integer;
  got integer;
  obs text;
  ff text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_status NOT IN ('received_all','partial','not_received') THEN
    RAISE EXCEPTION 'invalid confirmation';
  END IF;

  SELECT * INTO ped FROM public.pedidos WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found';
  END IF;
  IF NOT (public.user_can_access_bar(ped.bar_id) OR public.is_procurement_hq()) THEN
    RAISE EXCEPTION 'bar not allowed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.procurement_tasks t
    WHERE t.order_id = p_order_id AND t.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'confirm the shipment';
  END IF;
  IF EXISTS (SELECT 1 FROM public.delivery_confirmations d WHERE d.order_id = p_order_id) THEN
    RAISE EXCEPTION 'delivery already confirmed';
  END IF;

  SELECT COALESCE(SUM(i.qtd), 0) INTO expected
  FROM public.pedidos_itens i WHERE i.pedido_id = p_order_id;

  got := CASE p_status
    WHEN 'received_all' THEN expected
    WHEN 'not_received' THEN 0
    ELSE COALESCE(p_received, 0)
  END;

  INSERT INTO public.delivery_confirmations (
    order_id, confirmed_by, status, quantity_expected, quantity_received, note
  ) VALUES (p_order_id, auth.uid(), p_status, expected, got, p_note);

  obs := 'JBM delivery ' || left(p_order_id::text, 8);
  IF p_status = 'received_all' AND NOT EXISTS (
    SELECT 1 FROM public.estoque_movimentos m
    WHERE m.bar_id = ped.bar_id AND m.obs = obs
  ) THEN
    INSERT INTO public.estoque_movimentos (produto_id, bar_id, tipo, qtd, criado_por, obs)
    SELECT i.produto_id, ped.bar_id, 'entrada', i.qtd, auth.uid(), obs
    FROM public.pedidos_itens i
    WHERE i.pedido_id = p_order_id AND i.produto_id IS NOT NULL AND i.qtd > 0;
  END IF;

  IF p_status = 'received_all' THEN
    ff := 'completed';
    UPDATE public.pedidos SET status = 'entregue' WHERE id = p_order_id;
  ELSIF p_status = 'partial' THEN
    ff := 'partially_delivered';
    PERFORM public._fulfillment_alert(p_order_id, NULL, 'jbm', NULL, ped.bar_id,
      'order_exception', 'Partial receipt', COALESCE(p_note, 'The bar received less than ordered.'));
  ELSE
    ff := 'exception';
    PERFORM public._fulfillment_alert(p_order_id, NULL, 'jbm', NULL, ped.bar_id,
      'order_exception', 'Not received', COALESCE(p_note, 'The bar did not receive the order.'));
  END IF;

  PERFORM public._touch_fulfillment(p_order_id, ff);
  INSERT INTO public.fulfillment_events (order_id, event_type, actor_user_id, actor_type, note, metadata)
  VALUES (p_order_id, 'bar_confirmed', auth.uid(), 'bar', p_note,
    jsonb_build_object('status', p_status, 'expected', expected, 'received', got));

  PERFORM public._fulfillment_alert(p_order_id, NULL, 'jbm', NULL, ped.bar_id,
    'bar_delivery_confirmed', 'Bar confirmed', p_status);
  PERFORM public._fulfillment_audit('bar_confirm_delivery', 'pedidos', p_order_id,
    jsonb_build_object('status', p_status, 'expected', expected, 'received', got));

  RETURN jsonb_build_object('order_id', p_order_id, 'status', ff, 'received', got, 'expected', expected);
END;
$$;

REVOKE ALL ON FUNCTION public.bar_confirm_delivery(uuid, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bar_confirm_delivery(uuid, text, integer, text) TO authenticated;

-- ── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.procurement_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_source_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bar_product_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.replenishment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_stock_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._audit_bar_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._fulfillment_audit(
    lower(TG_OP),
    'bar_product_prices',
    COALESCE(NEW.id, OLD.id),
    jsonb_build_object(
      'bar_id', COALESCE(NEW.bar_id, OLD.bar_id),
      'product_id', COALESCE(NEW.product_id, OLD.product_id),
      'sale_price', CASE WHEN TG_OP = 'DELETE' THEN OLD.sale_price ELSE NEW.sale_price END,
      'previous_sale_price', CASE WHEN TG_OP = 'UPDATE' THEN OLD.sale_price ELSE NULL END
    )
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public._audit_bar_price() FROM PUBLIC;

DROP TRIGGER IF EXISTS bar_product_prices_audit ON public.bar_product_prices;
CREATE TRIGGER bar_product_prices_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.bar_product_prices
  FOR EACH ROW EXECUTE FUNCTION public._audit_bar_price();

DROP POLICY IF EXISTS procurement_sources_hq ON public.procurement_sources;
CREATE POLICY procurement_sources_hq ON public.procurement_sources
  FOR ALL TO authenticated
  USING (public.is_procurement_hq()) WITH CHECK (public.is_procurement_hq());

DROP POLICY IF EXISTS procurement_sources_supplier ON public.procurement_sources;
CREATE POLICY procurement_sources_supplier ON public.procurement_sources
  FOR SELECT TO authenticated
  USING (fornecedor_id IN (SELECT public.my_supplier_ids()));

DROP POLICY IF EXISTS psp_hq ON public.procurement_source_products;
CREATE POLICY psp_hq ON public.procurement_source_products
  FOR ALL TO authenticated
  USING (public.is_procurement_hq()) WITH CHECK (public.is_procurement_hq());

DROP POLICY IF EXISTS psp_supplier ON public.procurement_source_products;
CREATE POLICY psp_supplier ON public.procurement_source_products
  FOR SELECT TO authenticated
  USING (source_id IN (
    SELECT s.id FROM public.procurement_sources s
    WHERE s.fornecedor_id IN (SELECT public.my_supplier_ids())
  ));

DROP POLICY IF EXISTS prr_hq ON public.procurement_routing_rules;
CREATE POLICY prr_hq ON public.procurement_routing_rules
  FOR ALL TO authenticated
  USING (public.is_procurement_hq()) WITH CHECK (public.is_procurement_hq());

DROP POLICY IF EXISTS ptask_read ON public.procurement_tasks;
DROP POLICY IF EXISTS ptask_read_hq ON public.procurement_tasks;
CREATE POLICY ptask_read_hq ON public.procurement_tasks
  FOR SELECT TO authenticated
  USING ((SELECT public.is_procurement_hq()));

DROP POLICY IF EXISTS purchases_read ON public.purchase_transactions;
CREATE POLICY purchases_read ON public.purchase_transactions
  FOR SELECT TO authenticated
  USING (
    public.is_procurement_hq()
    OR buyer_user_id = auth.uid()
  );

DROP POLICY IF EXISTS purchase_lines_read ON public.purchase_lines;
CREATE POLICY purchase_lines_read ON public.purchase_lines
  FOR SELECT TO authenticated
  USING (
    public.is_procurement_hq()
    OR EXISTS (
      SELECT 1 FROM public.procurement_tasks t
      WHERE t.id = procurement_task_id AND t.assigned_to = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.purchase_transactions p
      WHERE p.id = purchase_id AND p.buyer_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS shipments_hq ON public.shipments;
CREATE POLICY shipments_hq ON public.shipments
  FOR SELECT TO authenticated
  USING (
    public.is_procurement_hq()
    OR responsible_user_id = auth.uid()
  );

DROP POLICY IF EXISTS shipment_items_read ON public.shipment_items;
CREATE POLICY shipment_items_read ON public.shipment_items
  FOR SELECT TO authenticated
  USING (
    public.is_procurement_hq()
    OR EXISTS (
      SELECT 1 FROM public.procurement_tasks t
      WHERE t.id = procurement_task_id AND t.assigned_to = auth.uid()
    )
  );

DROP POLICY IF EXISTS locations_hq ON public.locations;
CREATE POLICY locations_hq ON public.locations
  FOR ALL TO authenticated
  USING (public.is_procurement_hq()) WITH CHECK (public.is_procurement_hq());

DROP POLICY IF EXISTS locations_bar ON public.locations;
CREATE POLICY locations_bar ON public.locations
  FOR SELECT TO authenticated
  USING (type = 'BAR' AND bar_id IS NOT NULL AND public.user_can_access_bar(bar_id));

DROP POLICY IF EXISTS bar_prices_hq ON public.bar_product_prices;
CREATE POLICY bar_prices_hq ON public.bar_product_prices
  FOR ALL TO authenticated
  USING (public.is_procurement_hq()) WITH CHECK (public.is_procurement_hq());

DROP POLICY IF EXISTS bar_prices_bar ON public.bar_product_prices;
CREATE POLICY bar_prices_bar ON public.bar_product_prices
  FOR SELECT TO authenticated
  USING (public.user_can_access_bar(bar_id));

DROP POLICY IF EXISTS replenishment_hq ON public.replenishment_rules;
CREATE POLICY replenishment_hq ON public.replenishment_rules
  FOR ALL TO authenticated
  USING (public.is_procurement_hq()) WITH CHECK (public.is_procurement_hq());

DROP POLICY IF EXISTS proc_settings_hq ON public.procurement_settings;
CREATE POLICY proc_settings_hq ON public.procurement_settings
  FOR ALL TO authenticated
  USING (public.is_procurement_hq()) WITH CHECK (public.is_procurement_hq());

DROP POLICY IF EXISTS closures_hq ON public.ops_closures;
CREATE POLICY closures_hq ON public.ops_closures
  FOR ALL TO authenticated
  USING (public.is_procurement_hq()) WITH CHECK (public.is_procurement_hq());

DROP POLICY IF EXISTS counters_none ON public.ops_counters;
CREATE POLICY counters_none ON public.ops_counters
  FOR SELECT TO authenticated
  USING (public.is_procurement_hq());

DROP POLICY IF EXISTS stock_moves_hq ON public.procurement_stock_moves;
CREATE POLICY stock_moves_hq ON public.procurement_stock_moves
  FOR SELECT TO authenticated
  USING (public.is_procurement_hq());

DROP POLICY IF EXISTS idem_owner ON public.order_idempotency_keys;
CREATE POLICY idem_owner ON public.order_idempotency_keys
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_procurement_hq());

DROP POLICY IF EXISTS alerts_read ON public.fulfillment_alerts;
CREATE POLICY alerts_read ON public.fulfillment_alerts
  FOR SELECT TO authenticated
  USING (
    (audience = 'jbm' AND public.is_procurement_hq())
    OR (audience = 'supplier' AND supplier_id IN (SELECT public.my_supplier_ids()))
    OR (audience = 'bar' AND bar_id IS NOT NULL AND public.user_can_access_bar(bar_id))
    OR (audience = 'employee' AND assignee_user_id = auth.uid())
  );

DROP POLICY IF EXISTS alerts_read_update ON public.fulfillment_alerts;
CREATE POLICY alerts_read_update ON public.fulfillment_alerts
  FOR UPDATE TO authenticated
  USING (
    (audience = 'jbm' AND public.is_procurement_hq())
    OR (audience = 'supplier' AND supplier_id IN (SELECT public.my_supplier_ids()))
    OR (audience = 'bar' AND bar_id IS NOT NULL AND public.user_can_access_bar(bar_id))
    OR (audience = 'employee' AND assignee_user_id = auth.uid())
  )
  WITH CHECK (
    (audience = 'jbm' AND public.is_procurement_hq())
    OR (audience = 'supplier' AND supplier_id IN (SELECT public.my_supplier_ids()))
    OR (audience = 'bar' AND bar_id IS NOT NULL AND public.user_can_access_bar(bar_id))
    OR (audience = 'employee' AND assignee_user_id = auth.uid())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.procurement_sources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.procurement_source_products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.procurement_routing_rules TO authenticated;
GRANT SELECT ON public.procurement_tasks TO authenticated;
GRANT SELECT ON public.purchase_transactions TO authenticated;
GRANT SELECT ON public.purchase_lines TO authenticated;
GRANT SELECT ON public.shipments TO authenticated;
GRANT SELECT ON public.shipment_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.locations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bar_product_prices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.replenishment_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.procurement_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ops_closures TO authenticated;
GRANT SELECT ON public.ops_counters TO authenticated;
GRANT SELECT ON public.procurement_stock_moves TO authenticated;
GRANT SELECT ON public.order_idempotency_keys TO authenticated;


-- ===== sql/pos_floor.sql (backfill removed) =====

-- Atomic till floor. Open bottles sit on top of estoque_movimentos.
-- Sales stay in pos_vendas. Cash stays in caixa_movimentos.
-- Does not write vendas, faturas, or procurement tables.
-- Apply manually in the Supabase SQL editor. This repository does not apply it.
--
-- Stock rule (one path per line):
--   drink_menu line  -> pos_recipes / pos_recipe_lines. Millilitres come off an open bottle.
--                       A mixer line with quantity (and no ml) takes sealed units of THAT product only.
--                       A missing recipe blocks the sale. A recipe line cannot be both ml and units.
--   produto line     -> one sealed unit per quantity. No millilitre consumption.
-- The browser does not choose the path.
--
-- Bottle volume comes from produtos.volume_ml (the catalog the bar already uses).
-- The browser cannot send a substitute volume.
--
-- Previous till (commitPosSale / create_order) is not called from these functions.
-- create_order still writes the JBM vendas book. This file writes pos_vendas only.

CREATE TABLE IF NOT EXISTS public.pos_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL,
  space_id uuid,
  guest_label text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'void')),
  created_by uuid,
  closed_by uuid,
  closed_at timestamptz,
  venda_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pos_ticket_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.pos_tickets(id),
  drink_menu_id uuid,
  produto_id uuid,
  qtd integer NOT NULL CHECK (qtd > 0),
  for_cast boolean NOT NULL DEFAULT false,
  added_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pos_bottles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  produto_id uuid NOT NULL,
  bar_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('sealed', 'opened', 'depleted', 'wasted')),
  volume_original integer NOT NULL CHECK (volume_original > 0),
  volume_atual integer NOT NULL CHECK (volume_atual >= 0),
  custo integer,
  opened_at timestamptz,
  opened_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bar_id, code)
);

CREATE TABLE IF NOT EXISTS public.pos_bottle_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bottle_id uuid NOT NULL REFERENCES public.pos_bottles(id),
  bar_id uuid NOT NULL,
  produto_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'open', 'consume', 'waste', 'breakage', 'spill', 'staff_drink', 'complimentary', 'adjustment', 'refund'
  )),
  volume_ml integer NOT NULL CHECK (volume_ml > 0),
  sale_id uuid,
  sale_item_id uuid,
  employee_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pos_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drink_menu_id uuid NOT NULL,
  bar_id uuid NOT NULL,
  UNIQUE (bar_id, drink_menu_id)
);

CREATE TABLE IF NOT EXISTS public.pos_recipe_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.pos_recipes(id),
  produto_id uuid NOT NULL,
  volume_ml integer,
  quantity integer
);

CREATE TABLE IF NOT EXISTS public.pos_idempotency (
  bar_id uuid NOT NULL,
  key text NOT NULL,
  venda_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bar_id, key)
);

CREATE TABLE IF NOT EXISTS public.pos_sale_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venda_id uuid,
  ticket_id uuid,
  bottle_id uuid,
  bar_id uuid NOT NULL,
  kind text NOT NULL,
  amount integer NOT NULL DEFAULT 0,
  reason text,
  employee_id uuid,
  approver_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_tickets ADD COLUMN IF NOT EXISTS closed_by uuid;
ALTER TABLE public.pos_tickets ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE public.pos_tickets ADD COLUMN IF NOT EXISTS venda_id uuid;
ALTER TABLE public.pos_ticket_items ADD COLUMN IF NOT EXISTS added_by uuid;
ALTER TABLE public.pos_ticket_items ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.pos_sale_events ADD COLUMN IF NOT EXISTS ticket_id uuid;
ALTER TABLE public.pos_sale_events ADD COLUMN IF NOT EXISTS bottle_id uuid;
ALTER TABLE public.pos_sale_events ALTER COLUMN venda_id DROP NOT NULL;
ALTER TABLE public.pos_sale_events ALTER COLUMN reason DROP NOT NULL;
ALTER TABLE public.pos_sale_events ALTER COLUMN employee_id DROP NOT NULL;
ALTER TABLE public.pos_sale_events ALTER COLUMN approver_id DROP NOT NULL;
ALTER TABLE public.pos_sale_events ALTER COLUMN amount SET DEFAULT 0;

ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS drink_back_agent_id uuid;
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS comissao_valor integer DEFAULT 0;
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS comissao_estornada integer DEFAULT 0;
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS void_status text;
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS refunded integer DEFAULT 0;
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS card_fee integer DEFAULT 0;
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS card_fee_reversed integer DEFAULT 0;

ALTER TABLE public.pos_vendas_itens ADD COLUMN IF NOT EXISTS for_cast boolean DEFAULT false;
ALTER TABLE public.pos_vendas_itens ADD COLUMN IF NOT EXISTS comissao_valor integer DEFAULT 0;
ALTER TABLE public.pos_vendas_itens ADD COLUMN IF NOT EXISTS refunded_qtd integer DEFAULT 0;
ALTER TABLE public.pos_vendas_itens ADD COLUMN IF NOT EXISTS stock_mode text;

-- Catalog field the bar UI already reads. Not a second bottle register.
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS volume_ml integer;

CREATE UNIQUE INDEX IF NOT EXISTS pos_tickets_one_open_space
  ON public.pos_tickets (bar_id, space_id)
  WHERE status = 'open' AND space_id IS NOT NULL;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public' AND t.relname = 'pos_sale_events' AND c.contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE public.pos_sale_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.pos_sale_events
  ADD CONSTRAINT pos_sale_events_kind_check CHECK (kind IN (
    'ticket_created', 'item_added', 'item_removed',
    'bottle_opened', 'bottle_consumed', 'payment_completed',
    'refund', 'void', 'partial_refund',
    'waste', 'breakage', 'spill', 'staff_drink', 'complimentary', 'adjustment'
  ));

CREATE OR REPLACE FUNCTION public.pos_tokyo_night(p_at timestamptz DEFAULT now())
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXTRACT(HOUR FROM (p_at AT TIME ZONE 'Asia/Tokyo')) < 6
      THEN ((p_at AT TIME ZONE 'Asia/Tokyo')::date - 1)
    ELSE (p_at AT TIME ZONE 'Asia/Tokyo')::date
  END;
$$;

CREATE OR REPLACE FUNCTION public.pos_require_bar(p_bar uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (
    public.user_can_access_bar(p_bar)
    OR EXISTS (
      SELECT 1 FROM public.perfis p
      WHERE p.id = actor AND p.role IN ('admin', 'jbm')
    )
  ) THEN
    RAISE EXCEPTION 'bar not allowed';
  END IF;
  RETURN actor;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_require_bar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_require_bar(uuid) TO authenticated;

-- Real clock stays in caixa_movimentos.data. operational_day is the till night:
-- 00:00–05:59 Asia/Tokyo belongs to the previous night; 06:00 starts the new one.
ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS operational_day date;

-- Historical operational_day backfill omitted. Old cash rows keep a null night until a person assigns the bar.

CREATE OR REPLACE FUNCTION public.pos_log(
  p_bar uuid,
  p_kind text,
  p_employee uuid,
  p_venda uuid DEFAULT NULL,
  p_ticket uuid DEFAULT NULL,
  p_bottle uuid DEFAULT NULL,
  p_amount integer DEFAULT 0,
  p_reason text DEFAULT NULL,
  p_approver uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_id uuid;
BEGIN
  INSERT INTO public.pos_sale_events (
    venda_id, ticket_id, bottle_id, bar_id, kind, amount, reason, employee_id, approver_id
  ) VALUES (
    p_venda, p_ticket, p_bottle, p_bar, p_kind, COALESCE(p_amount, 0), p_reason, p_employee, p_approver
  ) RETURNING id INTO event_id;
  RETURN event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_log(uuid, text, uuid, uuid, uuid, uuid, integer, text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.pos_lock_stock(p_bar uuid, p_produto uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('pos-stock'), hashtext(p_bar::text || ':' || p_produto::text));
  PERFORM 1 FROM public.estoque_movimentos
    WHERE bar_id = p_bar AND produto_id = p_produto
    FOR UPDATE;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_lock_stock(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.pos_sealed_units(p_bar uuid, p_produto uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN qtd ELSE -qtd END), 0)::integer
  FROM public.estoque_movimentos
  WHERE bar_id = p_bar AND produto_id = p_produto;
$$;

REVOKE ALL ON FUNCTION public.pos_sealed_units(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.pos_load_ticket(
  p_bar uuid,
  p_space uuid,
  p_guest text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  ticket uuid;
  created boolean := false;
BEGIN
  actor := public.pos_require_bar(p_bar);
  IF p_space IS NULL THEN
    RAISE EXCEPTION 'space required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('pos-ticket'), hashtext(p_bar::text || ':' || p_space::text));
  SELECT id INTO ticket
  FROM public.pos_tickets
  WHERE bar_id = p_bar AND space_id = p_space AND status = 'open'
  FOR UPDATE;
  IF ticket IS NULL THEN
    INSERT INTO public.pos_tickets (bar_id, space_id, guest_label, created_by)
    VALUES (p_bar, p_space, NULLIF(p_guest, ''), actor)
    RETURNING id INTO ticket;
    PERFORM public.pos_log(p_bar, 'ticket_created', actor, NULL, ticket, NULL, 0, 'open');
    created := true;
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'id', t.id,
      'bar_id', t.bar_id,
      'space_id', t.space_id,
      'status', t.status,
      'created_by', t.created_by,
      'closed_by', t.closed_by,
      'venda_id', t.venda_id,
      'created', created,
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', i.id,
          'drink_menu_id', i.drink_menu_id,
          'produto_id', i.produto_id,
          'qtd', i.qtd,
          'for_cast', i.for_cast,
          'added_by', i.added_by
        ) ORDER BY i.created_at, i.id)
        FROM public.pos_ticket_items i
        WHERE i.ticket_id = t.id
      ), '[]'::jsonb)
    )
    FROM public.pos_tickets t
    WHERE t.id = ticket
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_load_ticket(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_load_ticket(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_ticket_item(
  p_bar uuid,
  p_ticket uuid,
  p_item uuid,
  p_qtd integer,
  p_for_cast boolean,
  p_drink uuid,
  p_produto uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  ticket public.pos_tickets;
  item_id uuid;
  prev_qtd integer;
BEGIN
  actor := public.pos_require_bar(p_bar);
  SELECT * INTO ticket FROM public.pos_tickets WHERE id = p_ticket FOR UPDATE;
  IF ticket.id IS NULL OR ticket.bar_id <> p_bar OR ticket.status <> 'open' THEN
    RAISE EXCEPTION 'ticket not open';
  END IF;
  IF p_item IS NULL THEN
    IF COALESCE(p_qtd, 0) <= 0 THEN
      RAISE EXCEPTION 'invalid quantity';
    END IF;
    IF p_drink IS NULL AND p_produto IS NULL THEN
      RAISE EXCEPTION 'product not in this bar';
    END IF;
    IF p_drink IS NOT NULL AND p_produto IS NOT NULL THEN
      RAISE EXCEPTION 'recipe line mixes unit and ml';
    END IF;
    INSERT INTO public.pos_ticket_items (ticket_id, drink_menu_id, produto_id, qtd, for_cast, added_by)
    VALUES (
      ticket.id,
      p_drink,
      p_produto,
      p_qtd,
      COALESCE(p_for_cast, false) AND p_produto IS NULL,
      actor
    ) RETURNING id INTO item_id;
    PERFORM public.pos_log(p_bar, 'item_added', actor, NULL, ticket.id, NULL, p_qtd, 'add');
    RETURN item_id;
  END IF;
  SELECT qtd INTO prev_qtd FROM public.pos_ticket_items WHERE id = p_item AND ticket_id = ticket.id;
  IF prev_qtd IS NULL THEN
    RAISE EXCEPTION 'item missing';
  END IF;
  IF COALESCE(p_qtd, 0) <= 0 THEN
    DELETE FROM public.pos_ticket_items WHERE id = p_item;
    PERFORM public.pos_log(p_bar, 'item_removed', actor, NULL, ticket.id, NULL, prev_qtd, 'remove');
    RETURN p_item;
  END IF;
  UPDATE public.pos_ticket_items
    SET qtd = p_qtd,
        for_cast = CASE WHEN produto_id IS NULL THEN COALESCE(p_for_cast, for_cast) ELSE false END
    WHERE id = p_item;
  IF p_qtd < prev_qtd THEN
    PERFORM public.pos_log(p_bar, 'item_removed', actor, NULL, ticket.id, NULL, prev_qtd - p_qtd, 'qty');
  ELSIF p_qtd > prev_qtd THEN
    PERFORM public.pos_log(p_bar, 'item_added', actor, NULL, ticket.id, NULL, p_qtd - prev_qtd, 'qty');
  ELSE
    PERFORM public.pos_log(p_bar, 'adjustment', actor, NULL, ticket.id, NULL, 0, 'for_cast');
  END IF;
  RETURN p_item;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_ticket_item(uuid, uuid, uuid, integer, boolean, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_ticket_item(uuid, uuid, uuid, integer, boolean, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_save_ticket(
  p_bar uuid,
  p_ticket uuid,
  p_space uuid,
  p_guest text,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  ticket uuid;
  item jsonb;
BEGIN
  actor := public.pos_require_bar(p_bar);
  IF p_items IS NOT NULL AND jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items required';
  END IF;
  IF p_ticket IS NOT NULL THEN
    SELECT id INTO ticket FROM public.pos_tickets WHERE id = p_ticket AND bar_id = p_bar FOR UPDATE;
    IF ticket IS NULL THEN
      RAISE EXCEPTION 'ticket not open';
    END IF;
    IF (SELECT status FROM public.pos_tickets WHERE id = ticket) <> 'open' THEN
      RAISE EXCEPTION 'ticket not open';
    END IF;
  ELSE
    IF p_space IS NULL THEN
      RAISE EXCEPTION 'space required';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('pos-ticket'), hashtext(p_bar::text || ':' || p_space::text));
    SELECT id INTO ticket
    FROM public.pos_tickets
    WHERE bar_id = p_bar AND space_id = p_space AND status = 'open'
    FOR UPDATE;
    IF ticket IS NULL THEN
      INSERT INTO public.pos_tickets (bar_id, space_id, guest_label, created_by)
      VALUES (p_bar, p_space, NULLIF(p_guest, ''), actor)
      RETURNING id INTO ticket;
      PERFORM public.pos_log(p_bar, 'ticket_created', actor, NULL, ticket, NULL, 0, 'open');
    END IF;
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    PERFORM public.pos_ticket_item(
      p_bar,
      ticket,
      NULL,
      COALESCE((item->>'qtd')::integer, 0),
      COALESCE((item->>'for_cast')::boolean, false),
      NULLIF(item->>'drink_menu_id', '')::uuid,
      NULLIF(item->>'produto_id', '')::uuid
    );
  END LOOP;
  RETURN ticket;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_save_ticket(uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_save_ticket(uuid, uuid, uuid, text, jsonb) TO authenticated;

DROP FUNCTION IF EXISTS public.pos_open_bottle(uuid, uuid, text, integer);

CREATE OR REPLACE FUNCTION public.pos_open_bottle(
  p_bar uuid,
  p_produto uuid,
  p_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  sealed integer;
  bottle uuid;
  orig integer;
  cost integer;
BEGIN
  actor := public.pos_require_bar(p_bar);
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RAISE EXCEPTION 'bottle code required';
  END IF;
  SELECT NULLIF(p.volume_ml, 0),
         CASE WHEN p.custo IS NULL THEN NULL ELSE round(p.custo)::integer END
    INTO orig, cost
  FROM public.produtos p
  WHERE p.id = p_produto;
  IF orig IS NULL OR orig <= 0 THEN
    RAISE EXCEPTION 'product volume missing';
  END IF;
  PERFORM public.pos_lock_stock(p_bar, p_produto);
  sealed := public.pos_sealed_units(p_bar, p_produto);
  IF sealed < 1 THEN
    RAISE EXCEPTION 'bottle not in stock';
  END IF;
  INSERT INTO public.estoque_movimentos (produto_id, bar_id, tipo, qtd, criado_por, obs)
  VALUES (p_produto, p_bar, 'saida', 1, actor, 'bottle_open');
  INSERT INTO public.pos_bottles (
    code, produto_id, bar_id, status, volume_original, volume_atual, custo, opened_at, opened_by
  ) VALUES (
    btrim(p_code), p_produto, p_bar, 'opened', orig, orig, cost, now(), actor
  ) RETURNING id INTO bottle;
  INSERT INTO public.pos_bottle_moves (bottle_id, bar_id, produto_id, kind, volume_ml, employee_id, reason)
  VALUES (bottle, p_bar, p_produto, 'open', orig, actor, 'open');
  PERFORM public.pos_log(p_bar, 'bottle_opened', actor, NULL, NULL, bottle, orig, 'open');
  RETURN bottle;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_open_bottle(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_open_bottle(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_bottle_move(
  p_bottle uuid,
  p_kind text,
  p_volume integer,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  bottle public.pos_bottles;
  move_id uuid;
BEGIN
  IF p_kind NOT IN ('waste', 'breakage', 'spill', 'staff_drink', 'complimentary', 'adjustment') THEN
    RAISE EXCEPTION 'unknown bottle move';
  END IF;
  SELECT * INTO bottle FROM public.pos_bottles WHERE id = p_bottle FOR UPDATE;
  IF bottle.id IS NULL THEN
    RAISE EXCEPTION 'bottle missing';
  END IF;
  actor := public.pos_require_bar(bottle.bar_id);
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason required';
  END IF;
  IF p_volume IS NULL OR p_volume <= 0 OR p_volume > bottle.volume_atual THEN
    RAISE EXCEPTION 'insufficient bottle volume';
  END IF;
  UPDATE public.pos_bottles
    SET volume_atual = volume_atual - p_volume,
        status = CASE
          WHEN volume_atual - p_volume = 0 AND p_kind <> 'complimentary' THEN 'wasted'
          WHEN volume_atual - p_volume = 0 THEN 'depleted'
          ELSE status
        END
    WHERE id = bottle.id;
  INSERT INTO public.pos_bottle_moves (bottle_id, bar_id, produto_id, kind, volume_ml, employee_id, reason)
  VALUES (bottle.id, bottle.bar_id, bottle.produto_id, p_kind, p_volume, actor, btrim(p_reason))
  RETURNING id INTO move_id;
  PERFORM public.pos_log(
    bottle.bar_id, p_kind, actor, NULL, NULL, bottle.id, p_volume, btrim(p_reason)
  );
  RETURN move_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_bottle_move(uuid, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_bottle_move(uuid, text, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_preview_ticket(
  p_bar uuid,
  p_ticket uuid,
  p_payment text,
  p_agent uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  ticket public.pos_tickets;
  item record;
  part record;
  price integer;
  nome text;
  pct numeric := 0;
  subtotal integer := 0;
  fee integer := 0;
  commission integer := 0;
  line_commission integer;
  required_ml integer;
  available_ml integer;
  required_units integer;
  available_units integer;
  blocked text := NULL;
  lines jsonb := '[]'::jsonb;
  shortage jsonb := '[]'::jsonb;
  mode text;
BEGIN
  actor := public.pos_require_bar(p_bar);
  SELECT * INTO ticket FROM public.pos_tickets WHERE id = p_ticket AND bar_id = p_bar;
  IF ticket.id IS NULL OR ticket.status <> 'open' THEN
    RAISE EXCEPTION 'ticket not open';
  END IF;
  IF p_agent IS NOT NULL THEN
    SELECT a.comissao_pct INTO pct
    FROM public.drink_back_agents a
    WHERE a.id = p_agent AND a.bar_id = p_bar AND a.ativo IS TRUE;
    IF pct IS NULL THEN
      RAISE EXCEPTION 'cast not in this bar';
    END IF;
  END IF;
  FOR item IN
    SELECT * FROM public.pos_ticket_items WHERE ticket_id = ticket.id ORDER BY created_at, id
  LOOP
    price := NULL;
    nome := '';
    mode := NULL;
    required_ml := 0;
    available_ml := 0;
    required_units := 0;
    available_units := 0;
    line_commission := 0;
    IF item.drink_menu_id IS NOT NULL THEN
      SELECT round(d.preco_venda)::integer, d.nome INTO price, nome
      FROM public.drink_menu d
      WHERE d.id = item.drink_menu_id AND d.bar_id = p_bar;
      mode := 'ml';
      IF NOT EXISTS (
        SELECT 1 FROM public.pos_recipes r
        JOIN public.pos_recipe_lines rl ON rl.recipe_id = r.id
        WHERE r.drink_menu_id = item.drink_menu_id AND r.bar_id = p_bar
      ) THEN
        blocked := COALESCE(blocked, 'recipe required');
      ELSE
        FOR part IN
          SELECT rl.produto_id, rl.volume_ml, rl.quantity
          FROM public.pos_recipe_lines rl
          JOIN public.pos_recipes r ON r.id = rl.recipe_id
          WHERE r.drink_menu_id = item.drink_menu_id AND r.bar_id = p_bar
        LOOP
          IF COALESCE(part.volume_ml, 0) > 0 AND COALESCE(part.quantity, 0) > 0 THEN
            blocked := COALESCE(blocked, 'recipe line mixes unit and ml');
          ELSIF COALESCE(part.volume_ml, 0) > 0 THEN
            required_ml := required_ml + part.volume_ml * item.qtd;
            SELECT COALESCE(SUM(b.volume_atual), 0) INTO available_ml
            FROM public.pos_bottles b
            WHERE b.bar_id = p_bar AND b.produto_id = part.produto_id AND b.status = 'opened';
            IF part.volume_ml * item.qtd > available_ml THEN
              blocked := COALESCE(blocked, 'insufficient bottle volume');
              shortage := shortage || jsonb_build_array(jsonb_build_object(
                'produto_id', part.produto_id, 'mode', 'ml',
                'required', part.volume_ml * item.qtd, 'available', available_ml
              ));
            END IF;
          ELSIF COALESCE(part.quantity, 0) > 0 THEN
            required_units := required_units + part.quantity * item.qtd;
            available_units := public.pos_sealed_units(p_bar, part.produto_id);
            IF part.quantity * item.qtd > available_units THEN
              blocked := COALESCE(blocked, 'insufficient stock');
              shortage := shortage || jsonb_build_array(jsonb_build_object(
                'produto_id', part.produto_id, 'mode', 'unit',
                'required', part.quantity * item.qtd, 'available', available_units
              ));
            END IF;
          ELSE
            blocked := COALESCE(blocked, 'recipe required');
          END IF;
        END LOOP;
      END IF;
    ELSIF item.produto_id IS NOT NULL THEN
      SELECT round(bp.preco_drink)::integer, p.nome INTO price, nome
      FROM public.bar_pricing bp
      JOIN public.produtos p ON p.id = bp.produto_id
      WHERE bp.produto_id = item.produto_id AND bp.bar_id = p_bar;
      mode := 'unit';
      required_units := item.qtd;
      available_units := public.pos_sealed_units(p_bar, item.produto_id);
      IF item.qtd > available_units THEN
        blocked := COALESCE(blocked, 'insufficient stock');
        shortage := shortage || jsonb_build_array(jsonb_build_object(
          'produto_id', item.produto_id, 'mode', 'unit',
          'required', item.qtd, 'available', available_units
        ));
      END IF;
    END IF;
    IF price IS NULL THEN
      blocked := COALESCE(blocked, 'product not in this bar');
      price := 0;
    END IF;
    IF p_agent IS NOT NULL AND item.for_cast AND item.produto_id IS NULL AND price > 2000 AND pct > 0 THEN
      line_commission := (round(2000 * pct / 100) * item.qtd);
      commission := commission + line_commission;
    END IF;
    subtotal := subtotal + price * item.qtd;
    lines := lines || jsonb_build_array(jsonb_build_object(
      'id', item.id,
      'nome', nome,
      'qtd', item.qtd,
      'unit_price', price,
      'mode', mode,
      'required_ml', required_ml,
      'available_ml', available_ml,
      'required_units', required_units,
      'available_units', available_units,
      'for_cast', item.for_cast,
      'added_by', item.added_by,
      'commission', line_commission
    ));
  END LOOP;
  IF p_payment IN ('card', 'credit') THEN
    fee := round(subtotal * 0.0378);
  END IF;
  RETURN jsonb_build_object(
    'subtotal', subtotal,
    'fee', fee,
    'net', subtotal - fee,
    'commission', commission,
    'blocked', blocked,
    'shortage', shortage,
    'lines', lines,
    'employee_id', actor
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_preview_ticket(uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_preview_ticket(uuid, uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_close_ticket(
  p_bar uuid,
  p_ticket uuid,
  p_payment text,
  p_key text,
  p_agent uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  existing uuid;
  ticket public.pos_tickets;
  item record;
  price integer;
  nome text;
  qty integer;
  subtotal integer := 0;
  fee integer := 0;
  commission integer := 0;
  line_commission integer;
  pct numeric := 0;
  venda uuid;
  item_id uuid;
  part record;
  bottle public.pos_bottles;
  left_ml integer;
  take integer;
  night date;
  mode text;
  recipe uuid;
  need_units integer;
  sealed integer;
BEGIN
  actor := public.pos_require_bar(p_bar);
  IF p_key IS NULL OR btrim(p_key) = '' THEN
    RAISE EXCEPTION 'idempotency key required';
  END IF;

  SELECT * INTO ticket FROM public.pos_tickets WHERE id = p_ticket AND bar_id = p_bar FOR UPDATE;
  IF ticket.id IS NULL THEN
    RAISE EXCEPTION 'ticket not open';
  END IF;
  IF ticket.status <> 'open' THEN
    IF ticket.venda_id IS NOT NULL THEN
      RETURN jsonb_build_object('venda_id', ticket.venda_id, 'duplicate', true);
    END IF;
    RAISE EXCEPTION 'ticket not open';
  END IF;

  SELECT venda_id INTO existing FROM public.pos_idempotency WHERE bar_id = p_bar AND key = p_key;
  IF existing IS NOT NULL THEN
    RETURN jsonb_build_object('venda_id', existing, 'duplicate', true);
  END IF;

  IF p_agent IS NOT NULL THEN
    SELECT a.comissao_pct INTO pct
    FROM public.drink_back_agents a
    WHERE a.id = p_agent AND a.bar_id = p_bar AND a.ativo IS TRUE;
    IF pct IS NULL THEN
      RAISE EXCEPTION 'cast not in this bar';
    END IF;
  END IF;

  night := public.pos_tokyo_night(now());

  CREATE TEMP TABLE IF NOT EXISTS pos_close_lines (
    ticket_item_id uuid,
    drink_menu_id uuid,
    produto_id uuid,
    nome text,
    qtd integer,
    unit_price integer,
    for_cast boolean,
    added_by uuid,
    stock_mode text,
    commission integer
  ) ON COMMIT DROP;
  TRUNCATE pos_close_lines;

  FOR item IN
    SELECT * FROM public.pos_ticket_items WHERE ticket_id = p_ticket ORDER BY created_at, id
  LOOP
    qty := item.qtd;
    price := NULL;
    nome := '';
    mode := NULL;
    line_commission := 0;
    IF item.drink_menu_id IS NOT NULL THEN
      SELECT round(d.preco_venda)::integer, d.nome INTO price, nome
      FROM public.drink_menu d
      WHERE d.id = item.drink_menu_id AND d.bar_id = p_bar;
      mode := 'ml';
      SELECT r.id INTO recipe
      FROM public.pos_recipes r
      WHERE r.drink_menu_id = item.drink_menu_id AND r.bar_id = p_bar;
      IF recipe IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.pos_recipe_lines rl WHERE rl.recipe_id = recipe
      ) THEN
        RAISE EXCEPTION 'recipe required';
      END IF;
      FOR part IN
        SELECT rl.produto_id, rl.volume_ml, rl.quantity
        FROM public.pos_recipe_lines rl
        WHERE rl.recipe_id = recipe
      LOOP
        IF COALESCE(part.volume_ml, 0) > 0 AND COALESCE(part.quantity, 0) > 0 THEN
          RAISE EXCEPTION 'recipe line mixes unit and ml';
        ELSIF COALESCE(part.volume_ml, 0) <= 0 AND COALESCE(part.quantity, 0) <= 0 THEN
          RAISE EXCEPTION 'recipe required';
        END IF;
      END LOOP;
    ELSIF item.produto_id IS NOT NULL THEN
      SELECT round(bp.preco_drink)::integer, p.nome INTO price, nome
      FROM public.bar_pricing bp
      JOIN public.produtos p ON p.id = bp.produto_id
      WHERE bp.produto_id = item.produto_id AND bp.bar_id = p_bar;
      mode := 'unit';
    END IF;
    IF price IS NULL THEN
      RAISE EXCEPTION 'product not in this bar';
    END IF;
    IF p_agent IS NOT NULL AND item.for_cast AND item.produto_id IS NULL AND price > 2000 AND pct > 0 THEN
      line_commission := (round(2000 * pct / 100) * qty);
    END IF;
    INSERT INTO pos_close_lines VALUES (
      item.id, item.drink_menu_id, item.produto_id, nome, qty, price, item.for_cast, item.added_by, mode, line_commission
    );
    subtotal := subtotal + price * qty;
    commission := commission + line_commission;
  END LOOP;

  IF subtotal <= 0 THEN
    RAISE EXCEPTION 'order is empty';
  END IF;

  BEGIN
    INSERT INTO public.pos_idempotency (bar_id, key) VALUES (p_bar, p_key);
  EXCEPTION WHEN unique_violation THEN
    SELECT venda_id INTO existing FROM public.pos_idempotency WHERE bar_id = p_bar AND key = p_key;
    IF existing IS NULL THEN
      RAISE EXCEPTION 'close in progress';
    END IF;
    RETURN jsonb_build_object('venda_id', existing, 'duplicate', true);
  END;

  IF p_payment IN ('card', 'credit') THEN
    fee := round(subtotal * 0.0378);
  END IF;

  INSERT INTO public.pos_vendas (
    bar_id, data, subtotal, desconto_total, total, metodo_pagamento, tipo, criado_por,
    comissao_valor, drink_back_agent_id, card_fee
  ) VALUES (
    p_bar, night, subtotal, 0, subtotal, COALESCE(p_payment, 'cash'), 'balcao', actor,
    commission, p_agent, fee
  ) RETURNING id INTO venda;

  FOR item IN SELECT * FROM pos_close_lines
  LOOP
    INSERT INTO public.pos_vendas_itens (
      pos_venda_id, drink_menu_id, produto_id, nome, qtd, preco_unitario, preco_lista, tipo_preco, desconto_valor,
      for_cast, comissao_valor, refunded_qtd, stock_mode
    ) VALUES (
      venda, item.drink_menu_id, item.produto_id, item.nome, item.qtd, item.unit_price, item.unit_price, 'regular', 0,
      item.for_cast, item.commission, 0, item.stock_mode
    ) RETURNING id INTO item_id;

    IF item.stock_mode = 'ml' THEN
      FOR part IN
        SELECT rl.produto_id, rl.volume_ml, rl.quantity
        FROM public.pos_recipe_lines rl
        JOIN public.pos_recipes r ON r.id = rl.recipe_id
        WHERE r.drink_menu_id = item.drink_menu_id AND r.bar_id = p_bar
      LOOP
        IF COALESCE(part.volume_ml, 0) > 0 THEN
          left_ml := part.volume_ml * item.qtd;
          FOR bottle IN
            SELECT * FROM public.pos_bottles
            WHERE bar_id = p_bar AND produto_id = part.produto_id AND status = 'opened' AND volume_atual > 0
            ORDER BY opened_at
            FOR UPDATE
          LOOP
            EXIT WHEN left_ml <= 0;
            take := LEAST(bottle.volume_atual, left_ml);
            UPDATE public.pos_bottles
              SET volume_atual = volume_atual - take,
                  status = CASE WHEN volume_atual - take = 0 THEN 'depleted' ELSE status END
              WHERE id = bottle.id;
            INSERT INTO public.pos_bottle_moves (
              bottle_id, bar_id, produto_id, kind, volume_ml, sale_id, sale_item_id, employee_id, reason
            ) VALUES (
              bottle.id, p_bar, part.produto_id, 'consume', take, venda, item_id, actor, 'sale'
            );
            PERFORM public.pos_log(p_bar, 'bottle_consumed', actor, venda, p_ticket, bottle.id, take, 'sale');
            left_ml := left_ml - take;
          END LOOP;
          IF left_ml > 0 THEN
            RAISE EXCEPTION 'insufficient bottle volume';
          END IF;
        ELSIF COALESCE(part.quantity, 0) > 0 THEN
          need_units := part.quantity * item.qtd;
          PERFORM public.pos_lock_stock(p_bar, part.produto_id);
          sealed := public.pos_sealed_units(p_bar, part.produto_id);
          IF sealed < need_units THEN
            RAISE EXCEPTION 'insufficient stock';
          END IF;
          INSERT INTO public.estoque_movimentos (produto_id, bar_id, tipo, qtd, criado_por, obs)
          VALUES (
            part.produto_id, p_bar, 'saida', need_units, actor,
            'pos_venda ' || venda::text || ' ' || item_id::text
          );
        END IF;
      END LOOP;
    ELSIF item.stock_mode = 'unit' THEN
      PERFORM public.pos_lock_stock(p_bar, item.produto_id);
      sealed := public.pos_sealed_units(p_bar, item.produto_id);
      IF sealed < item.qtd THEN
        RAISE EXCEPTION 'insufficient stock';
      END IF;
      INSERT INTO public.estoque_movimentos (produto_id, bar_id, tipo, qtd, criado_por, obs)
      VALUES (
        item.produto_id, p_bar, 'saida', item.qtd, actor,
        'pos_venda ' || venda::text || ' ' || item_id::text
      );
    END IF;
  END LOOP;

  INSERT INTO public.caixa_movimentos (bar_id, tipo, valor, descricao, referencia_id, referencia_tipo, data, operational_day)
  VALUES (p_bar, 'entrada', subtotal, 'POS ' || COALESCE(p_payment, 'cash'), venda, 'pos_venda', now(), night);

  IF fee > 0 THEN
    INSERT INTO public.caixa_movimentos (bar_id, tipo, valor, descricao, referencia_id, referencia_tipo, data, operational_day)
    VALUES (p_bar, 'saida', fee, 'Taxa cartão (3.78%)', venda, 'taxa_cartao', now(), night);
  END IF;

  UPDATE public.pos_tickets
    SET status = 'closed', closed_by = actor, closed_at = now(), venda_id = venda
    WHERE id = p_ticket;
  UPDATE public.pos_idempotency SET venda_id = venda WHERE bar_id = p_bar AND key = p_key;
  PERFORM public.pos_log(p_bar, 'payment_completed', actor, venda, p_ticket, NULL, subtotal, COALESCE(p_payment, 'cash'));

  RETURN jsonb_build_object(
    'venda_id', venda,
    'total', subtotal,
    'fee', fee,
    'net', subtotal - fee,
    'commission', commission,
    'duplicate', false,
    'night', night
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_close_ticket(uuid, uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_close_ticket(uuid, uuid, text, text, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.pos_void_sale(uuid, text, integer, text, uuid);

CREATE OR REPLACE FUNCTION public.pos_void_sale(
  p_venda uuid,
  p_kind text,
  p_amount integer,
  p_reason text,
  p_approver uuid,
  p_item uuid DEFAULT NULL,
  p_qty integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  sale public.pos_vendas;
  item public.pos_vendas_itens;
  value integer;
  event_id uuid;
  fee_part integer := 0;
  orig_fee integer := 0;
  commission_back integer := 0;
  gross integer;
  already integer;
  void_night date;
  qty_left integer;
  row record;
  need_ml integer;
  take integer;
  consumed integer;
  restored integer;
  per_unit integer;
  need_units integer;
  reversed_units integer;
  obs_sale text;
  obs_void text;
  slot record;
  stock record;
BEGIN
  IF p_kind NOT IN ('void', 'refund', 'partial_refund') THEN
    RAISE EXCEPTION 'unknown void';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' OR p_approver IS NULL THEN
    RAISE EXCEPTION 'void needs reason and approver';
  END IF;
  SELECT * INTO sale FROM public.pos_vendas WHERE id = p_venda FOR UPDATE;
  IF sale.id IS NULL THEN
    RAISE EXCEPTION 'sale missing';
  END IF;
  actor := public.pos_require_bar(sale.bar_id);
  IF sale.void_status = 'void' THEN
    RAISE EXCEPTION 'already void';
  END IF;
  gross := round(sale.total)::integer;
  already := COALESCE(sale.refunded, 0);

  CREATE TEMP TABLE IF NOT EXISTS pos_void_items (
    id uuid,
    qty integer
  ) ON COMMIT DROP;
  TRUNCATE pos_void_items;

  IF p_kind = 'partial_refund' THEN
    SELECT * INTO item FROM public.pos_vendas_itens WHERE id = p_item AND pos_venda_id = sale.id FOR UPDATE;
    IF item.id IS NULL THEN
      RAISE EXCEPTION 'item missing';
    END IF;
    qty_left := item.qtd - COALESCE(item.refunded_qtd, 0);
    IF COALESCE(p_qty, 0) <= 0 OR p_qty > qty_left THEN
      RAISE EXCEPTION 'refund exceeds item';
    END IF;
    value := round(item.preco_unitario)::integer * p_qty;
    IF p_amount IS NOT NULL AND p_amount <> value THEN
      RAISE EXCEPTION 'refund exceeds sale';
    END IF;
    IF value <= 0 OR value > (gross - already) THEN
      RAISE EXCEPTION 'refund exceeds sale';
    END IF;
    commission_back := round(COALESCE(item.comissao_valor, 0) * (COALESCE(item.refunded_qtd, 0) + p_qty)::numeric / item.qtd)
      - round(COALESCE(item.comissao_valor, 0) * COALESCE(item.refunded_qtd, 0)::numeric / item.qtd);
    INSERT INTO pos_void_items VALUES (item.id, p_qty);
  ELSE
    value := gross - already;
    IF value <= 0 THEN
      RAISE EXCEPTION 'refund exceeds sale';
    END IF;
    commission_back := COALESCE(sale.comissao_valor, 0) - COALESCE(sale.comissao_estornada, 0);
    INSERT INTO pos_void_items
    SELECT id, qtd - COALESCE(refunded_qtd, 0)
    FROM public.pos_vendas_itens
    WHERE pos_venda_id = sale.id AND qtd - COALESCE(refunded_qtd, 0) > 0;
  END IF;

  orig_fee := 0;
  IF sale.metodo_pagamento IN ('card', 'credit') THEN
    orig_fee := COALESCE(sale.card_fee, 0);
    IF orig_fee = 0 THEN
      SELECT COALESCE(SUM(valor), 0)::integer INTO orig_fee
      FROM public.caixa_movimentos
      WHERE referencia_id = sale.id AND referencia_tipo = 'taxa_cartao' AND tipo = 'saida';
    END IF;
  END IF;
  IF orig_fee > 0 AND gross > 0 THEN
    fee_part := round(orig_fee * (already + value)::numeric / gross)::integer - COALESCE(sale.card_fee_reversed, 0);
    IF fee_part < 0 THEN
      fee_part := 0;
    END IF;
  END IF;

  event_id := public.pos_log(
    sale.bar_id, p_kind, actor, sale.id, NULL, NULL, value, p_reason, p_approver
  );

  void_night := public.pos_tokyo_night(now());
  INSERT INTO public.caixa_movimentos (bar_id, tipo, valor, descricao, referencia_id, referencia_tipo, data, operational_day)
  VALUES (sale.bar_id, 'saida', value, 'POS ' || p_kind, sale.id, 'pos_void', now(), void_night);

  IF fee_part > 0 THEN
    INSERT INTO public.caixa_movimentos (bar_id, tipo, valor, descricao, referencia_id, referencia_tipo, data, operational_day)
    VALUES (sale.bar_id, 'entrada', fee_part, 'Estorno taxa cartão', sale.id, 'taxa_cartao_estorno', now(), void_night);
  END IF;

  UPDATE public.pos_vendas
    SET refunded = already + value,
        void_status = CASE WHEN already + value >= gross THEN 'void' ELSE 'partial_refund' END,
        comissao_estornada = COALESCE(comissao_estornada, 0) + commission_back,
        card_fee_reversed = COALESCE(card_fee_reversed, 0) + fee_part
    WHERE id = sale.id;

  FOR row IN SELECT * FROM pos_void_items
  LOOP
    SELECT * INTO item FROM public.pos_vendas_itens WHERE id = row.id FOR UPDATE;
    IF item.stock_mode = 'ml' OR item.drink_menu_id IS NOT NULL THEN
      SELECT COALESCE(SUM(volume_ml), 0) INTO consumed
      FROM public.pos_bottle_moves
      WHERE sale_item_id = item.id AND kind = 'consume';
      SELECT COALESCE(SUM(volume_ml), 0) INTO restored
      FROM public.pos_bottle_moves
      WHERE sale_item_id = item.id AND kind = 'refund';
      need_ml := round(consumed * (COALESCE(item.refunded_qtd, 0) + row.qty)::numeric / item.qtd)::integer - restored;
      IF need_ml < 0 THEN
        need_ml := 0;
      END IF;
      FOR slot IN
        SELECT m.bottle_id,
               SUM(CASE WHEN m.kind = 'consume' THEN m.volume_ml ELSE 0 END)
                 - SUM(CASE WHEN m.kind = 'refund' THEN m.volume_ml ELSE 0 END) AS left_ml
        FROM public.pos_bottle_moves m
        WHERE m.sale_item_id = item.id AND m.kind IN ('consume', 'refund')
        GROUP BY m.bottle_id
        HAVING SUM(CASE WHEN m.kind = 'consume' THEN m.volume_ml ELSE 0 END)
             - SUM(CASE WHEN m.kind = 'refund' THEN m.volume_ml ELSE 0 END) > 0
        ORDER BY MAX(m.created_at) DESC
      LOOP
        EXIT WHEN need_ml <= 0;
        take := LEAST(need_ml, slot.left_ml::integer);
        UPDATE public.pos_bottles
          SET volume_atual = LEAST(volume_original, volume_atual + take),
              status = 'opened'
          WHERE id = slot.bottle_id;
        INSERT INTO public.pos_bottle_moves (
          bottle_id, bar_id, produto_id, kind, volume_ml, sale_id, sale_item_id, employee_id, reason
        )
        SELECT slot.bottle_id, b.bar_id, b.produto_id, 'refund', take, sale.id, item.id, actor, p_reason
        FROM public.pos_bottles b WHERE b.id = slot.bottle_id;
        need_ml := need_ml - take;
      END LOOP;
    END IF;

    obs_sale := 'pos_venda ' || sale.id::text || ' ' || item.id::text;
    obs_void := 'pos_void ' || sale.id::text || ' ' || item.id::text;
    FOR stock IN
      SELECT produto_id, COALESCE(SUM(qtd), 0)::integer AS qtd
      FROM public.estoque_movimentos
      WHERE bar_id = sale.bar_id AND tipo = 'saida' AND obs = obs_sale
      GROUP BY produto_id
    LOOP
      SELECT COALESCE(SUM(qtd), 0)::integer INTO reversed_units
      FROM public.estoque_movimentos
      WHERE bar_id = sale.bar_id AND tipo = 'entrada' AND obs = obs_void AND produto_id = stock.produto_id;
      IF stock.qtd > 0 AND item.qtd > 0 THEN
        per_unit := stock.qtd / item.qtd;
        need_units := per_unit * row.qty;
        IF reversed_units + need_units > stock.qtd THEN
          RAISE EXCEPTION 'refund exceeds item';
        END IF;
        IF need_units > 0 THEN
          PERFORM public.pos_lock_stock(sale.bar_id, stock.produto_id);
          INSERT INTO public.estoque_movimentos (produto_id, bar_id, tipo, qtd, criado_por, obs)
          VALUES (stock.produto_id, sale.bar_id, 'entrada', need_units, actor, obs_void);
        END IF;
      END IF;
    END LOOP;

    UPDATE public.pos_vendas_itens
      SET refunded_qtd = COALESCE(refunded_qtd, 0) + row.qty
      WHERE id = item.id;
  END LOOP;

  RETURN event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_void_sale(uuid, text, integer, text, uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_void_sale(uuid, text, integer, text, uuid, uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_bottle_board(p_bar uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.pos_require_bar(p_bar);
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', b.id,
      'code', b.code,
      'produto_id', b.produto_id,
      'produto_nome', (SELECT p.nome FROM public.produtos p WHERE p.id = b.produto_id),
      'bar_id', b.bar_id,
      'status', b.status,
      'volume_original', b.volume_original,
      'volume_atual', b.volume_atual,
      'remaining_pct', CASE
        WHEN b.volume_original > 0 THEN round(100.0 * b.volume_atual / b.volume_original)::integer
        ELSE 0
      END,
      'opened_at', b.opened_at,
      'opened_by', b.opened_by,
      'custo', b.custo,
      'consumed', b.volume_original - b.volume_atual,
      'waste_ml', COALESCE((
        SELECT SUM(m.volume_ml)
        FROM public.pos_bottle_moves m
        WHERE m.bottle_id = b.id AND m.kind IN ('waste', 'breakage', 'spill')
      ), 0)
    ) ORDER BY b.opened_at DESC)
    FROM public.pos_bottles b
    WHERE b.bar_id = p_bar
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.pos_bottle_board(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_bottle_board(uuid) TO authenticated;

ALTER TABLE public.pos_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_ticket_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_bottles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_bottle_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_recipe_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sale_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_tickets_read ON public.pos_tickets;
CREATE POLICY pos_tickets_read ON public.pos_tickets
  FOR SELECT TO authenticated
  USING (public.user_can_access_bar(bar_id));

DROP POLICY IF EXISTS pos_ticket_items_read ON public.pos_ticket_items;
CREATE POLICY pos_ticket_items_read ON public.pos_ticket_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pos_tickets t
      WHERE t.id = pos_ticket_items.ticket_id
        AND public.user_can_access_bar(t.bar_id)
    )
  );

DROP POLICY IF EXISTS pos_bottles_read ON public.pos_bottles;
CREATE POLICY pos_bottles_read ON public.pos_bottles
  FOR SELECT TO authenticated
  USING (public.user_can_access_bar(bar_id));

DROP POLICY IF EXISTS pos_bottle_moves_read ON public.pos_bottle_moves;
CREATE POLICY pos_bottle_moves_read ON public.pos_bottle_moves
  FOR SELECT TO authenticated
  USING (public.user_can_access_bar(bar_id));

DROP POLICY IF EXISTS pos_recipes_read ON public.pos_recipes;
CREATE POLICY pos_recipes_read ON public.pos_recipes
  FOR SELECT TO authenticated
  USING (public.user_can_access_bar(bar_id));

DROP POLICY IF EXISTS pos_recipe_lines_read ON public.pos_recipe_lines;
CREATE POLICY pos_recipe_lines_read ON public.pos_recipe_lines
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pos_recipes r
      WHERE r.id = pos_recipe_lines.recipe_id
        AND public.user_can_access_bar(r.bar_id)
    )
  );

DROP POLICY IF EXISTS pos_idem_read ON public.pos_idempotency;
CREATE POLICY pos_idem_read ON public.pos_idempotency
  FOR SELECT TO authenticated
  USING (public.user_can_access_bar(bar_id));

DROP POLICY IF EXISTS pos_events_read ON public.pos_sale_events;
CREATE POLICY pos_events_read ON public.pos_sale_events
  FOR SELECT TO authenticated
  USING (public.user_can_access_bar(bar_id));

REVOKE ALL ON public.pos_tickets FROM PUBLIC, anon;
REVOKE ALL ON public.pos_ticket_items FROM PUBLIC, anon;
REVOKE ALL ON public.pos_bottles FROM PUBLIC, anon;
REVOKE ALL ON public.pos_bottle_moves FROM PUBLIC, anon;
REVOKE ALL ON public.pos_recipes FROM PUBLIC, anon;
REVOKE ALL ON public.pos_recipe_lines FROM PUBLIC, anon;
REVOKE ALL ON public.pos_idempotency FROM PUBLIC, anon;
REVOKE ALL ON public.pos_sale_events FROM PUBLIC, anon;

GRANT SELECT ON public.pos_tickets TO authenticated;
GRANT SELECT ON public.pos_ticket_items TO authenticated;
GRANT SELECT ON public.pos_bottles TO authenticated;
GRANT SELECT ON public.pos_bottle_moves TO authenticated;
GRANT SELECT ON public.pos_recipes TO authenticated;
GRANT SELECT ON public.pos_recipe_lines TO authenticated;
GRANT SELECT ON public.pos_idempotency TO authenticated;
GRANT SELECT ON public.pos_sale_events TO authenticated;


-- ===== sql/payroll.sql =====

-- Operational payroll ledger.
-- Does not change procurement, time_clock writes, or the employee registry (perfis).
-- Hours stay in time_clock. This file only reads that table from payroll_my_pack.
-- Tax, social insurance, vacation and 13th salary are not calculated here.
-- Apply manually in the Supabase SQL editor. This repository does not apply it.

CREATE TABLE IF NOT EXISTS public.payroll_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid,
  pay_hourly boolean NOT NULL DEFAULT false,
  pay_overtime boolean NOT NULL DEFAULT false,
  overtime_multiplier numeric,
  night_premium_rate numeric,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competence text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'calculated', 'approved', 'paid', 'cancelled')),
  opened_by uuid,
  approved_by uuid,
  paid_at date,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  bar_id uuid,
  payroll_period_id uuid NOT NULL REFERENCES public.payroll_periods(id),
  type text NOT NULL
    CHECK (type IN (
      'base_salary', 'regular_hours', 'overtime', 'night_premium',
      'commission', 'bonus', 'reward', 'advance', 'deduction', 'adjustment'
    )),
  description text NOT NULL DEFAULT '',
  quantity numeric,
  unit_value numeric,
  amount integer NOT NULL,
  source text,
  source_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_lines_source_uidx
  ON public.payroll_lines (payroll_period_id, employee_id, type, source, source_id)
  WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.payroll_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_period_id uuid,
  employee_id uuid,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_shift_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  bar_id uuid,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  bar_id uuid,
  note text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  bar_id uuid,
  points integer NOT NULL,
  reason text NOT NULL,
  source text,
  source_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_goal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  bar_id uuid,
  competence text NOT NULL,
  title text NOT NULL,
  target numeric,
  actual numeric,
  source text,
  source_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  bar_id uuid,
  competence text NOT NULL,
  title text NOT NULL,
  amount integer NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'posted', 'cancelled')),
  source text,
  source_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  bar_id uuid,
  competence text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'paid', 'cancelled')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  bar_id uuid,
  competence text,
  reason text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  reference text,
  approved_by uuid,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'posted', 'rejected', 'cancelled')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_payroll_hq()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.perfis p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'jbm')
  );
$$;

REVOKE ALL ON FUNCTION public.is_payroll_hq() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_payroll_hq() TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_require_hq()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT public.is_payroll_hq() THEN
    RAISE EXCEPTION 'payroll hq only';
  END IF;
  RETURN actor;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_require_hq() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_require_hq() TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_audit(
  p_action text,
  p_period uuid,
  p_employee uuid,
  p_detail jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.payroll_audit (payroll_period_id, employee_id, action, detail, actor_id)
  VALUES (p_period, p_employee, p_action, COALESCE(p_detail, '{}'::jsonb), auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_audit(text, uuid, uuid, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.payroll_open_period(p_competence text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  period_id uuid;
BEGIN
  actor := public.payroll_require_hq();
  IF p_competence IS NULL OR p_competence !~ '^[0-9]{4}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'competence must be YYYY-MM';
  END IF;
  SELECT id INTO period_id FROM public.payroll_periods WHERE competence = p_competence;
  IF period_id IS NOT NULL THEN
    RETURN period_id;
  END IF;
  INSERT INTO public.payroll_periods (competence, status, opened_by)
  VALUES (p_competence, 'draft', actor)
  RETURNING id INTO period_id;
  PERFORM public.payroll_audit('open', period_id, NULL, jsonb_build_object('competence', p_competence));
  RETURN period_id;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_open_period(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_open_period(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_post_lines(p_period uuid, p_lines jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  period public.payroll_periods;
  item jsonb;
  inserted integer := 0;
  kind text;
BEGIN
  actor := public.payroll_require_hq();
  SELECT * INTO period FROM public.payroll_periods WHERE id = p_period;
  IF period.id IS NULL THEN
    RAISE EXCEPTION 'period not found';
  END IF;
  IF period.status IN ('approved', 'paid', 'cancelled') THEN
    RAISE EXCEPTION 'period is locked';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'lines must be an array';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_lines) AS t(value)
  LOOP
    kind := item->>'type';
    IF kind NOT IN (
      'base_salary', 'regular_hours', 'overtime', 'night_premium',
      'commission', 'bonus', 'reward', 'advance', 'deduction', 'adjustment'
    ) THEN
      RAISE EXCEPTION 'unknown payroll type';
    END IF;
    IF item->>'employee_id' IS NULL OR item->>'amount' IS NULL THEN
      RAISE EXCEPTION 'employee_id and amount are required';
    END IF;
    INSERT INTO public.payroll_lines (
      employee_id, bar_id, payroll_period_id, type, description,
      quantity, unit_value, amount, source, source_id, created_by
    ) VALUES (
      (item->>'employee_id')::uuid,
      NULLIF(item->>'bar_id', '')::uuid,
      p_period,
      kind,
      COALESCE(item->>'description', ''),
      NULLIF(item->>'quantity', '')::numeric,
      NULLIF(item->>'unit_value', '')::numeric,
      (item->>'amount')::integer,
      NULLIF(item->>'source', ''),
      NULLIF(item->>'source_id', ''),
      actor
    );
    inserted := inserted + 1;
    PERFORM public.payroll_audit('calculate', p_period, (item->>'employee_id')::uuid, item);
  END LOOP;
  UPDATE public.payroll_periods
    SET status = 'calculated'
    WHERE id = p_period AND status = 'draft';
  RETURN inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_post_lines(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_post_lines(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_adjust(
  p_period uuid,
  p_employee uuid,
  p_bar uuid,
  p_amount integer,
  p_description text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  period public.payroll_periods;
  line_id uuid;
BEGIN
  actor := public.payroll_require_hq();
  SELECT * INTO period FROM public.payroll_periods WHERE id = p_period;
  IF period.id IS NULL OR period.status = 'cancelled' THEN
    RAISE EXCEPTION 'period cannot be adjusted';
  END IF;
  INSERT INTO public.payroll_lines (
    employee_id, bar_id, payroll_period_id, type, description, amount, source, created_by
  ) VALUES (
    p_employee, p_bar, p_period, 'adjustment', COALESCE(p_description, 'Adjustment'), p_amount, 'adjustment', actor
  ) RETURNING id INTO line_id;
  PERFORM public.payroll_audit(
    'adjustment', p_period, p_employee,
    jsonb_build_object('amount', p_amount, 'description', p_description, 'line_id', line_id, 'status', period.status)
  );
  RETURN line_id;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_adjust(uuid, uuid, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_adjust(uuid, uuid, uuid, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_transition(p_period uuid, p_status text, p_paid_on date DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  period public.payroll_periods;
BEGIN
  actor := public.payroll_require_hq();
  SELECT * INTO period FROM public.payroll_periods WHERE id = p_period FOR UPDATE;
  IF period.id IS NULL THEN
    RAISE EXCEPTION 'period not found';
  END IF;
  IF NOT (
    (period.status = 'draft' AND p_status IN ('calculated', 'cancelled'))
    OR (period.status = 'calculated' AND p_status IN ('approved', 'cancelled'))
    OR (period.status = 'approved' AND p_status = 'paid')
  ) THEN
    RAISE EXCEPTION 'cannot move payroll from % to %', period.status, p_status;
  END IF;
  UPDATE public.payroll_periods
    SET status = p_status,
        approved_by = CASE WHEN p_status = 'approved' THEN actor ELSE approved_by END,
        paid_at = CASE WHEN p_status = 'paid' THEN COALESCE(p_paid_on, CURRENT_DATE) ELSE paid_at END,
        closed_at = CASE WHEN p_status IN ('approved', 'paid', 'cancelled') THEN now() ELSE closed_at END
    WHERE id = p_period;
  PERFORM public.payroll_audit(p_status, p_period, NULL, jsonb_build_object('from', period.status, 'paid_on', p_paid_on));
  RETURN p_status;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_transition(uuid, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_transition(uuid, text, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_my_pack(p_competence text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  period public.payroll_periods;
  punches jsonb := '[]'::jsonb;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO period FROM public.payroll_periods WHERE competence = p_competence;
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', t.id, 'bar_id', t.bar_id, 'punched_at', t.punched_at, 'tipo', t.tipo, 'staff_id', t.staff_id
    )), '[]'::jsonb)
      INTO punches
    FROM public.time_clock t
    WHERE t.staff_id = me;
  EXCEPTION WHEN undefined_table THEN
    punches := '[]'::jsonb;
  END;
  RETURN jsonb_build_object(
    'employee_id', me,
    'period', CASE WHEN period.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', period.id, 'competence', period.competence, 'status', period.status, 'paid_at', period.paid_at
    ) END,
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(l))
      FROM public.payroll_lines l
      WHERE l.employee_id = me
        AND (period.id IS NULL OR l.payroll_period_id = period.id)
    ), '[]'::jsonb),
    'plans', COALESCE((
      SELECT jsonb_agg(to_jsonb(s))
      FROM public.payroll_shift_plans s
      WHERE s.employee_id = me
    ), '[]'::jsonb),
    'occurrences', COALESCE((
      SELECT jsonb_agg(to_jsonb(o))
      FROM public.payroll_occurrences o
      WHERE o.employee_id = me
    ), '[]'::jsonb),
    'points', COALESCE((
      SELECT jsonb_agg(to_jsonb(p))
      FROM public.payroll_points p
      WHERE p.employee_id = me
    ), '[]'::jsonb),
    'goals', COALESCE((
      SELECT jsonb_agg(to_jsonb(g))
      FROM public.payroll_goal_notes g
      WHERE g.employee_id = me AND (p_competence IS NULL OR g.competence = p_competence)
    ), '[]'::jsonb),
    'rewards', COALESCE((
      SELECT jsonb_agg(to_jsonb(r))
      FROM public.payroll_rewards r
      WHERE r.employee_id = me AND (p_competence IS NULL OR r.competence = p_competence)
    ), '[]'::jsonb),
    'advances', COALESCE((
      SELECT jsonb_agg(to_jsonb(a))
      FROM public.payroll_advances a
      WHERE a.employee_id = me AND (p_competence IS NULL OR a.competence = p_competence)
    ), '[]'::jsonb),
    'deductions', COALESCE((
      SELECT jsonb_agg(to_jsonb(d))
      FROM public.payroll_deductions d
      WHERE d.employee_id = me AND (p_competence IS NULL OR d.competence = p_competence)
    ), '[]'::jsonb),
    'punches', punches
  );
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_my_pack(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_my_pack(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_hq_board(
  p_competence text,
  p_bar uuid DEFAULT NULL,
  p_employee uuid DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  period public.payroll_periods;
BEGIN
  PERFORM public.payroll_require_hq();
  SELECT * INTO period FROM public.payroll_periods WHERE competence = p_competence;
  RETURN jsonb_build_object(
    'period', CASE WHEN period.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', period.id, 'competence', period.competence, 'status', period.status, 'paid_at', period.paid_at
    ) END,
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(l) || jsonb_build_object('nome', pf.nome))
      FROM public.payroll_lines l
      LEFT JOIN public.perfis pf ON pf.id = l.employee_id
      WHERE period.id IS NOT NULL
        AND l.payroll_period_id = period.id
        AND (p_bar IS NULL OR l.bar_id = p_bar)
        AND (p_employee IS NULL OR l.employee_id = p_employee)
    ), '[]'::jsonb),
    'status_filter', p_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_hq_board(text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_hq_board(text, uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_hq_write(p_kind text, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  row_id uuid;
  employee uuid;
BEGIN
  actor := public.payroll_require_hq();
  employee := NULLIF(p_payload->>'employee_id', '')::uuid;
  IF employee IS NULL THEN
    RAISE EXCEPTION 'employee_id is required';
  END IF;
  IF p_kind = 'shift_plan' THEN
    INSERT INTO public.payroll_shift_plans (employee_id, bar_id, starts_at, ends_at, created_by)
    VALUES (
      employee,
      NULLIF(p_payload->>'bar_id', '')::uuid,
      (p_payload->>'starts_at')::timestamptz,
      (p_payload->>'ends_at')::timestamptz,
      actor
    ) RETURNING id INTO row_id;
  ELSIF p_kind = 'occurrence' THEN
    INSERT INTO public.payroll_occurrences (employee_id, bar_id, note, created_by)
    VALUES (employee, NULLIF(p_payload->>'bar_id', '')::uuid, COALESCE(p_payload->>'note', ''), actor)
    RETURNING id INTO row_id;
  ELSIF p_kind = 'points' THEN
    INSERT INTO public.payroll_points (employee_id, bar_id, points, reason, source, source_id, created_by)
    VALUES (
      employee,
      NULLIF(p_payload->>'bar_id', '')::uuid,
      (p_payload->>'points')::integer,
      COALESCE(p_payload->>'reason', ''),
      NULLIF(p_payload->>'source', ''),
      NULLIF(p_payload->>'source_id', ''),
      actor
    ) RETURNING id INTO row_id;
  ELSIF p_kind = 'goal' THEN
    INSERT INTO public.payroll_goal_notes (employee_id, bar_id, competence, title, target, actual, source, source_id, created_by)
    VALUES (
      employee,
      NULLIF(p_payload->>'bar_id', '')::uuid,
      p_payload->>'competence',
      COALESCE(p_payload->>'title', ''),
      NULLIF(p_payload->>'target', '')::numeric,
      NULLIF(p_payload->>'actual', '')::numeric,
      NULLIF(p_payload->>'source', ''),
      NULLIF(p_payload->>'source_id', ''),
      actor
    ) RETURNING id INTO row_id;
  ELSIF p_kind = 'reward' THEN
    INSERT INTO public.payroll_rewards (employee_id, bar_id, competence, title, amount, status, source, source_id, created_by)
    VALUES (
      employee,
      NULLIF(p_payload->>'bar_id', '')::uuid,
      p_payload->>'competence',
      COALESCE(p_payload->>'title', ''),
      (p_payload->>'amount')::integer,
      COALESCE(NULLIF(p_payload->>'status', ''), 'draft'),
      NULLIF(p_payload->>'source', ''),
      NULLIF(p_payload->>'source_id', ''),
      actor
    ) RETURNING id INTO row_id;
  ELSIF p_kind = 'advance' THEN
    INSERT INTO public.payroll_advances (employee_id, bar_id, competence, amount, status, created_by)
    VALUES (
      employee,
      NULLIF(p_payload->>'bar_id', '')::uuid,
      p_payload->>'competence',
      (p_payload->>'amount')::integer,
      COALESCE(NULLIF(p_payload->>'status', ''), 'draft'),
      actor
    ) RETURNING id INTO row_id;
  ELSIF p_kind = 'deduction' THEN
    INSERT INTO public.payroll_deductions (employee_id, bar_id, competence, reason, amount, reference, status, created_by)
    VALUES (
      employee,
      NULLIF(p_payload->>'bar_id', '')::uuid,
      NULLIF(p_payload->>'competence', ''),
      COALESCE(p_payload->>'reason', ''),
      (p_payload->>'amount')::integer,
      NULLIF(p_payload->>'reference', ''),
      'draft',
      actor
    ) RETURNING id INTO row_id;
  ELSE
    RAISE EXCEPTION 'unknown payroll write';
  END IF;
  PERFORM public.payroll_audit(p_kind, NULL, employee, p_payload || jsonb_build_object('id', row_id));
  RETURN row_id;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_hq_write(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_hq_write(text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_approve_deduction(p_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  row public.payroll_deductions;
BEGIN
  actor := public.payroll_require_hq();
  SELECT * INTO row FROM public.payroll_deductions WHERE id = p_id;
  IF row.id IS NULL OR row.status <> 'draft' THEN
    RAISE EXCEPTION 'deduction cannot be approved';
  END IF;
  UPDATE public.payroll_deductions
    SET status = 'approved', approved_by = actor
    WHERE id = p_id;
  PERFORM public.payroll_audit('deduction', NULL, row.employee_id, jsonb_build_object('id', p_id, 'amount', row.amount, 'reason', row.reason));
  RETURN 'approved';
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_approve_deduction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_approve_deduction(uuid) TO authenticated;

ALTER TABLE public.payroll_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_shift_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_goal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_deductions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_rules_read ON public.payroll_rules;
CREATE POLICY payroll_rules_read ON public.payroll_rules
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq());

DROP POLICY IF EXISTS payroll_periods_read ON public.payroll_periods;
CREATE POLICY payroll_periods_read ON public.payroll_periods
  FOR SELECT TO authenticated
  USING (
    public.is_payroll_hq()
    OR EXISTS (
      SELECT 1 FROM public.payroll_lines l
      WHERE l.payroll_period_id = payroll_periods.id
        AND l.employee_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS payroll_lines_read ON public.payroll_lines;
CREATE POLICY payroll_lines_read ON public.payroll_lines
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq() OR employee_id = auth.uid());

DROP POLICY IF EXISTS payroll_audit_read ON public.payroll_audit;
CREATE POLICY payroll_audit_read ON public.payroll_audit
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq() OR employee_id = auth.uid());

DROP POLICY IF EXISTS payroll_plans_read ON public.payroll_shift_plans;
CREATE POLICY payroll_plans_read ON public.payroll_shift_plans
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq() OR employee_id = auth.uid());

DROP POLICY IF EXISTS payroll_occurrences_read ON public.payroll_occurrences;
CREATE POLICY payroll_occurrences_read ON public.payroll_occurrences
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq() OR employee_id = auth.uid());

DROP POLICY IF EXISTS payroll_points_read ON public.payroll_points;
CREATE POLICY payroll_points_read ON public.payroll_points
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq() OR employee_id = auth.uid());

DROP POLICY IF EXISTS payroll_goals_read ON public.payroll_goal_notes;
CREATE POLICY payroll_goals_read ON public.payroll_goal_notes
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq() OR employee_id = auth.uid());

DROP POLICY IF EXISTS payroll_rewards_read ON public.payroll_rewards;
CREATE POLICY payroll_rewards_read ON public.payroll_rewards
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq() OR employee_id = auth.uid());

DROP POLICY IF EXISTS payroll_advances_read ON public.payroll_advances;
CREATE POLICY payroll_advances_read ON public.payroll_advances
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq() OR employee_id = auth.uid());

DROP POLICY IF EXISTS payroll_deductions_read ON public.payroll_deductions;
CREATE POLICY payroll_deductions_read ON public.payroll_deductions
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq() OR employee_id = auth.uid());

REVOKE ALL ON public.payroll_rules FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_periods FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_lines FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_audit FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_shift_plans FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_occurrences FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_points FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_goal_notes FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_rewards FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_advances FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_deductions FROM PUBLIC, anon;

GRANT SELECT ON public.payroll_rules TO authenticated;
GRANT SELECT ON public.payroll_periods TO authenticated;
GRANT SELECT ON public.payroll_lines TO authenticated;
GRANT SELECT ON public.payroll_audit TO authenticated;
GRANT SELECT ON public.payroll_shift_plans TO authenticated;
GRANT SELECT ON public.payroll_occurrences TO authenticated;
GRANT SELECT ON public.payroll_points TO authenticated;
GRANT SELECT ON public.payroll_goal_notes TO authenticated;
GRANT SELECT ON public.payroll_rewards TO authenticated;
GRANT SELECT ON public.payroll_advances TO authenticated;
GRANT SELECT ON public.payroll_deductions TO authenticated;


-- ===== sql/bar_employees.sql =====

-- Bar employee directory and access lifecycle.
-- Run in the Supabase SQL editor AFTER sql/payroll.sql
-- (needs perfis, user_can_access_bar, is_procurement_hq, audit_logs).
-- Does not create a second user catalog. Employees are perfis rows.
-- Does not store passwords. Does not DROP perfis, bars, or sales history.
-- Do not run this against ojirgkqtqvugqktyuhem or fxsakrshmldmkdmbevna
-- until you intend to change that database.

CREATE TABLE IF NOT EXISTS public.bar_employees (
  id uuid PRIMARY KEY REFERENCES public.perfis(id) ON DELETE RESTRICT,
  bar_id uuid NOT NULL,
  job_role text NOT NULL,
  permission_role text NOT NULL,
  phone text,
  employee_code text,
  status text NOT NULL DEFAULT 'invited',
  start_date date,
  notes text,
  invited_at timestamptz,
  activated_at timestamptz,
  suspended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bar_employees_status_chk CHECK (status IN ('invited', 'active', 'suspended', 'inactive')),
  CONSTRAINT bar_employees_permission_chk CHECK (permission_role IN ('gerente', 'caixa', 'bar_staff')),
  CONSTRAINT bar_employees_job_chk CHECK (job_role IN ('manager', 'cashier', 'bartender', 'hostess', 'staff', 'cleaner'))
);

CREATE INDEX IF NOT EXISTS bar_employees_bar_idx ON public.bar_employees (bar_id, status);

CREATE OR REPLACE FUNCTION public.bar_employees_match_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  perfil_bar uuid;
  perfil_role text;
BEGIN
  SELECT p.bar_id, p.role INTO perfil_bar, perfil_role
  FROM public.perfis p
  WHERE p.id = NEW.id;
  IF perfil_bar IS NULL OR perfil_bar <> NEW.bar_id THEN
    RAISE EXCEPTION 'employee bar does not match profile';
  END IF;
  IF perfil_role NOT IN ('cliente', 'gerente', 'caixa', 'bar_staff') THEN
    RAISE EXCEPTION 'profile is not a bar login';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bar_employees_match_profile ON public.bar_employees;
CREATE TRIGGER bar_employees_match_profile
  BEFORE INSERT OR UPDATE ON public.bar_employees
  FOR EACH ROW EXECUTE FUNCTION public.bar_employees_match_profile();

-- Final user_can_access_bar. Same roles as sql/pos_sale_security.sql.
-- A suspended, inactive, or not-yet-accepted employee cannot use the bar.
-- Rows with no bar_employees record stay active (existing logins).
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
          p.role = 'admin'
          OR (
            p.bar_id = target_bar
            AND p.role IN ('cliente', 'gerente', 'caixa', 'bar_staff')
            AND NOT EXISTS (
              SELECT 1
              FROM public.bar_employees e
              WHERE e.id = p.id
                AND e.status IN ('suspended', 'inactive', 'invited')
            )
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.user_can_access_bar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_access_bar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_can_manage_bar_staff(target_bar uuid)
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
        AND p.bar_id = target_bar
        AND p.role IN ('cliente', 'gerente')
        AND NOT EXISTS (
          SELECT 1
          FROM public.bar_employees e
          WHERE e.id = p.id
            AND e.status IN ('suspended', 'inactive', 'invited')
        )
    );
$$;

REVOKE ALL ON FUNCTION public.user_can_manage_bar_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_manage_bar_staff(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bar_permission_for_job(p_job text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(btrim(COALESCE(p_job, '')))
    WHEN 'manager' THEN 'gerente'
    WHEN 'cashier' THEN 'caixa'
    WHEN 'bartender' THEN 'bar_staff'
    WHEN 'hostess' THEN 'bar_staff'
    WHEN 'staff' THEN 'bar_staff'
    WHEN 'cleaner' THEN 'bar_staff'
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.bar_permission_for_job(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bar_permission_for_job(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.bar_accept_invitation()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.bar_employees%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO row FROM public.bar_employees WHERE id = auth.uid();
  IF row.id IS NULL OR row.status <> 'invited' THEN
    RETURN;
  END IF;
  UPDATE public.bar_employees
  SET status = 'active', activated_at = now(), updated_at = now()
  WHERE id = auth.uid();
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'invitation_accepted', 'bar_employees', auth.uid(),
    jsonb_build_object('bar_id', row.bar_id));
END;
$$;

REVOKE ALL ON FUNCTION public.bar_accept_invitation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bar_accept_invitation() TO authenticated;

CREATE OR REPLACE FUNCTION public.bar_set_employee_access(
  p_employee uuid,
  p_status text,
  p_job_role text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp public.bar_employees%ROWTYPE;
  actor_role text;
  actor_bar uuid;
  target_role text;
  next_perm text;
  action text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_status NOT IN ('active', 'suspended', 'inactive') THEN
    RAISE EXCEPTION 'status not allowed';
  END IF;
  SELECT * INTO emp FROM public.bar_employees WHERE id = p_employee;
  IF emp.id IS NULL THEN
    RAISE EXCEPTION 'employee not found';
  END IF;
  SELECT p.role, p.bar_id INTO actor_role, actor_bar
  FROM public.perfis p WHERE p.id = auth.uid();
  SELECT p.role INTO target_role FROM public.perfis p WHERE p.id = p_employee;

  IF NOT (
    public.is_procurement_hq()
    OR (
      actor_role IN ('cliente', 'gerente')
      AND actor_bar = emp.bar_id
      AND public.user_can_manage_bar_staff(emp.bar_id)
    )
  ) THEN
    RAISE EXCEPTION 'bar not allowed';
  END IF;
  IF NOT public.is_procurement_hq() AND target_role = 'cliente' THEN
    RAISE EXCEPTION 'cannot edit the bar owner';
  END IF;

  next_perm := emp.permission_role;
  IF p_job_role IS NOT NULL AND btrim(p_job_role) <> '' THEN
    next_perm := public.bar_permission_for_job(p_job_role);
    IF next_perm IS NULL THEN
      RAISE EXCEPTION 'unknown role';
    END IF;
    IF next_perm IS DISTINCT FROM emp.permission_role OR lower(btrim(p_job_role)) IS DISTINCT FROM emp.job_role THEN
      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
      VALUES (auth.uid(), 'role_changed', 'bar_employees', emp.id,
        jsonb_build_object('bar_id', emp.bar_id, 'from', emp.job_role, 'to', lower(btrim(p_job_role))));
    END IF;
    UPDATE public.bar_employees
    SET job_role = lower(btrim(p_job_role)), permission_role = next_perm, updated_at = now()
    WHERE id = emp.id;
    IF target_role IS DISTINCT FROM 'cliente' THEN
      UPDATE public.perfis SET role = next_perm WHERE id = emp.id AND bar_id = emp.bar_id;
    END IF;
  END IF;

  IF p_status IS DISTINCT FROM emp.status THEN
    action := CASE p_status
      WHEN 'suspended' THEN 'employee_suspended'
      WHEN 'inactive' THEN 'employee_removed'
      WHEN 'active' THEN 'employee_reactivated'
      ELSE 'account_access_changed'
    END;
    UPDATE public.bar_employees
    SET status = p_status,
        suspended_at = CASE WHEN p_status = 'suspended' THEN now() ELSE suspended_at END,
        activated_at = CASE WHEN p_status = 'active' AND activated_at IS NULL THEN now() ELSE activated_at END,
        updated_at = now()
    WHERE id = emp.id;
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    VALUES (auth.uid(), action, 'bar_employees', emp.id,
      jsonb_build_object('bar_id', emp.bar_id, 'from', emp.status, 'to', p_status));
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.bar_set_employee_access(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bar_set_employee_access(uuid, text, text) TO authenticated;

-- Login screen. Returns nothing, so it does not reveal whether the email exists.
CREATE OR REPLACE FUNCTION public.bar_note_password_recovery(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
BEGIN
  SELECT p.id INTO uid
  FROM public.perfis p
  WHERE lower(p.email) = lower(btrim(COALESCE(p_email, '')))
  LIMIT 1;
  IF uid IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (uid, 'password_recovery_requested', 'perfis', uid, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.bar_note_password_recovery(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bar_note_password_recovery(text) TO anon, authenticated;

ALTER TABLE public.bar_employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bar_employees_read ON public.bar_employees;
CREATE POLICY bar_employees_read ON public.bar_employees
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.user_can_access_bar(bar_id)
    OR public.is_procurement_hq()
  );

DROP POLICY IF EXISTS bar_employees_insert ON public.bar_employees;
CREATE POLICY bar_employees_insert ON public.bar_employees
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_manage_bar_staff(bar_id));

DROP POLICY IF EXISTS bar_employees_update ON public.bar_employees;
CREATE POLICY bar_employees_update ON public.bar_employees
  FOR UPDATE TO authenticated
  USING (public.user_can_manage_bar_staff(bar_id) OR public.is_procurement_hq())
  WITH CHECK (public.user_can_manage_bar_staff(bar_id) OR public.is_procurement_hq());

REVOKE ALL ON public.bar_employees FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.bar_employees TO authenticated;


-- ===== sql/pos_ux.sql =====

-- POS configuration for one bar: favorites, AI weights, service, tax, card surcharge.
-- Do not run this on ojirgkqtqvugqktyuhem or fxsakrshmldmkdmbevna.
-- It does not create a second product, order, or sale table.
-- Drink prices stay on drink_menu and bar_pricing.
-- The sale is still written by pos_close_ticket.
-- Run this only after sql/pos_floor.sql, on a disposable database.

CREATE TABLE IF NOT EXISTS public.pos_bar_config (
  bar_id uuid PRIMARY KEY REFERENCES public.bars(id) ON DELETE CASCADE,
  service_enabled boolean NOT NULL DEFAULT false,
  service_type text NOT NULL DEFAULT 'percentage' CHECK (service_type IN ('percentage', 'fixed')),
  service_value numeric NOT NULL DEFAULT 0 CHECK (service_value >= 0),
  service_dine_in boolean NOT NULL DEFAULT true,
  service_takeaway boolean NOT NULL DEFAULT false,
  service_delivery boolean NOT NULL DEFAULT false,
  tax_enabled boolean NOT NULL DEFAULT false,
  tax_rate numeric NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  card_surcharge_enabled boolean NOT NULL DEFAULT false,
  card_credit_pct numeric NOT NULL DEFAULT 0 CHECK (card_credit_pct >= 0),
  card_debit_pct numeric NOT NULL DEFAULT 0 CHECK (card_debit_pct >= 0),
  card_other_pct numeric NOT NULL DEFAULT 0 CHECK (card_other_pct >= 0),
  ai_enabled boolean NOT NULL DEFAULT false,
  ai_weights jsonb NOT NULL DEFAULT '{}'::jsonb,
  favorites jsonb NOT NULL DEFAULT '[]'::jsonb,
  featured jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_bar_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_bar_config_read ON public.pos_bar_config;
CREATE POLICY pos_bar_config_read ON public.pos_bar_config
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.perfis p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'jbm')
          OR (
            p.bar_id = pos_bar_config.bar_id
            AND p.role IN ('cliente', 'gerente', 'caixa', 'bar_staff')
          )
        )
    )
  );

DROP POLICY IF EXISTS pos_bar_config_write ON public.pos_bar_config;
CREATE POLICY pos_bar_config_write ON public.pos_bar_config
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.perfis p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'jbm')
          OR (p.bar_id = pos_bar_config.bar_id AND p.role IN ('cliente', 'gerente'))
        )
    )
  );

DROP POLICY IF EXISTS pos_bar_config_update ON public.pos_bar_config;
CREATE POLICY pos_bar_config_update ON public.pos_bar_config
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.perfis p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'jbm')
          OR (p.bar_id = pos_bar_config.bar_id AND p.role IN ('cliente', 'gerente'))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.perfis p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'jbm')
          OR (p.bar_id = pos_bar_config.bar_id AND p.role IN ('cliente', 'gerente'))
        )
    )
  );

REVOKE ALL ON public.pos_bar_config FROM PUBLIC;
REVOKE ALL ON public.pos_bar_config FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.pos_bar_config TO authenticated;

-- Same numbers as quoteSale in src/lib/posEngine.js.
-- Tax is on the drink subtotal only.
-- Card surcharge is once, on subtotal + service + tax.
-- card = debit rate, credit = credit rate, cash = none.
CREATE OR REPLACE FUNCTION public.pos_quote_charges(
  p_bar uuid,
  p_subtotal integer,
  p_payment text,
  p_point text DEFAULT 'dine-in'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg public.pos_bar_config;
  base integer := GREATEST(COALESCE(p_subtotal, 0), 0);
  service integer := 0;
  tax integer := 0;
  surcharge integer := 0;
  pct numeric := 0;
  apply_service boolean := false;
BEGIN
  PERFORM public.pos_require_bar(p_bar);
  SELECT * INTO cfg FROM public.pos_bar_config WHERE bar_id = p_bar;
  IF cfg.bar_id IS NOT NULL AND cfg.service_enabled THEN
    apply_service := (p_point = 'dine-in' AND cfg.service_dine_in)
      OR (p_point = 'takeaway' AND cfg.service_takeaway)
      OR (p_point = 'delivery' AND cfg.service_delivery);
    IF apply_service THEN
      IF cfg.service_type = 'fixed' THEN
        service := round(GREATEST(cfg.service_value, 0))::integer;
      ELSE
        service := round(base * GREATEST(cfg.service_value, 0) / 100.0)::integer;
      END IF;
    END IF;
  END IF;
  IF cfg.bar_id IS NOT NULL AND cfg.tax_enabled THEN
    tax := round(base * GREATEST(cfg.tax_rate, 0) / 100.0)::integer;
  END IF;
  IF cfg.bar_id IS NOT NULL AND cfg.card_surcharge_enabled THEN
    IF p_payment = 'credit' THEN
      pct := cfg.card_credit_pct;
    ELSIF p_payment = 'card' THEN
      pct := cfg.card_debit_pct;
    ELSIF p_payment = 'other' THEN
      pct := cfg.card_other_pct;
    ELSE
      pct := 0;
    END IF;
    surcharge := round((base + service + tax) * GREATEST(pct, 0) / 100.0)::integer;
  END IF;
  RETURN jsonb_build_object(
    'subtotal', base,
    'service', service,
    'tax', tax,
    'surcharge', surcharge,
    'total', base + service + tax + surcharge
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_quote_charges(uuid, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_quote_charges(uuid, integer, text, text) TO authenticated;

-- One transaction with the existing close. A second tap with the same key
-- comes back as duplicate and does not add the charges again.
CREATE OR REPLACE FUNCTION public.pos_close_with_charges(
  p_bar uuid,
  p_ticket uuid,
  p_payment text,
  p_key text,
  p_agent uuid DEFAULT NULL,
  p_point text DEFAULT 'dine-in'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  venda uuid;
  subtotal integer;
  quote jsonb;
  service integer;
  tax integer;
  surcharge integer;
  customer integer;
  updated integer;
BEGIN
  result := public.pos_close_ticket(p_bar, p_ticket, p_payment, p_key, p_agent);
  IF COALESCE(result->>'duplicate', '') = 'true' THEN
    RETURN result;
  END IF;
  venda := (result->>'venda_id')::uuid;
  subtotal := COALESCE((result->>'total')::integer, 0);
  quote := public.pos_quote_charges(p_bar, subtotal, p_payment, p_point);
  service := COALESCE((quote->>'service')::integer, 0);
  tax := COALESCE((quote->>'tax')::integer, 0);
  surcharge := COALESCE((quote->>'surcharge')::integer, 0);
  customer := COALESCE((quote->>'total')::integer, subtotal);
  IF service + tax + surcharge = 0 THEN
    RETURN result || jsonb_build_object('customer_total', subtotal, 'service', 0, 'tax', 0, 'surcharge', 0);
  END IF;
  IF customer <> subtotal + service + tax + surcharge THEN
    RAISE EXCEPTION 'charge total does not add up';
  END IF;

  UPDATE public.pos_vendas
    SET total = customer,
        obs = concat_ws(E'\n', NULLIF(obs, ''), format('Charge: service=%s tax=%s surcharge=%s', service, tax, surcharge))
    WHERE id = venda AND bar_id = p_bar;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale not in this bar';
  END IF;

  UPDATE public.caixa_movimentos
    SET valor = customer
    WHERE referencia_id = venda
      AND referencia_tipo = 'pos_venda'
      AND tipo = 'entrada'
      AND bar_id = p_bar;
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated <> 1 THEN
    RAISE EXCEPTION 'till cash line missing';
  END IF;

  RETURN result || jsonb_build_object(
    'customer_total', customer,
    'service', service,
    'tax', tax,
    'surcharge', surcharge
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_close_with_charges(uuid, uuid, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_close_with_charges(uuid, uuid, text, text, uuid, text) TO authenticated;


-- Tenant policies for objects created above and not locked by the copied scripts.
-- Writes from the browser must carry the signed-in bar. HQ (admin, jbm) sees the platform rows.
-- Definer functions (pos_close_ticket and the clock guard) are not a substitute for these policies.

ALTER TABLE public.pos_vendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_vendas_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drink_menu ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bar_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bar_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bar_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bar_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_clock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cast_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cast_comissoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_vendas_tenant ON public.pos_vendas;
CREATE POLICY pos_vendas_tenant ON public.pos_vendas
  FOR ALL TO authenticated
  USING (public.user_can_access_bar(bar_id) OR public.is_procurement_hq())
  WITH CHECK (public.user_can_access_bar(bar_id) OR public.is_procurement_hq());

DROP POLICY IF EXISTS pos_vendas_itens_tenant ON public.pos_vendas_itens;
CREATE POLICY pos_vendas_itens_tenant ON public.pos_vendas_itens
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pos_vendas v
      WHERE v.id = pos_vendas_itens.pos_venda_id
        AND (public.user_can_access_bar(v.bar_id) OR public.is_procurement_hq())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.pos_vendas v
      WHERE v.id = pos_vendas_itens.pos_venda_id
        AND (public.user_can_access_bar(v.bar_id) OR public.is_procurement_hq())
    )
  );

DROP POLICY IF EXISTS drink_menu_read ON public.drink_menu;
CREATE POLICY drink_menu_read ON public.drink_menu
  FOR SELECT TO authenticated
  USING (public.user_can_access_bar(bar_id) OR public.is_procurement_hq());

DROP POLICY IF EXISTS drink_menu_write ON public.drink_menu;
CREATE POLICY drink_menu_write ON public.drink_menu
  FOR ALL TO authenticated
  USING (public.user_can_manage_bar_staff(bar_id) OR public.is_procurement_hq())
  WITH CHECK (public.user_can_manage_bar_staff(bar_id) OR public.is_procurement_hq());

DROP POLICY IF EXISTS bar_pricing_read ON public.bar_pricing;
CREATE POLICY bar_pricing_read ON public.bar_pricing
  FOR SELECT TO authenticated
  USING (public.user_can_access_bar(bar_id) OR public.is_procurement_hq());

DROP POLICY IF EXISTS bar_pricing_write ON public.bar_pricing;
CREATE POLICY bar_pricing_write ON public.bar_pricing
  FOR ALL TO authenticated
  USING (public.user_can_manage_bar_staff(bar_id) OR public.is_procurement_hq())
  WITH CHECK (public.user_can_manage_bar_staff(bar_id) OR public.is_procurement_hq());

DROP POLICY IF EXISTS bar_spaces_tenant ON public.bar_spaces;
DROP POLICY IF EXISTS bar_spaces_read ON public.bar_spaces;
CREATE POLICY bar_spaces_read ON public.bar_spaces
  FOR SELECT TO authenticated
  USING (public.user_can_access_bar(bar_id) OR public.is_procurement_hq());

DROP POLICY IF EXISTS bar_spaces_write ON public.bar_spaces;
CREATE POLICY bar_spaces_write ON public.bar_spaces
  FOR ALL TO authenticated
  USING (public.user_can_manage_bar_staff(bar_id) OR public.is_procurement_hq())
  WITH CHECK (public.user_can_manage_bar_staff(bar_id) OR public.is_procurement_hq());

DROP POLICY IF EXISTS bar_guests_tenant ON public.bar_guests;
CREATE POLICY bar_guests_tenant ON public.bar_guests
  FOR ALL TO authenticated
  USING (public.user_can_access_bar(bar_id) OR public.is_procurement_hq())
  WITH CHECK (public.user_can_access_bar(bar_id) OR public.is_procurement_hq());

DROP POLICY IF EXISTS bar_visits_tenant ON public.bar_visits;
CREATE POLICY bar_visits_tenant ON public.bar_visits
  FOR ALL TO authenticated
  USING (public.user_can_access_bar(bar_id) OR public.is_procurement_hq())
  WITH CHECK (public.user_can_access_bar(bar_id) OR public.is_procurement_hq());

DROP POLICY IF EXISTS time_clock_read ON public.time_clock;
CREATE POLICY time_clock_read ON public.time_clock
  FOR SELECT TO authenticated
  USING (
    staff_id = auth.uid()
    OR public.user_can_access_bar(bar_id)
    OR public.is_procurement_hq()
  );

DROP POLICY IF EXISTS time_clock_write ON public.time_clock;
CREATE POLICY time_clock_write ON public.time_clock
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      staff_id = auth.uid()
      AND public.user_can_access_bar(bar_id)
    )
    OR public.user_can_manage_bar_staff(bar_id)
    OR public.is_procurement_hq()
  );

DROP POLICY IF EXISTS cast_members_tenant ON public.cast_members;
DROP POLICY IF EXISTS cast_members_read ON public.cast_members;
CREATE POLICY cast_members_read ON public.cast_members
  FOR SELECT TO authenticated
  USING (public.user_can_access_bar(bar_id) OR public.is_procurement_hq());

DROP POLICY IF EXISTS cast_members_write ON public.cast_members;
CREATE POLICY cast_members_write ON public.cast_members
  FOR ALL TO authenticated
  USING (public.user_can_manage_bar_staff(bar_id) OR public.is_procurement_hq())
  WITH CHECK (public.user_can_manage_bar_staff(bar_id) OR public.is_procurement_hq());

DROP POLICY IF EXISTS cast_comissoes_tenant ON public.cast_comissoes;
CREATE POLICY cast_comissoes_tenant ON public.cast_comissoes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cast_members c
      WHERE c.id = cast_comissoes.cast_id
        AND (public.user_can_access_bar(c.bar_id) OR public.is_procurement_hq())
    )
  );

-- Existing cash table. Null bar_id stays visible to HQ only.
-- Bar users see only rows stamped with their bar.
ALTER TABLE public.caixa_movimentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS caixa_movimentos_tenant ON public.caixa_movimentos;
CREATE POLICY caixa_movimentos_tenant ON public.caixa_movimentos
  FOR ALL TO authenticated
  USING (
    public.is_procurement_hq()
    OR (bar_id IS NOT NULL AND public.user_can_access_bar(bar_id))
  )
  WITH CHECK (
    public.is_procurement_hq()
    OR (bar_id IS NOT NULL AND public.user_can_access_bar(bar_id))
  );

REVOKE ALL ON public.pos_vendas FROM PUBLIC, anon;
REVOKE ALL ON public.pos_vendas_itens FROM PUBLIC, anon;
REVOKE ALL ON public.drink_menu FROM PUBLIC, anon;
REVOKE ALL ON public.bar_pricing FROM PUBLIC, anon;
REVOKE ALL ON public.bar_spaces FROM PUBLIC, anon;
REVOKE ALL ON public.bar_guests FROM PUBLIC, anon;
REVOKE ALL ON public.bar_visits FROM PUBLIC, anon;
REVOKE ALL ON public.time_clock FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_vendas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_vendas_itens TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.drink_menu TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bar_pricing TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bar_spaces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bar_guests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bar_visits TO authenticated;
GRANT SELECT, INSERT ON public.time_clock TO authenticated;
