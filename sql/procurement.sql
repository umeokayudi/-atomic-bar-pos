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
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'procurement_tasks_qty_chk'
  ) THEN
    ALTER TABLE public.procurement_tasks
      ADD CONSTRAINT procurement_tasks_qty_chk CHECK (
        quantity_purchased >= 0
        AND quantity_received >= 0
        AND quantity_at_bar >= 0
        AND quantity_purchased <= quantity_allocated
        AND quantity_received <= quantity_purchased
        AND quantity_at_bar <= quantity_received
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
        WHEN 'in_transit' THEN 'in_transit'
        WHEN 'delivered' THEN 'in_transit'
        WHEN 'partial' THEN 'partially_received'
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
CREATE OR REPLACE FUNCTION public.submit_bar_order(
  p_bar_id uuid,
  p_need timestamptz,
  p_obs text,
  p_items jsonb
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.is_procurement_hq() OR public.user_can_access_bar(p_bar_id)) THEN
    RAISE EXCEPTION 'not allowed';
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
  RETURN public.plan_procurement(order_id, p_need) || jsonb_build_object('total', total);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_bar_order(uuid, timestamptz, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_bar_order(uuid, timestamptz, text, jsonb) TO authenticated;

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
            'actual_total_cost', CASE WHEN audience = 'jbm' THEN t.actual_total_cost ELSE NULL END
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
      'buy_by_at', t.buy_by_at
    ) ORDER BY t.created_at DESC)
    FROM public.procurement_tasks t
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
  ELSIF linked AND p_action IN ('in_transit', 'delivered', 'partial') THEN
    UPDATE public.procurement_tasks
    SET status = CASE WHEN p_action = 'partial' THEN 'partially_received' ELSE 'in_transit' END,
        updated_at = now()
    WHERE assignment_id = asg.id AND status NOT IN ('completed', 'cancelled');
  END IF;

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
