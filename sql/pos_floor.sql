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
ALTER TABLE public.pos_tickets ADD COLUMN IF NOT EXISTS discount_total integer NOT NULL DEFAULT 0;
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

-- JBM is not a platform pass. A jbm profile reaches a bar only through
-- bar_memberships, or through platform_access scope hq (audited below).
CREATE TABLE IF NOT EXISTS public.bar_memberships (
  user_id uuid NOT NULL,
  bar_id uuid NOT NULL,
  role text NOT NULL,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (user_id, bar_id)
);

CREATE TABLE IF NOT EXISTS public.platform_access (
  user_id uuid PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('hq')),
  granted_by uuid,
  reason text,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.platform_access_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  bar_id uuid,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.pos_require_bar(p_bar uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  hq boolean;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF public.user_can_access_bar(p_bar) THEN
    RETURN actor;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.bar_memberships m
    WHERE m.user_id = actor AND m.bar_id = p_bar AND m.revoked_at IS NULL
  ) THEN
    RETURN actor;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.platform_access a
    JOIN public.perfis p ON p.id = a.user_id
    WHERE a.user_id = actor
      AND a.scope = 'hq'
      AND a.revoked_at IS NULL
      AND p.role IN ('admin', 'jbm')
  ) INTO hq;
  IF hq THEN
    INSERT INTO public.platform_access_audit (user_id, bar_id, action)
    VALUES (actor, p_bar, 'pos_require_bar');
    RETURN actor;
  END IF;
  RAISE EXCEPTION 'bar not allowed';
END;
$$;

REVOKE ALL ON FUNCTION public.pos_require_bar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_require_bar(uuid) TO authenticated;

-- Real clock stays in caixa_movimentos.data. operational_day is the till night:
-- 00:00–05:59 Asia/Tokyo belongs to the previous night; 06:00 starts the new one.
ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS operational_day date;

UPDATE public.caixa_movimentos
SET operational_day = public.pos_tokyo_night(data::timestamptz)
WHERE operational_day IS NULL
  AND data IS NOT NULL;

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
  discount integer := 0;
  net integer := 0;
  paid integer := 0;
  cash_in integer := 0;
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

  discount := LEAST(GREATEST(COALESCE(ticket.discount_total, 0), 0), subtotal);
  net := subtotal - discount;
  IF net <= 0 THEN
    RAISE EXCEPTION 'order is empty';
  END IF;

  paid := 0;
  BEGIN
    SELECT COALESCE(SUM(amount), 0)::integer INTO paid
    FROM public.pos_sale_payments
    WHERE ticket_id = p_ticket AND pos_venda_id IS NULL;
  EXCEPTION WHEN undefined_table THEN
    paid := 0;
  END;
  IF paid > 0 AND paid <> net THEN
    RAISE EXCEPTION 'payment does not reconcile';
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

  IF paid > 0 THEN
    BEGIN
      SELECT COALESCE(SUM(p.fee), 0)::integer INTO fee
      FROM public.pos_sale_payments p
      WHERE p.ticket_id = p_ticket AND p.pos_venda_id IS NULL;
    EXCEPTION WHEN undefined_table THEN
      fee := 0;
    END;
  ELSIF p_payment IN ('card', 'credit') THEN
    fee := round(net * 0.0378);
  END IF;

  INSERT INTO public.pos_vendas (
    bar_id, data, subtotal, desconto_total, total, metodo_pagamento, tipo, criado_por,
    comissao_valor, drink_back_agent_id, card_fee
  ) VALUES (
    p_bar, night, subtotal, discount, net,
    CASE WHEN paid > 0 THEN 'split' ELSE COALESCE(p_payment, 'cash') END,
    'balcao', actor,
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

  cash_in := 0;
  IF paid > 0 THEN
    SELECT COALESCE(SUM(amount), 0)::integer INTO cash_in
    FROM public.pos_sale_payments
    WHERE ticket_id = p_ticket AND pos_venda_id IS NULL AND method IN ('cash', 'dinheiro');
  ELSIF COALESCE(p_payment, 'cash') IN ('cash', 'dinheiro') THEN
    cash_in := net;
  END IF;
  IF cash_in > 0 THEN
    INSERT INTO public.caixa_movimentos (bar_id, tipo, valor, descricao, referencia_id, referencia_tipo, data, operational_day)
    VALUES (
      p_bar, 'entrada', cash_in,
      'POS ' || CASE WHEN paid > 0 THEN 'cash' ELSE COALESCE(p_payment, 'cash') END,
      venda, 'pos_venda', now(), night
    );
  END IF;

  BEGIN
    IF paid = 0 THEN
      INSERT INTO public.pos_sale_payments (bar_id, ticket_id, pos_venda_id, method, amount, fee)
      VALUES (
        p_bar, p_ticket, venda, COALESCE(p_payment, 'cash'), net,
        CASE WHEN COALESCE(p_payment, 'cash') IN ('card', 'credit') THEN fee ELSE 0 END
      );
    ELSE
      UPDATE public.pos_sale_payments
        SET pos_venda_id = venda
        WHERE ticket_id = p_ticket AND pos_venda_id IS NULL;
    END IF;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

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
    'total', net,
    'discount', discount,
    'fee', fee,
    'net', net - fee,
    'commission', commission,
    'duplicate', false,
    'night', night
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_close_ticket(uuid, uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_close_ticket(uuid, uuid, text, text, uuid) TO authenticated;

-- applied rows commit with the void. denied rows are written through dblink
-- so they survive the statement that raises. Callers cannot set result.
CREATE EXTENSION IF NOT EXISTS dblink;

CREATE TABLE IF NOT EXISTS public.pos_void_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  bar_id uuid NOT NULL,
  venda_id uuid,
  reason text,
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_void_audit DROP CONSTRAINT IF EXISTS pos_void_audit_result_chk;
ALTER TABLE public.pos_void_audit
  ADD CONSTRAINT pos_void_audit_result_chk CHECK (result IN ('applied', 'denied'));

CREATE OR REPLACE FUNCTION public.pos_record_void_denial(
  p_user uuid,
  p_bar uuid,
  p_venda uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user IS NULL OR p_bar IS NULL THEN
    RAISE EXCEPTION 'void audit failed';
  END IF;
  PERFORM public.dblink_exec(
    format('dbname=%s', current_database()),
    format(
      'INSERT INTO public.pos_void_audit (user_id, bar_id, venda_id, reason, result) VALUES (%L, %L, %L, %L, %L)',
      p_user,
      p_bar,
      p_venda,
      left(COALESCE(p_reason, ''), 500),
      'denied'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_record_void_denial(uuid, uuid, uuid, text) FROM PUBLIC;

DO $$
DECLARE
  sig regprocedure;
BEGIN
  FOR sig IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'dblink%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', sig);
  END LOOP;
END $$;

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
  BEGIN
    actor := public.pos_require_bar(sale.bar_id);
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'bar not allowed' AND auth.uid() IS NOT NULL THEN
        PERFORM public.pos_record_void_denial(auth.uid(), sale.bar_id, sale.id, p_reason);
      END IF;
      RAISE;
  END;
  IF p_approver IS DISTINCT FROM actor
    OR NOT (
      EXISTS (
        SELECT 1 FROM public.perfis p
        WHERE p.id = actor AND p.role = 'gerente' AND p.bar_id = sale.bar_id
      )
      OR EXISTS (
        SELECT 1 FROM public.bar_memberships m
        WHERE m.user_id = actor
          AND m.bar_id = sale.bar_id
          AND m.role = 'gerente'
          AND m.revoked_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.platform_access a
        JOIN public.perfis p ON p.id = a.user_id
        WHERE a.user_id = actor
          AND a.scope = 'hq'
          AND a.revoked_at IS NULL
          AND p.role IN ('admin', 'jbm')
      )
    )
  THEN
    PERFORM public.pos_record_void_denial(actor, sale.bar_id, sale.id, p_reason);
    RAISE EXCEPTION 'void not allowed';
  END IF;
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
  IF sale.metodo_pagamento IN ('cash', 'dinheiro') THEN
    INSERT INTO public.caixa_movimentos (bar_id, tipo, valor, descricao, referencia_id, referencia_tipo, data, operational_day)
    VALUES (sale.bar_id, 'saida', value, 'POS ' || p_kind, sale.id, 'pos_void', now(), void_night);
  ELSIF sale.metodo_pagamento = 'split' THEN
    INSERT INTO public.caixa_movimentos (bar_id, tipo, valor, descricao, referencia_id, referencia_tipo, data, operational_day)
    SELECT sale.bar_id, 'saida',
      LEAST(value, COALESCE(SUM(amount), 0)::integer),
      'POS ' || p_kind, sale.id, 'pos_void', now(), void_night
    FROM public.pos_sale_payments
    WHERE pos_venda_id = sale.id AND method IN ('cash', 'dinheiro')
    HAVING COALESCE(SUM(amount), 0) > 0;
  END IF;

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

  INSERT INTO public.pos_void_audit (user_id, bar_id, venda_id, reason, result)
  VALUES (actor, sale.bar_id, sale.id, p_reason, 'applied');

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
