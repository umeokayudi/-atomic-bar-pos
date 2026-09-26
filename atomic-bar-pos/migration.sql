-- ============================================
-- ATOMIC BAR POS — SQL MIGRATION
-- Rodar no Supabase SQL Editor do projeto:
-- ojirgkqtqvugqktyuhem
-- ============================================

-- 1. Cast members
CREATE TABLE IF NOT EXISTS cast_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id UUID NOT NULL REFERENCES bars(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'hostess',    -- hostess | barman | staff
  contrato TEXT NOT NULL DEFAULT 'inhouse', -- inhouse | freelancer
  turno TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Cast commission log
CREATE TABLE IF NOT EXISTS cast_comissoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cast_id UUID NOT NULL REFERENCES cast_members(id) ON DELETE CASCADE,
  venda_id UUID NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
  valor NUMERIC(10,2) NOT NULL,
  data TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Add cast_id and comissao_total to vendas (if not present)
ALTER TABLE vendas
  ADD COLUMN IF NOT EXISTS mesa TEXT,
  ADD COLUMN IF NOT EXISTS cast_id UUID REFERENCES cast_members(id),
  ADD COLUMN IF NOT EXISTS comissao_total NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'confirmada';

-- 4. Add referencia_tipo to caixa_movimentos (if not present)
ALTER TABLE caixa_movimentos
  ADD COLUMN IF NOT EXISTS referencia_tipo TEXT,
  ADD COLUMN IF NOT EXISTS referencia_id UUID;

-- 5. Add estoque_minimo and estoque_maximo to produtos (if not present)
ALTER TABLE produtos
  ADD COLUMN IF NOT EXISTS estoque_minimo INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS estoque_maximo INTEGER DEFAULT 50;

-- 6–7. Stock check, one-transaction sale, and cast rows limited to the signed-in bar.
-- Same script as sql/pos_sale_security.sql, inlined so the SQL editor can run this file alone.

-- Repair for databases that already ran the open cast policies and deduct_stock.
-- Run in the Supabase SQL editor of the drinks project.
-- Does not touch pos_vendas, faturas, wages, or rent.

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
        AND (p.role = 'admin' OR p.bar_id = target_bar)
    );
$$;

REVOKE ALL ON FUNCTION public.user_can_access_bar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_access_bar(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.deduct_stock(uuid, integer);

CREATE OR REPLACE FUNCTION public.deduct_stock(
  p_produto_id uuid,
  p_qty integer,
  p_bar_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'qty must be positive';
  END IF;
  IF NOT public.user_can_access_bar(p_bar_id) THEN
    RAISE EXCEPTION 'bar not allowed';
  END IF;

  UPDATE public.produtos
  SET estoque_atual = COALESCE(estoque_atual, 0) - p_qty
  WHERE id = p_produto_id
    AND bar_id = p_bar_id
    AND COALESCE(estoque_atual, 0) >= p_qty;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'insufficient stock or product not in this bar';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.deduct_stock(uuid, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deduct_stock(uuid, integer, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_order(
  p_bar_id uuid,
  p_mesa text,
  p_payment text,
  p_cast_id uuid,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  item jsonb;
  produto_id uuid;
  qty integer;
  price numeric;
  line_commission numeric;
  cast_tipo text;
  subtotal numeric := 0;
  surcharge numeric := 0;
  processor_fee numeric := 0;
  grand_total numeric := 0;
  total_commission numeric := 0;
  bar_revenue numeric := 0;
  venda_id uuid;
  payment text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT public.user_can_access_bar(p_bar_id) THEN
    RAISE EXCEPTION 'bar not allowed';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'order is empty';
  END IF;

  payment := CASE WHEN p_payment = 'cartao' THEN 'cartao' ELSE 'dinheiro' END;

  IF p_cast_id IS NOT NULL THEN
    SELECT c.tipo INTO cast_tipo
    FROM public.cast_members c
    WHERE c.id = p_cast_id
      AND c.bar_id = p_bar_id
      AND c.ativo IS TRUE;
    IF cast_tipo IS NULL THEN
      RAISE EXCEPTION 'cast not in this bar';
    END IF;
  END IF;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    produto_id := (item->>'produto_id')::uuid;
    qty := (item->>'qty')::integer;
    IF produto_id IS NULL OR qty IS NULL OR qty <= 0 THEN
      RAISE EXCEPTION 'invalid item';
    END IF;

    SELECT p.preco_venda INTO price
    FROM public.produtos p
    WHERE p.id = produto_id
      AND p.bar_id = p_bar_id
    FOR UPDATE;

    IF price IS NULL THEN
      RAISE EXCEPTION 'product not in this bar';
    END IF;
    IF COALESCE((SELECT estoque_atual FROM public.produtos WHERE id = produto_id AND bar_id = p_bar_id), 0) < qty THEN
      RAISE EXCEPTION 'insufficient stock';
    END IF;

    line_commission := 0;
    IF cast_tipo = 'freelancer' THEN
      line_commission := round(price * 0.5 * qty);
    ELSIF cast_tipo IS NOT NULL AND price > 2000 THEN
      line_commission := round(price * 0.3 * qty);
    END IF;

    subtotal := subtotal + (price * qty);
    total_commission := total_commission + line_commission;
  END LOOP;

  IF payment = 'cartao' THEN
    surcharge := round(subtotal * 0.25);
    processor_fee := round(subtotal * 0.0378);
  END IF;
  grand_total := subtotal + surcharge;
  bar_revenue := grand_total - processor_fee;

  INSERT INTO public.vendas (
    bar_id, data_venda, total, forma_pagamento, mesa, cast_id, comissao_total, status
  ) VALUES (
    p_bar_id, now(), grand_total, payment, COALESCE(NULLIF(btrim(p_mesa), ''), 'Mesa 1'),
    p_cast_id, total_commission, 'confirmada'
  )
  RETURNING id INTO venda_id;

  FOR item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    produto_id := (item->>'produto_id')::uuid;
    qty := (item->>'qty')::integer;
    SELECT p.preco_venda INTO price
    FROM public.produtos p
    WHERE p.id = produto_id AND p.bar_id = p_bar_id;

    line_commission := 0;
    IF cast_tipo = 'freelancer' THEN
      line_commission := round(price * 0.5 * qty);
    ELSIF cast_tipo IS NOT NULL AND price > 2000 THEN
      line_commission := round(price * 0.3 * qty);
    END IF;

    INSERT INTO public.vendas_itens (
      venda_id, produto_id, quantidade, preco_unitario, subtotal, comissao
    ) VALUES (
      venda_id, produto_id, qty, price, price * qty, line_commission
    );

    UPDATE public.produtos
    SET estoque_atual = estoque_atual - qty
    WHERE id = produto_id
      AND bar_id = p_bar_id
      AND COALESCE(estoque_atual, 0) >= qty;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'insufficient stock';
    END IF;
  END LOOP;

  INSERT INTO public.caixa_movimentos (
    bar_id, tipo, valor, descricao, referencia_id, referencia_tipo, data
  ) VALUES (
    p_bar_id, 'entrada', bar_revenue,
    'Venda ' || COALESCE(p_mesa, '') || ' - ' || payment,
    venda_id, 'venda', now()
  );

  IF processor_fee > 0 THEN
    INSERT INTO public.caixa_movimentos (
      bar_id, tipo, valor, descricao, referencia_id, referencia_tipo, data
    ) VALUES (
      p_bar_id, 'saida', processor_fee,
      'Taxa cartão (3.78%) - ' || COALESCE(p_mesa, ''),
      venda_id, 'taxa_cartao', now()
    );
  END IF;

  IF total_commission > 0 AND p_cast_id IS NOT NULL THEN
    INSERT INTO public.caixa_movimentos (
      bar_id, tipo, valor, descricao, referencia_id, referencia_tipo, data
    ) VALUES (
      p_bar_id, 'saida', total_commission,
      'Comissão cast - ' || COALESCE(p_mesa, ''),
      venda_id, 'comissao', now()
    );
    INSERT INTO public.cast_comissoes (cast_id, venda_id, valor, data)
    VALUES (p_cast_id, venda_id, total_commission, now());
  END IF;

  RETURN jsonb_build_object(
    'venda_id', venda_id,
    'total', grand_total,
    'commission', total_commission
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_order(uuid, text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_order(uuid, text, text, uuid, jsonb) TO authenticated;

ALTER TABLE public.cast_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cast_comissoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cast_members_bar_access" ON public.cast_members;
CREATE POLICY "cast_members_bar_access" ON public.cast_members
  FOR ALL
  TO authenticated
  USING (public.user_can_access_bar(bar_id))
  WITH CHECK (public.user_can_access_bar(bar_id));

DROP POLICY IF EXISTS "cast_comissoes_bar_access" ON public.cast_comissoes;
CREATE POLICY "cast_comissoes_bar_access" ON public.cast_comissoes
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cast_members c
      WHERE c.id = cast_comissoes.cast_id
        AND public.user_can_access_bar(c.bar_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.cast_members c
      WHERE c.id = cast_comissoes.cast_id
        AND public.user_can_access_bar(c.bar_id)
    )
  );
