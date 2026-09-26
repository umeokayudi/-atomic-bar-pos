-- Supplier fulfillment for drink orders.
-- Run once in the Supabase SQL editor (drinks project).
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
      AND p.role IN ('admin', 'funcionario', 'jbm')
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
