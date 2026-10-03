-- Operations that sit on the tables the existing SQL already writes.
-- pos_close_ticket remains the sale close. These functions fill discount,
-- split payments, stock ledger posts, clock punches, and cash closing.

CREATE OR REPLACE FUNCTION public.pos_apply_discount(p_bar uuid, p_ticket uuid, p_amount integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  role text;
BEGIN
  actor := public.pos_require_bar(p_bar);
  IF COALESCE(p_amount, 0) < 0 THEN
    RAISE EXCEPTION 'discount invalid';
  END IF;
  SELECT p.role INTO role FROM public.perfis p WHERE p.id = actor;
  IF role NOT IN ('admin', 'gerente', 'cliente') AND NOT EXISTS (
    SELECT 1 FROM public.platform_access a
    WHERE a.user_id = actor AND a.scope = 'hq' AND a.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'discount not allowed';
  END IF;
  UPDATE public.pos_tickets
    SET discount_total = p_amount
    WHERE id = p_ticket AND bar_id = p_bar AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ticket not open';
  END IF;
  RETURN p_amount;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_apply_discount(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_apply_discount(uuid, uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.pos_take_payment(
  p_bar uuid,
  p_ticket uuid,
  p_method text,
  p_amount integer,
  p_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  existing uuid;
  rate numeric;
  fee integer := 0;
  payment_id uuid;
BEGIN
  actor := public.pos_require_bar(p_bar);
  IF p_key IS NULL OR btrim(p_key) = '' THEN
    RAISE EXCEPTION 'idempotency key required';
  END IF;
  IF p_method NOT IN ('cash', 'dinheiro', 'card', 'credit') THEN
    RAISE EXCEPTION 'unknown payment method';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'payment invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.pos_tickets t
    WHERE t.id = p_ticket AND t.bar_id = p_bar AND t.status = 'open'
  ) THEN
    RAISE EXCEPTION 'ticket not open';
  END IF;
  SELECT id INTO existing
  FROM public.pos_sale_payments
  WHERE bar_id = p_bar AND idempotency_key = p_key;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;
  IF p_method IN ('card', 'credit') THEN
    SELECT s.card_fee_rate INTO rate FROM public.pos_settings s WHERE s.bar_id = p_bar;
    fee := round(p_amount * COALESCE(rate, 0.0378));
  END IF;
  BEGIN
    INSERT INTO public.pos_sale_payments (bar_id, ticket_id, method, amount, fee, idempotency_key)
    VALUES (p_bar, p_ticket, p_method, p_amount, fee, p_key)
    RETURNING id INTO payment_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO payment_id
    FROM public.pos_sale_payments
    WHERE bar_id = p_bar AND idempotency_key = p_key;
    RETURN payment_id;
  END;
  RETURN payment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_take_payment(uuid, uuid, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_take_payment(uuid, uuid, text, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.stock_on_hand(p_bar uuid, p_product uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN tipo IN ('entrada', 'ajuste', 'devolucao', 'estorno') THEN qtd
      ELSE -qtd
    END
  ), 0)::integer
  FROM public.estoque_movimentos
  WHERE bar_id = p_bar AND produto_id = p_product;
$$;

REVOKE ALL ON FUNCTION public.stock_on_hand(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stock_on_hand(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.stock_post(
  p_bar uuid,
  p_product uuid,
  p_tipo text,
  p_qty integer,
  p_obs text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  policy text;
  on_hand integer;
  move_id uuid;
BEGIN
  actor := public.pos_require_bar(p_bar);
  IF p_tipo NOT IN ('entrada', 'saida', 'ajuste', 'perda', 'transferencia', 'devolucao', 'estorno') THEN
    RAISE EXCEPTION 'unknown stock movement';
  END IF;
  IF COALESCE(p_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'quantity invalid';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_bar::text), hashtext(p_product::text));
  SELECT c.stock_policy INTO policy
  FROM public.bar_catalog c
  WHERE c.bar_id = p_bar AND c.product_id = p_product;
  policy := COALESCE(policy, 'block');
  on_hand := public.stock_on_hand(p_bar, p_product);
  IF p_tipo IN ('saida', 'perda', 'transferencia') AND policy = 'block' AND on_hand < p_qty THEN
    RAISE EXCEPTION 'insufficient stock';
  END IF;
  INSERT INTO public.estoque_movimentos (produto_id, bar_id, tipo, qtd, criado_por, obs)
  VALUES (p_product, p_bar, p_tipo, p_qty, actor, p_obs)
  RETURNING id INTO move_id;
  RETURN move_id;
END;
$$;

REVOKE ALL ON FUNCTION public.stock_post(uuid, uuid, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stock_post(uuid, uuid, text, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.staff_clock(p_bar uuid, p_tipo text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  last_tipo text;
  punch_id uuid;
BEGIN
  actor := public.pos_require_bar(p_bar);
  IF p_tipo NOT IN ('in', 'out', 'break_start', 'break_end') THEN
    RAISE EXCEPTION 'unknown punch';
  END IF;
  SELECT t.tipo INTO last_tipo
  FROM public.time_clock t
  WHERE t.staff_id = actor AND t.bar_id = p_bar
  ORDER BY t.punched_at DESC, t.id DESC
  LIMIT 1
  FOR UPDATE;
  IF p_tipo = 'in' AND last_tipo IN ('in', 'break_start', 'break_end') THEN
    RAISE EXCEPTION 'already clocked in';
  END IF;
  IF p_tipo = 'out' AND last_tipo IS DISTINCT FROM 'in' AND last_tipo IS DISTINCT FROM 'break_end' THEN
    RAISE EXCEPTION 'not clocked in';
  END IF;
  IF p_tipo = 'break_start' AND last_tipo IS DISTINCT FROM 'in' AND last_tipo IS DISTINCT FROM 'break_end' THEN
    RAISE EXCEPTION 'not clocked in';
  END IF;
  IF p_tipo = 'break_end' AND last_tipo IS DISTINCT FROM 'break_start' THEN
    RAISE EXCEPTION 'break not open';
  END IF;
  INSERT INTO public.time_clock (bar_id, staff_id, tipo)
  VALUES (p_bar, actor, p_tipo)
  RETURNING id INTO punch_id;
  RETURN punch_id;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_clock(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_clock(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cash_drawer_expected(p_bar uuid, p_day date)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END
  ), 0)::integer
  FROM public.caixa_movimentos
  WHERE bar_id = p_bar
    AND operational_day = p_day
    AND COALESCE(referencia_tipo, '') <> 'taxa_cartao';
$$;

REVOKE ALL ON FUNCTION public.cash_drawer_expected(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cash_drawer_expected(uuid, date) TO authenticated;

ALTER TABLE public.caixa_movimentos ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS caixa_movimentos_drawer_key
  ON public.caixa_movimentos (bar_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Sangria leaves the drawer. Suprimento enters it. Neither touches sales or stock.
CREATE OR REPLACE FUNCTION public.cash_drawer_move(
  p_bar uuid,
  p_day date,
  p_kind text,
  p_amount integer,
  p_note text,
  p_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  role text;
  existing uuid;
  expected integer;
  move_id uuid;
  tipo text;
BEGIN
  actor := public.pos_require_bar(p_bar);
  SELECT p.role INTO role FROM public.perfis p WHERE p.id = actor;
  IF role IS NULL OR role NOT IN ('caixa', 'gerente', 'cliente', 'admin', 'jbm') THEN
    RAISE EXCEPTION 'drawer move not allowed';
  END IF;
  IF p_key IS NULL OR btrim(p_key) = '' THEN
    RAISE EXCEPTION 'idempotency key required';
  END IF;
  IF p_kind = 'sangria' THEN
    tipo := 'saida';
  ELSIF p_kind = 'suprimento' THEN
    tipo := 'entrada';
  ELSE
    RAISE EXCEPTION 'unknown drawer move';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'amount invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cash_closings c
    WHERE c.bar_id = p_bar AND c.operational_day = p_day
  ) THEN
    RAISE EXCEPTION 'already closed';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('cash-drawer'), hashtext(p_bar::text || COALESCE(p_day::text, '')));
  SELECT m.id INTO existing
  FROM public.caixa_movimentos m
  WHERE m.bar_id = p_bar AND m.idempotency_key = p_key;
  IF existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', existing,
      'duplicate', true,
      'expected', public.cash_drawer_expected(p_bar, p_day)
    );
  END IF;
  expected := public.cash_drawer_expected(p_bar, p_day);
  IF p_kind = 'sangria' AND p_amount > expected THEN
    RAISE EXCEPTION 'drawer short';
  END IF;
  BEGIN
    INSERT INTO public.caixa_movimentos (
      bar_id, tipo, valor, descricao, referencia_tipo, operational_day, criado_por, idempotency_key
    )
    VALUES (
      p_bar, tipo, p_amount, left(btrim(COALESCE(p_note, '')), 500), p_kind, p_day, actor, p_key
    )
    RETURNING id INTO move_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT m.id INTO move_id
    FROM public.caixa_movimentos m
    WHERE m.bar_id = p_bar AND m.idempotency_key = p_key;
    RETURN jsonb_build_object(
      'id', move_id,
      'duplicate', true,
      'expected', public.cash_drawer_expected(p_bar, p_day)
    );
  END;
  RETURN jsonb_build_object(
    'id', move_id,
    'duplicate', false,
    'expected', public.cash_drawer_expected(p_bar, p_day)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cash_drawer_move(uuid, date, text, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cash_drawer_move(uuid, date, text, integer, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cash_close_night(p_bar uuid, p_day date, p_counted integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  expected integer;
  closing_id uuid;
BEGIN
  actor := public.pos_require_bar(p_bar);
  IF EXISTS (
    SELECT 1 FROM public.perfis p
    WHERE p.id = actor AND p.role IN ('caixa', 'bar_staff', 'funcionario', 'fornecedor')
      AND NOT EXISTS (
        SELECT 1 FROM public.platform_access a
        WHERE a.user_id = actor AND a.scope = 'hq' AND a.revoked_at IS NULL
      )
  ) AND NOT EXISTS (
    SELECT 1 FROM public.perfis p
    WHERE p.id = actor AND p.role IN ('admin', 'gerente', 'cliente', 'jbm')
  ) THEN
    RAISE EXCEPTION 'close not allowed';
  END IF;
  expected := public.cash_drawer_expected(p_bar, p_day);
  INSERT INTO public.cash_closings (bar_id, operational_day, expected_cash, counted_cash, closed_by)
  VALUES (p_bar, p_day, expected, p_counted, actor)
  RETURNING id INTO closing_id;
  RETURN closing_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'already closed';
END;
$$;

REVOKE ALL ON FUNCTION public.cash_close_night(uuid, date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cash_close_night(uuid, date, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.tax_on(p_bar uuid, p_amount integer)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN s.bar_id IS NULL OR s.tax_rate = 0 THEN 0
    WHEN s.tax_included THEN round(p_amount - (p_amount / (1 + s.tax_rate)))::integer
    ELSE round(p_amount * s.tax_rate)::integer
  END
  FROM (SELECT 1) dummy
  LEFT JOIN public.pos_settings s ON s.bar_id = p_bar;
$$;

REVOKE ALL ON FUNCTION public.tax_on(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tax_on(uuid, integer) TO authenticated;
