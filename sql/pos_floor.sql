-- Atomic till floor. Open bottles sit on top of estoque_movimentos.
-- Sales stay in pos_vendas. Cash stays in caixa_movimentos.
-- Does not write vendas, faturas, or procurement tables.
-- Apply manually in the Supabase SQL editor. This repository does not apply it.

CREATE TABLE IF NOT EXISTS public.pos_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL,
  space_id uuid,
  guest_label text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'void')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pos_ticket_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.pos_tickets(id),
  drink_menu_id uuid,
  produto_id uuid,
  qtd integer NOT NULL CHECK (qtd > 0),
  for_cast boolean NOT NULL DEFAULT false
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
  venda_id uuid NOT NULL,
  bar_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('void', 'refund', 'partial_refund')),
  amount integer NOT NULL,
  reason text NOT NULL,
  employee_id uuid NOT NULL,
  approver_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS drink_back_agent_id uuid;
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS comissao_valor integer DEFAULT 0;
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS void_status text;
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS refunded integer DEFAULT 0;

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
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items required';
  END IF;
  IF p_ticket IS NULL THEN
    INSERT INTO public.pos_tickets (bar_id, space_id, guest_label, created_by)
    VALUES (p_bar, p_space, NULLIF(p_guest, ''), actor)
    RETURNING id INTO ticket;
  ELSE
    UPDATE public.pos_tickets
      SET space_id = p_space, guest_label = NULLIF(p_guest, '')
      WHERE id = p_ticket AND bar_id = p_bar AND status = 'open'
      RETURNING id INTO ticket;
    IF ticket IS NULL THEN
      RAISE EXCEPTION 'ticket not open';
    END IF;
    DELETE FROM public.pos_ticket_items WHERE ticket_id = ticket;
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE((item->>'qtd')::integer, 0) <= 0 THEN
      RAISE EXCEPTION 'invalid quantity';
    END IF;
    INSERT INTO public.pos_ticket_items (ticket_id, drink_menu_id, produto_id, qtd, for_cast)
    VALUES (
      ticket,
      NULLIF(item->>'drink_menu_id', '')::uuid,
      NULLIF(item->>'produto_id', '')::uuid,
      (item->>'qtd')::integer,
      COALESCE((item->>'for_cast')::boolean, false)
    );
  END LOOP;
  RETURN ticket;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_save_ticket(uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_save_ticket(uuid, uuid, uuid, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_open_bottle(
  p_bar uuid,
  p_produto uuid,
  p_code text,
  p_volume integer
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
BEGIN
  actor := public.pos_require_bar(p_bar);
  IF p_code IS NULL OR btrim(p_code) = '' OR p_volume IS NULL OR p_volume <= 0 THEN
    RAISE EXCEPTION 'bottle code and volume required';
  END IF;
  SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN qtd ELSE -qtd END), 0)
    INTO sealed
  FROM public.estoque_movimentos
  WHERE bar_id = p_bar AND produto_id = p_produto;
  IF sealed < 1 THEN
    RAISE EXCEPTION 'bottle not in stock';
  END IF;
  INSERT INTO public.estoque_movimentos (produto_id, bar_id, tipo, qtd, criado_por, obs)
  VALUES (p_produto, p_bar, 'saida', 1, actor, 'bottle_open');
  INSERT INTO public.pos_bottles (
    code, produto_id, bar_id, status, volume_original, volume_atual, opened_at, opened_by
  ) VALUES (
    btrim(p_code), p_produto, p_bar, 'opened', p_volume, p_volume, now(), actor
  ) RETURNING id INTO bottle;
  INSERT INTO public.pos_bottle_moves (bottle_id, bar_id, produto_id, kind, volume_ml, employee_id, reason)
  VALUES (bottle, p_bar, p_produto, 'open', p_volume, actor, 'open');
  RETURN bottle;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_open_bottle(uuid, uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_open_bottle(uuid, uuid, text, integer) TO authenticated;

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
  VALUES (bottle.id, bottle.bar_id, bottle.produto_id, p_kind, p_volume, actor, COALESCE(p_reason, p_kind))
  RETURNING id INTO move_id;
  RETURN move_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_bottle_move(uuid, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_bottle_move(uuid, text, integer, text) TO authenticated;

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
  item record;
  price integer;
  nome text;
  qty integer;
  subtotal integer := 0;
  fee integer := 0;
  commission integer := 0;
  pct numeric := 0;
  venda uuid;
  item_id uuid;
  part record;
  bottle public.pos_bottles;
  left_ml integer;
  take integer;
  night date;
BEGIN
  actor := public.pos_require_bar(p_bar);
  IF p_key IS NULL OR btrim(p_key) = '' THEN
    RAISE EXCEPTION 'idempotency key required';
  END IF;
  SELECT venda_id INTO existing FROM public.pos_idempotency WHERE bar_id = p_bar AND key = p_key;
  IF existing IS NOT NULL THEN
    RETURN jsonb_build_object('venda_id', existing, 'duplicate', true);
  END IF;
  INSERT INTO public.pos_idempotency (bar_id, key) VALUES (p_bar, p_key);

  IF NOT EXISTS (
    SELECT 1 FROM public.pos_tickets WHERE id = p_ticket AND bar_id = p_bar AND status = 'open'
  ) THEN
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

  night := public.pos_tokyo_night(now());

  CREATE TEMP TABLE IF NOT EXISTS pos_close_lines (
    drink_menu_id uuid,
    produto_id uuid,
    nome text,
    qtd integer,
    unit_price integer,
    for_cast boolean
  ) ON COMMIT DROP;
  TRUNCATE pos_close_lines;

  FOR item IN
    SELECT * FROM public.pos_ticket_items WHERE ticket_id = p_ticket
  LOOP
    qty := item.qtd;
    price := NULL;
    nome := '';
    IF item.drink_menu_id IS NOT NULL THEN
      SELECT round(d.preco_venda)::integer, d.nome
        INTO price, nome
      FROM public.drink_menu d
      WHERE d.id = item.drink_menu_id AND d.bar_id = p_bar;
    ELSIF item.produto_id IS NOT NULL THEN
      SELECT round(bp.preco_drink)::integer, p.nome
        INTO price, nome
      FROM public.bar_pricing bp
      JOIN public.produtos p ON p.id = bp.produto_id
      WHERE bp.produto_id = item.produto_id AND bp.bar_id = p_bar;
    END IF;
    IF price IS NULL THEN
      RAISE EXCEPTION 'product not in this bar';
    END IF;
    INSERT INTO pos_close_lines VALUES (item.drink_menu_id, item.produto_id, nome, qty, price, item.for_cast);
    subtotal := subtotal + price * qty;
    IF p_agent IS NOT NULL AND item.for_cast AND item.produto_id IS NULL AND price > 2000 AND pct > 0 THEN
      commission := commission + (round(2000 * pct / 100) * qty);
    END IF;
  END LOOP;

  IF subtotal <= 0 THEN
    RAISE EXCEPTION 'order is empty';
  END IF;

  IF p_payment IN ('card', 'credit') THEN
    fee := round(subtotal * 0.0378);
  END IF;

  INSERT INTO public.pos_vendas (
    bar_id, data, subtotal, desconto_total, total, metodo_pagamento, tipo, criado_por, comissao_valor, drink_back_agent_id
  ) VALUES (
    p_bar, night, subtotal, 0, subtotal, COALESCE(p_payment, 'cash'), 'balcao', actor, commission, p_agent
  ) RETURNING id INTO venda;

  FOR item IN SELECT * FROM pos_close_lines
  LOOP
    INSERT INTO public.pos_vendas_itens (
      pos_venda_id, drink_menu_id, produto_id, nome, qtd, preco_unitario, preco_lista, tipo_preco, desconto_valor
    ) VALUES (
      venda, item.drink_menu_id, item.produto_id, item.nome, item.qtd, item.unit_price, item.unit_price, 'regular', 0
    ) RETURNING id INTO item_id;

    IF item.drink_menu_id IS NOT NULL THEN
      FOR part IN
        SELECT rl.produto_id, rl.volume_ml, rl.quantity
        FROM public.pos_recipe_lines rl
        JOIN public.pos_recipes r ON r.id = rl.recipe_id
        WHERE r.drink_menu_id = item.drink_menu_id AND r.bar_id = p_bar
      LOOP
        IF part.volume_ml IS NOT NULL AND part.volume_ml > 0 THEN
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
            left_ml := left_ml - take;
          END LOOP;
          IF left_ml > 0 THEN
            RAISE EXCEPTION 'insufficient bottle volume';
          END IF;
        ELSIF part.quantity IS NOT NULL AND part.quantity > 0 THEN
          INSERT INTO public.estoque_movimentos (produto_id, bar_id, tipo, qtd, criado_por, obs)
          VALUES (part.produto_id, p_bar, 'saida', part.quantity * item.qtd, actor, 'pos_venda ' || venda::text);
        END IF;
      END LOOP;
    ELSIF item.produto_id IS NOT NULL THEN
      INSERT INTO public.estoque_movimentos (produto_id, bar_id, tipo, qtd, criado_por, obs)
      VALUES (item.produto_id, p_bar, 'saida', item.qtd, actor, 'pos_venda ' || venda::text);
    END IF;
  END LOOP;

  INSERT INTO public.caixa_movimentos (bar_id, tipo, valor, descricao, referencia_id, referencia_tipo, data)
  VALUES (p_bar, 'entrada', subtotal, 'POS ' || p_payment, venda, 'pos_venda', now());

  IF fee > 0 THEN
    INSERT INTO public.caixa_movimentos (bar_id, tipo, valor, descricao, referencia_id, referencia_tipo, data)
    VALUES (p_bar, 'saida', fee, 'Taxa cartão (3.78%)', venda, 'taxa_cartao', now());
  END IF;

  UPDATE public.pos_tickets SET status = 'closed' WHERE id = p_ticket;
  UPDATE public.pos_idempotency SET venda_id = venda WHERE bar_id = p_bar AND key = p_key;

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

CREATE OR REPLACE FUNCTION public.pos_void_sale(
  p_venda uuid,
  p_kind text,
  p_amount integer,
  p_reason text,
  p_approver uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  sale public.pos_vendas;
  value integer;
  event_id uuid;
  move record;
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
  value := CASE WHEN p_kind = 'partial_refund' THEN p_amount ELSE sale.total::integer END;
  IF value IS NULL OR value <= 0 OR value > (sale.total::integer - COALESCE(sale.refunded, 0)) THEN
    RAISE EXCEPTION 'refund exceeds sale';
  END IF;
  INSERT INTO public.pos_sale_events (venda_id, bar_id, kind, amount, reason, employee_id, approver_id)
  VALUES (sale.id, sale.bar_id, p_kind, value, p_reason, actor, p_approver)
  RETURNING id INTO event_id;
  INSERT INTO public.caixa_movimentos (bar_id, tipo, valor, descricao, referencia_id, referencia_tipo, data)
  VALUES (sale.bar_id, 'saida', value, 'POS ' || p_kind, sale.id, 'pos_void', now());
  UPDATE public.pos_vendas
    SET refunded = COALESCE(refunded, 0) + value,
        void_status = CASE WHEN p_kind = 'partial_refund' THEN 'partial_refund' ELSE 'void' END
    WHERE id = sale.id;
  IF p_kind = 'void' THEN
    FOR move IN
      SELECT * FROM public.pos_bottle_moves WHERE sale_id = sale.id AND kind = 'consume'
    LOOP
      UPDATE public.pos_bottles
        SET volume_atual = volume_atual + move.volume_ml,
            status = 'opened'
        WHERE id = move.bottle_id;
      INSERT INTO public.pos_bottle_moves (
        bottle_id, bar_id, produto_id, kind, volume_ml, sale_id, employee_id, reason
      ) VALUES (
        move.bottle_id, move.bar_id, move.produto_id, 'refund', move.volume_ml, sale.id, actor, p_reason
      );
    END LOOP;
  END IF;
  RETURN event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_void_sale(uuid, text, integer, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_void_sale(uuid, text, integer, text, uuid) TO authenticated;

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
      'bar_id', b.bar_id,
      'status', b.status,
      'volume_original', b.volume_original,
      'volume_atual', b.volume_atual,
      'opened_at', b.opened_at,
      'opened_by', b.opened_by,
      'custo', b.custo,
      'consumed', b.volume_original - b.volume_atual
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
