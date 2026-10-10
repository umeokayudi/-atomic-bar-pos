-- JBMTech: floor layout (tables and sectors), server-side tabs ("comandas") and the atomic till sale.
-- Project ojirgkqtqvugqktyuhem. NOT applied by the app or by CI: run it in staging first, then production.
--
-- Order:   sql/pos_start.sql  →  sql/floor_comandas.sql
-- Nature:  additive. CREATE ... IF NOT EXISTS, CREATE OR REPLACE FUNCTION, ADD COLUMN IF NOT EXISTS.
--          No table is dropped, no existing row is changed. The 7 legacy `mesas` are COPIED into
--          floor_tables (legacy_mesa_id keeps the link); `mesas` and the 22 closed `tabs` stay untouched.
-- Access:  every new table is scoped per bar with jbm_can_access_bar() (admin/jbm see all bars,
--          bar roles only their own bar). Layout writes need a manager (cliente/gerente) or admin.
--          Functions are SECURITY INVOKER: they run with the caller's rights, so RLS still applies.
-- Rollback: see the end of this file.

-- ─── helpers ──────────────────────────────────────────────────────────────────────────────

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

-- Tokyo "night" (before 06:00 counts as the previous day), same rule as src/lib/tokyo.js tokyoNightKey.
CREATE OR REPLACE FUNCTION public.jbm_tokyo_night(p_at timestamptz DEFAULT now())
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

-- ─── floor layout (space only: never touches money) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.floor_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  nome text NOT NULL DEFAULT 'Salão',
  ativo boolean NOT NULL DEFAULT false,
  largura integer NOT NULL DEFAULT 1200 CHECK (largura BETWEEN 200 AND 10000),
  altura integer NOT NULL DEFAULT 800 CHECK (altura BETWEEN 200 AND 10000),
  versao integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS floor_layouts_one_active ON public.floor_layouts (bar_id) WHERE ativo;

CREATE TABLE IF NOT EXISTS public.floor_sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  layout_id uuid NOT NULL REFERENCES public.floor_layouts(id) ON DELETE CASCADE,
  nome text NOT NULL,
  cor text,
  ordem integer NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.floor_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  layout_id uuid NOT NULL REFERENCES public.floor_layouts(id) ON DELETE CASCADE,
  sector_id uuid REFERENCES public.floor_sectors(id) ON DELETE SET NULL,
  nome text NOT NULL,
  forma text NOT NULL DEFAULT 'square' CHECK (forma IN ('round', 'square', 'rect', 'bar', 'sofa', 'wall', 'door', 'stage', 'plant')),
  x numeric NOT NULL DEFAULT 40,
  y numeric NOT NULL DEFAULT 40,
  largura numeric NOT NULL DEFAULT 90 CHECK (largura > 0),
  altura numeric NOT NULL DEFAULT 90 CHECK (altura > 0),
  rotacao numeric NOT NULL DEFAULT 0,
  capacidade integer NOT NULL DEFAULT 2 CHECK (capacidade BETWEEN 0 AND 500),
  cor text,
  estado_manual text CHECK (estado_manual IN ('reserved', 'cleaning')),
  nota text,
  ativo boolean NOT NULL DEFAULT true,
  legacy_mesa_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS floor_tables_layout_idx ON public.floor_tables (layout_id);
CREATE UNIQUE INDEX IF NOT EXISTS floor_tables_legacy_uq ON public.floor_tables (layout_id, legacy_mesa_id) WHERE legacy_mesa_id IS NOT NULL;

-- ─── tabs (comandas) ──────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pos_comandas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  table_id uuid REFERENCES public.floor_tables(id) ON DELETE SET NULL,
  mesa_nome text,
  nome text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'awaiting_payment', 'closed', 'merged', 'cancelled')),
  pessoas integer NOT NULL DEFAULT 1 CHECK (pessoas BETWEEN 1 AND 500),
  responsavel_id uuid,
  responsavel_nome text,
  service_pct numeric NOT NULL DEFAULT 0 CHECK (service_pct BETWEEN 0 AND 100),
  obs text,
  open_key text,
  venda_id uuid,
  merged_into uuid REFERENCES public.pos_comandas(id),
  aberta_em timestamptz NOT NULL DEFAULT now(),
  fechada_em timestamptz,
  criado_por uuid DEFAULT auth.uid(),
  versao integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS pos_comandas_open_key ON public.pos_comandas (bar_id, open_key) WHERE open_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS pos_comandas_bar_open ON public.pos_comandas (bar_id) WHERE status IN ('open', 'awaiting_payment');

CREATE TABLE IF NOT EXISTS public.pos_comanda_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comanda_id uuid NOT NULL REFERENCES public.pos_comandas(id),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  drink_menu_id uuid,
  produto_id uuid,
  nome text NOT NULL,
  categoria text,
  qtd numeric NOT NULL CHECK (qtd > 0),
  preco_unitario numeric NOT NULL CHECK (preco_unitario >= 0),
  preco_lista numeric,
  tipo_preco text NOT NULL DEFAULT 'regular',
  desconto_valor numeric NOT NULL DEFAULT 0 CHECK (desconto_valor >= 0),
  obs text,
  origem_item_id uuid,
  criado_por uuid DEFAULT auth.uid(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  removido_em timestamptz,
  removido_por uuid
);
CREATE INDEX IF NOT EXISTS pos_comanda_itens_comanda ON public.pos_comanda_itens (comanda_id) WHERE removido_em IS NULL;

CREATE TABLE IF NOT EXISTS public.pos_comanda_pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comanda_id uuid NOT NULL REFERENCES public.pos_comandas(id),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  valor numeric NOT NULL CHECK (valor > 0),
  metodo text NOT NULL,
  pagador text,
  idem_key text NOT NULL,
  criado_por uuid DEFAULT auth.uid(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  estornado_em timestamptz,
  estornado_por uuid,
  UNIQUE (bar_id, idem_key)
);

CREATE TABLE IF NOT EXISTS public.pos_comanda_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comanda_id uuid NOT NULL REFERENCES public.pos_comandas(id),
  bar_id uuid NOT NULL,
  tipo text NOT NULL,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  ator uuid DEFAULT auth.uid(),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pos_comanda_eventos_comanda ON public.pos_comanda_eventos (comanda_id, criado_em);

-- Same shape as pos_floor.sql's table, so both files can coexist.
CREATE TABLE IF NOT EXISTS public.pos_idempotency (
  bar_id uuid NOT NULL,
  key text NOT NULL,
  venda_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bar_id, key)
);

ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS comanda_id uuid;
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS comissao_valor numeric DEFAULT 0;
-- Till search by short code (e.g. "12" or "HB1"). Optional; empty keeps search by name/category.
ALTER TABLE public.drink_menu ADD COLUMN IF NOT EXISTS codigo text;

-- ─── RLS ──────────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.floor_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floor_sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floor_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_comandas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_comanda_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_comanda_pagamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_comanda_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_idempotency ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['floor_layouts', 'floor_sectors', 'floor_tables'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.jbm_can_access_bar(bar_id))', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.jbm_can_manage_bar(bar_id)) WITH CHECK (public.jbm_can_manage_bar(bar_id))', t || '_write', t);
  END LOOP;
  -- Tabs: anyone working at the bar reads and writes through the functions below.
  FOREACH t IN ARRAY ARRAY['pos_comandas', 'pos_comanda_itens', 'pos_comanda_pagamentos', 'pos_comanda_eventos', 'pos_idempotency'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_bar', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.jbm_can_access_bar(bar_id)) WITH CHECK (public.jbm_can_access_bar(bar_id))', t || '_bar', t);
  END LOOP;
END $$;

-- Floor staff may mark a table reserved / cleaning without layout rights.
CREATE OR REPLACE FUNCTION public.floor_set_table_state(p_table uuid, p_state text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_bar uuid;
BEGIN
  SELECT bar_id INTO v_bar FROM floor_tables WHERE id = p_table;
  IF v_bar IS NULL OR NOT jbm_can_access_bar(v_bar) THEN RAISE EXCEPTION 'table not allowed'; END IF;
  IF p_state IS NOT NULL AND p_state NOT IN ('reserved', 'cleaning') THEN RAISE EXCEPTION 'bad state'; END IF;
  UPDATE floor_tables SET estado_manual = p_state, nota = COALESCE(p_note, nota), atualizado_em = now() WHERE id = p_table;
END $$;
REVOKE ALL ON FUNCTION public.floor_set_table_state(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.floor_set_table_state(uuid, text, text) TO authenticated;

-- A table with an open tab cannot be removed or switched off; a move/resize is always fine.
CREATE OR REPLACE FUNCTION public.floor_tables_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.ativo AND NOT NEW.ativo))
     AND EXISTS (SELECT 1 FROM pos_comandas c WHERE c.table_id = OLD.id AND c.status IN ('open', 'awaiting_payment')) THEN
    RAISE EXCEPTION 'table % has an open tab', OLD.nome USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS floor_tables_guard ON public.floor_tables;
CREATE TRIGGER floor_tables_guard BEFORE UPDATE OR DELETE ON public.floor_tables
  FOR EACH ROW EXECUTE FUNCTION public.floor_tables_guard();

-- Deleting a whole layout would cascade its tables: same guard.
CREATE OR REPLACE FUNCTION public.floor_layouts_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pos_comandas c JOIN floor_tables ft ON ft.id = c.table_id
    WHERE ft.layout_id = OLD.id AND c.status IN ('open', 'awaiting_payment')
  ) THEN
    RAISE EXCEPTION 'layout % has tables with open tabs', OLD.nome USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS floor_layouts_guard ON public.floor_layouts;
CREATE TRIGGER floor_layouts_guard BEFORE DELETE ON public.floor_layouts
  FOR EACH ROW EXECUTE FUNCTION public.floor_layouts_guard();

-- Save a whole layout in one transaction (the editor's "Save"). Optimistic lock on versao.
-- p_tables: [{id?, nome, forma, x, y, largura, altura, rotacao, capacidade, cor, sector_id?, sector_key?, ativo}]
-- p_sectors: [{id?, key, nome, cor, ordem}]   (key lets new tables point at new sectors)
CREATE OR REPLACE FUNCTION public.floor_save_layout(
  p_layout uuid, p_versao integer, p_nome text, p_largura integer, p_altura integer,
  p_sectors jsonb, p_tables jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_bar uuid; v_cur integer; s jsonb; t jsonb; v_id uuid; v_keymap jsonb := '{}'::jsonb;
  v_keep_sectors uuid[] := '{}'; v_keep_tables uuid[] := '{}';
BEGIN
  SELECT bar_id, versao INTO v_bar, v_cur FROM floor_layouts WHERE id = p_layout FOR UPDATE;
  IF v_bar IS NULL THEN RAISE EXCEPTION 'layout not found'; END IF;
  IF NOT jbm_can_manage_bar(v_bar) THEN RAISE EXCEPTION 'layout not allowed'; END IF;
  IF p_versao IS DISTINCT FROM v_cur THEN
    RAISE EXCEPTION 'layout changed on another device (version % vs %)', p_versao, v_cur USING ERRCODE = '40001';
  END IF;

  UPDATE floor_layouts SET nome = COALESCE(NULLIF(trim(p_nome), ''), nome),
    largura = COALESCE(p_largura, largura), altura = COALESCE(p_altura, altura),
    versao = versao + 1, atualizado_em = now()
  WHERE id = p_layout;

  FOR s IN SELECT * FROM jsonb_array_elements(COALESCE(p_sectors, '[]'::jsonb)) LOOP
    IF (s->>'id') IS NOT NULL AND EXISTS (SELECT 1 FROM floor_sectors WHERE id = (s->>'id')::uuid AND layout_id = p_layout) THEN
      v_id := (s->>'id')::uuid;
      UPDATE floor_sectors SET nome = s->>'nome', cor = s->>'cor', ordem = COALESCE((s->>'ordem')::int, 0) WHERE id = v_id;
    ELSE
      INSERT INTO floor_sectors (bar_id, layout_id, nome, cor, ordem)
      VALUES (v_bar, p_layout, s->>'nome', s->>'cor', COALESCE((s->>'ordem')::int, 0)) RETURNING id INTO v_id;
    END IF;
    v_keep_sectors := v_keep_sectors || v_id;
    IF (s->>'key') IS NOT NULL THEN v_keymap := v_keymap || jsonb_build_object(s->>'key', v_id); END IF;
  END LOOP;

  FOR t IN SELECT * FROM jsonb_array_elements(COALESCE(p_tables, '[]'::jsonb)) LOOP
    IF (t->>'id') IS NOT NULL AND EXISTS (SELECT 1 FROM floor_tables WHERE id = (t->>'id')::uuid AND layout_id = p_layout) THEN
      v_id := (t->>'id')::uuid;
      UPDATE floor_tables SET
        nome = t->>'nome', forma = COALESCE(t->>'forma', 'square'),
        x = (t->>'x')::numeric, y = (t->>'y')::numeric,
        largura = (t->>'largura')::numeric, altura = (t->>'altura')::numeric,
        rotacao = COALESCE((t->>'rotacao')::numeric, 0), capacidade = COALESCE((t->>'capacidade')::int, 2),
        cor = t->>'cor', ativo = COALESCE((t->>'ativo')::boolean, true),
        sector_id = COALESCE((v_keymap->>(t->>'sector_key'))::uuid, (t->>'sector_id')::uuid)
      WHERE id = v_id;
    ELSE
      INSERT INTO floor_tables (bar_id, layout_id, nome, forma, x, y, largura, altura, rotacao, capacidade, cor, ativo, sector_id)
      VALUES (v_bar, p_layout, t->>'nome', COALESCE(t->>'forma', 'square'), (t->>'x')::numeric, (t->>'y')::numeric,
        (t->>'largura')::numeric, (t->>'altura')::numeric, COALESCE((t->>'rotacao')::numeric, 0),
        COALESCE((t->>'capacidade')::int, 2), t->>'cor', COALESCE((t->>'ativo')::boolean, true),
        COALESCE((v_keymap->>(t->>'sector_key'))::uuid, (t->>'sector_id')::uuid))
      RETURNING id INTO v_id;
    END IF;
    v_keep_tables := v_keep_tables || v_id;
  END LOOP;

  -- Tables missing from the payload are removed (the guard trigger blocks it if a tab is open there).
  DELETE FROM floor_tables WHERE layout_id = p_layout AND NOT (id = ANY (v_keep_tables));
  DELETE FROM floor_sectors WHERE layout_id = p_layout AND NOT (id = ANY (v_keep_sectors));

  RETURN jsonb_build_object('versao', v_cur + 1);
END $$;

-- Duplicate a layout (tables and sectors). The copy starts inactive.
CREATE OR REPLACE FUNCTION public.floor_duplicate_layout(p_layout uuid, p_nome text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_bar uuid; v_new uuid; r record; v_sec uuid; v_map jsonb := '{}'::jsonb;
BEGIN
  SELECT bar_id INTO v_bar FROM floor_layouts WHERE id = p_layout;
  IF v_bar IS NULL OR NOT jbm_can_manage_bar(v_bar) THEN RAISE EXCEPTION 'layout not allowed'; END IF;
  INSERT INTO floor_layouts (bar_id, nome, ativo, largura, altura)
    SELECT bar_id, COALESCE(NULLIF(trim(p_nome), ''), nome || ' (copy)'), false, largura, altura FROM floor_layouts WHERE id = p_layout
    RETURNING id INTO v_new;
  FOR r IN SELECT * FROM floor_sectors WHERE layout_id = p_layout LOOP
    INSERT INTO floor_sectors (bar_id, layout_id, nome, cor, ordem) VALUES (v_bar, v_new, r.nome, r.cor, r.ordem) RETURNING id INTO v_sec;
    v_map := v_map || jsonb_build_object(r.id::text, v_sec);
  END LOOP;
  INSERT INTO floor_tables (bar_id, layout_id, sector_id, nome, forma, x, y, largura, altura, rotacao, capacidade, cor, ativo)
    SELECT v_bar, v_new, (v_map->>(sector_id::text))::uuid, nome, forma, x, y, largura, altura, rotacao, capacidade, cor, ativo
    FROM floor_tables WHERE layout_id = p_layout;
  RETURN v_new;
END $$;

CREATE OR REPLACE FUNCTION public.floor_activate_layout(p_layout uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_bar uuid;
BEGIN
  SELECT bar_id INTO v_bar FROM floor_layouts WHERE id = p_layout;
  IF v_bar IS NULL OR NOT jbm_can_manage_bar(v_bar) THEN RAISE EXCEPTION 'layout not allowed'; END IF;
  UPDATE floor_layouts SET ativo = false WHERE bar_id = v_bar AND ativo AND id <> p_layout;
  UPDATE floor_layouts SET ativo = true, atualizado_em = now() WHERE id = p_layout;
END $$;

-- ─── tab operations (each is one transaction) ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._comanda_lock(p_comanda uuid, p_states text[] DEFAULT ARRAY['open', 'awaiting_payment'])
RETURNS public.pos_comandas
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE c pos_comandas;
BEGIN
  SELECT * INTO c FROM pos_comandas WHERE id = p_comanda FOR UPDATE;
  IF c.id IS NULL THEN RAISE EXCEPTION 'tab not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT jbm_can_access_bar(c.bar_id) THEN RAISE EXCEPTION 'tab not allowed'; END IF;
  IF NOT (c.status = ANY (p_states)) THEN
    RAISE EXCEPTION 'tab % is %', c.nome, c.status USING ERRCODE = 'P0001';
  END IF;
  RETURN c;
END $$;

CREATE OR REPLACE FUNCTION public._comanda_log(p_comanda uuid, p_bar uuid, p_tipo text, p_dados jsonb)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO pos_comanda_eventos (comanda_id, bar_id, tipo, dados) VALUES (p_comanda, p_bar, p_tipo, COALESCE(p_dados, '{}'::jsonb));
  UPDATE pos_comandas SET versao = versao + 1 WHERE id = p_comanda;
$$;

-- Line total = qtd × preco_unitario (already net of VIP/code discount; desconto_valor is the per-unit
-- discount kept for reporting). Same as src/lib/atomicPos.js cartTotal.
CREATE OR REPLACE FUNCTION public.comanda_totals(p_comanda uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'itens', COALESCE((SELECT sum(qtd * preco_unitario) FROM pos_comanda_itens WHERE comanda_id = p_comanda AND removido_em IS NULL), 0),
    'qtd', COALESCE((SELECT sum(qtd) FROM pos_comanda_itens WHERE comanda_id = p_comanda AND removido_em IS NULL), 0),
    'pago', COALESCE((SELECT sum(valor) FROM pos_comanda_pagamentos WHERE comanda_id = p_comanda AND estornado_em IS NULL), 0)
  );
$$;

CREATE OR REPLACE FUNCTION public.comanda_open(
  p_bar uuid, p_nome text, p_table uuid DEFAULT NULL, p_pessoas integer DEFAULT 1,
  p_responsavel text DEFAULT NULL, p_service_pct numeric DEFAULT 0, p_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_id uuid; v_mesa text;
BEGIN
  IF NOT jbm_can_access_bar(p_bar) THEN RAISE EXCEPTION 'bar not allowed'; END IF;
  IF p_key IS NOT NULL THEN
    SELECT id INTO v_id FROM pos_comandas WHERE bar_id = p_bar AND open_key = p_key;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;
  IF p_table IS NOT NULL THEN
    SELECT nome INTO v_mesa FROM floor_tables WHERE id = p_table AND bar_id = p_bar AND ativo;
    IF v_mesa IS NULL THEN RAISE EXCEPTION 'table not found'; END IF;
  END IF;
  INSERT INTO pos_comandas (bar_id, table_id, mesa_nome, nome, pessoas, responsavel_id, responsavel_nome, service_pct, open_key)
  VALUES (p_bar, p_table, v_mesa, COALESCE(NULLIF(trim(p_nome), ''), v_mesa, 'Tab'), GREATEST(1, COALESCE(p_pessoas, 1)),
          auth.uid(), p_responsavel, COALESCE(p_service_pct, 0), p_key)
  RETURNING id INTO v_id;
  PERFORM _comanda_log(v_id, p_bar, 'opened', jsonb_build_object('table', p_table, 'mesa', v_mesa, 'pessoas', p_pessoas));
  RETURN v_id;
END $$;

-- Add lines (the till's "Send"). p_lines: [{drink_menu_id?, produto_id?, nome, categoria?, qtd, preco_unitario, preco_lista?, tipo_preco?, desconto_valor?, obs?}]
-- For a regular drink line the price must match the menu: the browser cannot invent a price.
CREATE OR REPLACE FUNCTION public.comanda_add_items(p_comanda uuid, p_lines jsonb, p_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE c pos_comandas; l jsonb; v_menu numeric; n integer := 0;
BEGIN
  c := _comanda_lock(p_comanda, ARRAY['open']);
  IF p_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM pos_comanda_eventos WHERE comanda_id = p_comanda AND tipo = 'items_added' AND dados->>'key' = p_key
  ) THEN
    RETURN comanda_totals(p_comanda);
  END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    IF COALESCE((l->>'qtd')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'quantity must be positive'; END IF;
    IF COALESCE(l->>'tipo_preco', 'regular') = 'regular' AND (l->>'drink_menu_id') IS NOT NULL THEN
      SELECT preco_venda INTO v_menu FROM drink_menu WHERE id = (l->>'drink_menu_id')::uuid AND bar_id = c.bar_id;
      IF v_menu IS NULL THEN RAISE EXCEPTION 'drink not on this bar''s menu'; END IF;
      IF v_menu <> (l->>'preco_unitario')::numeric THEN
        RAISE EXCEPTION 'price changed for % (menu %, sent %)', l->>'nome', v_menu, l->>'preco_unitario' USING ERRCODE = '40001';
      END IF;
    END IF;
    INSERT INTO pos_comanda_itens (comanda_id, bar_id, drink_menu_id, produto_id, nome, categoria, qtd, preco_unitario, preco_lista, tipo_preco, desconto_valor, obs)
    VALUES (p_comanda, c.bar_id, (l->>'drink_menu_id')::uuid, (l->>'produto_id')::uuid, l->>'nome', l->>'categoria',
      (l->>'qtd')::numeric, (l->>'preco_unitario')::numeric, NULLIF(l->>'preco_lista', '')::numeric,
      COALESCE(l->>'tipo_preco', 'regular'), COALESCE((l->>'desconto_valor')::numeric, 0), l->>'obs');
    n := n + 1;
  END LOOP;
  PERFORM _comanda_log(p_comanda, c.bar_id, 'items_added', jsonb_build_object('key', p_key, 'lines', n));
  RETURN comanda_totals(p_comanda);
END $$;

-- Change a line's quantity (0 removes it). Only while the tab is open; the line is soft-deleted for audit.
CREATE OR REPLACE FUNCTION public.comanda_set_qty(p_item uuid, p_qtd numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE i pos_comanda_itens; c pos_comandas;
BEGIN
  SELECT * INTO i FROM pos_comanda_itens WHERE id = p_item AND removido_em IS NULL;
  IF i.id IS NULL THEN RAISE EXCEPTION 'line not found'; END IF;
  c := _comanda_lock(i.comanda_id, ARRAY['open']);
  IF p_qtd IS NULL OR p_qtd < 0 THEN RAISE EXCEPTION 'bad quantity'; END IF;
  IF p_qtd = 0 THEN
    UPDATE pos_comanda_itens SET removido_em = now(), removido_por = auth.uid() WHERE id = p_item;
  ELSE
    UPDATE pos_comanda_itens SET qtd = p_qtd WHERE id = p_item;
  END IF;
  PERFORM _comanda_log(c.id, c.bar_id, CASE WHEN p_qtd = 0 THEN 'item_removed' ELSE 'qty_changed' END,
    jsonb_build_object('item', p_item, 'nome', i.nome, 'from', i.qtd, 'to', p_qtd));
  RETURN comanda_totals(c.id);
END $$;

CREATE OR REPLACE FUNCTION public.comanda_update(p_comanda uuid, p_nome text, p_pessoas integer, p_responsavel text, p_obs text, p_service_pct numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE c pos_comandas;
BEGIN
  c := _comanda_lock(p_comanda);
  UPDATE pos_comandas SET
    nome = COALESCE(NULLIF(trim(p_nome), ''), nome),
    pessoas = COALESCE(p_pessoas, pessoas),
    responsavel_nome = COALESCE(p_responsavel, responsavel_nome),
    obs = COALESCE(p_obs, obs),
    service_pct = COALESCE(p_service_pct, service_pct)
  WHERE id = p_comanda;
  PERFORM _comanda_log(c.id, c.bar_id, 'updated', jsonb_build_object('nome', p_nome, 'pessoas', p_pessoas, 'responsavel', p_responsavel, 'service_pct', p_service_pct));
END $$;

-- Move the whole tab to another table (or to no table).
CREATE OR REPLACE FUNCTION public.comanda_move_table(p_comanda uuid, p_table uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE c pos_comandas; v_mesa text;
BEGIN
  c := _comanda_lock(p_comanda);
  IF p_table IS NOT NULL THEN
    SELECT nome INTO v_mesa FROM floor_tables WHERE id = p_table AND bar_id = c.bar_id AND ativo;
    IF v_mesa IS NULL THEN RAISE EXCEPTION 'table not found'; END IF;
  END IF;
  UPDATE pos_comandas SET table_id = p_table, mesa_nome = v_mesa WHERE id = p_comanda;
  PERFORM _comanda_log(c.id, c.bar_id, 'moved', jsonb_build_object('from', c.table_id, 'to', p_table, 'mesa', v_mesa));
END $$;

-- Move some lines (or part of a line) to another open tab of the same bar.
-- p_moves: [{item, qtd}] — a partial qtd splits the line (unit price and per-unit discount are kept).
CREATE OR REPLACE FUNCTION public.comanda_transfer_items(p_from uuid, p_to uuid, p_moves jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE a pos_comandas; b pos_comandas; m jsonb; i pos_comanda_itens; q numeric;
BEGIN
  IF p_from = p_to THEN RAISE EXCEPTION 'same tab'; END IF;
  -- Lock both rows in a fixed order to avoid deadlocks between two devices.
  IF p_from < p_to THEN a := _comanda_lock(p_from, ARRAY['open']); b := _comanda_lock(p_to, ARRAY['open']);
  ELSE b := _comanda_lock(p_to, ARRAY['open']); a := _comanda_lock(p_from, ARRAY['open']); END IF;
  IF a.bar_id <> b.bar_id THEN RAISE EXCEPTION 'tabs belong to different bars'; END IF;
  FOR m IN SELECT * FROM jsonb_array_elements(COALESCE(p_moves, '[]'::jsonb)) LOOP
    SELECT * INTO i FROM pos_comanda_itens WHERE id = (m->>'item')::uuid AND comanda_id = p_from AND removido_em IS NULL FOR UPDATE;
    IF i.id IS NULL THEN RAISE EXCEPTION 'line not on this tab'; END IF;
    q := COALESCE((m->>'qtd')::numeric, i.qtd);
    IF q <= 0 OR q > i.qtd THEN RAISE EXCEPTION 'bad quantity for %', i.nome; END IF;
    IF q = i.qtd THEN
      UPDATE pos_comanda_itens SET comanda_id = p_to WHERE id = i.id;
    ELSE
      UPDATE pos_comanda_itens SET qtd = i.qtd - q WHERE id = i.id;
      INSERT INTO pos_comanda_itens (comanda_id, bar_id, drink_menu_id, produto_id, nome, categoria, qtd, preco_unitario, preco_lista, tipo_preco, desconto_valor, obs, origem_item_id, criado_por)
      VALUES (p_to, i.bar_id, i.drink_menu_id, i.produto_id, i.nome, i.categoria, q, i.preco_unitario, i.preco_lista, i.tipo_preco, i.desconto_valor, i.obs, i.id, auth.uid());
    END IF;
  END LOOP;
  PERFORM _comanda_log(p_from, a.bar_id, 'items_out', jsonb_build_object('to', p_to, 'moves', p_moves));
  PERFORM _comanda_log(p_to, b.bar_id, 'items_in', jsonb_build_object('from', p_from, 'moves', p_moves));
END $$;

-- Merge tab p_from into p_into: lines and payments move, p_from becomes 'merged' (kept for history).
CREATE OR REPLACE FUNCTION public.comanda_merge(p_from uuid, p_into uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE a pos_comandas; b pos_comandas;
BEGIN
  IF p_from = p_into THEN RAISE EXCEPTION 'same tab'; END IF;
  IF p_from < p_into THEN a := _comanda_lock(p_from); b := _comanda_lock(p_into, ARRAY['open']);
  ELSE b := _comanda_lock(p_into, ARRAY['open']); a := _comanda_lock(p_from); END IF;
  IF a.bar_id <> b.bar_id THEN RAISE EXCEPTION 'tabs belong to different bars'; END IF;
  UPDATE pos_comanda_itens SET comanda_id = p_into WHERE comanda_id = p_from AND removido_em IS NULL;
  UPDATE pos_comanda_pagamentos SET comanda_id = p_into WHERE comanda_id = p_from;
  UPDATE pos_comandas SET status = 'merged', merged_into = p_into, fechada_em = now(),
    pessoas = pessoas WHERE id = p_from;
  UPDATE pos_comandas SET pessoas = b.pessoas + a.pessoas WHERE id = p_into;
  PERFORM _comanda_log(p_from, a.bar_id, 'merged_out', jsonb_build_object('into', p_into));
  PERFORM _comanda_log(p_into, b.bar_id, 'merged_in', jsonb_build_object('from', p_from, 'nome', a.nome));
END $$;

-- Split by items: create one new tab per group and move those lines there.
-- p_groups: [{nome, moves: [{item, qtd}]}]. Returns the new tab ids.
CREATE OR REPLACE FUNCTION public.comanda_split(p_comanda uuid, p_groups jsonb)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE c pos_comandas; g jsonb; v_new uuid; ids uuid[] := '{}'; k integer := 0;
BEGIN
  c := _comanda_lock(p_comanda, ARRAY['open']);
  FOR g IN SELECT * FROM jsonb_array_elements(COALESCE(p_groups, '[]'::jsonb)) LOOP
    k := k + 1;
    INSERT INTO pos_comandas (bar_id, table_id, mesa_nome, nome, pessoas, responsavel_id, responsavel_nome, service_pct)
    VALUES (c.bar_id, c.table_id, c.mesa_nome, COALESCE(NULLIF(trim(g->>'nome'), ''), c.nome || ' / ' || k), 1,
            c.responsavel_id, c.responsavel_nome, c.service_pct)
    RETURNING id INTO v_new;
    PERFORM _comanda_log(v_new, c.bar_id, 'opened', jsonb_build_object('split_from', p_comanda));
    PERFORM comanda_transfer_items(p_comanda, v_new, g->'moves');
    ids := ids || v_new;
  END LOOP;
  PERFORM _comanda_log(p_comanda, c.bar_id, 'split', jsonb_build_object('into', ids));
  RETURN ids;
END $$;

-- Partial (or full) payment. Idempotent on p_key: a retry returns the same totals without charging twice.
CREATE OR REPLACE FUNCTION public.comanda_pay(p_comanda uuid, p_valor numeric, p_metodo text, p_key text, p_pagador text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE c pos_comandas;
BEGIN
  IF p_key IS NULL OR length(p_key) < 8 THEN RAISE EXCEPTION 'payment key required'; END IF;
  c := _comanda_lock(p_comanda);
  IF EXISTS (SELECT 1 FROM pos_comanda_pagamentos WHERE bar_id = c.bar_id AND idem_key = p_key) THEN
    RETURN comanda_totals(p_comanda);
  END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;
  INSERT INTO pos_comanda_pagamentos (comanda_id, bar_id, valor, metodo, idem_key, pagador)
  VALUES (p_comanda, c.bar_id, round(p_valor), COALESCE(NULLIF(trim(p_metodo), ''), 'Cash'), p_key, p_pagador);
  UPDATE pos_comandas SET status = 'awaiting_payment' WHERE id = p_comanda AND status = 'open';
  PERFORM _comanda_log(c.id, c.bar_id, 'payment', jsonb_build_object('valor', round(p_valor), 'metodo', p_metodo, 'pagador', p_pagador));
  RETURN comanda_totals(p_comanda);
END $$;

-- Reverse a payment (kept, marked reversed). Manager or admin only.
CREATE OR REPLACE FUNCTION public.comanda_void_payment(p_payment uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE p pos_comanda_pagamentos; c pos_comandas;
BEGIN
  SELECT * INTO p FROM pos_comanda_pagamentos WHERE id = p_payment AND estornado_em IS NULL;
  IF p.id IS NULL THEN RAISE EXCEPTION 'payment not found'; END IF;
  c := _comanda_lock(p.comanda_id);
  IF NOT jbm_can_manage_bar(c.bar_id) THEN RAISE EXCEPTION 'manager approval required'; END IF;
  UPDATE pos_comanda_pagamentos SET estornado_em = now(), estornado_por = auth.uid() WHERE id = p_payment;
  PERFORM _comanda_log(c.id, c.bar_id, 'payment_reversed', jsonb_build_object('payment', p_payment, 'valor', p.valor, 'reason', p_reason));
  RETURN comanda_totals(c.id);
END $$;

-- Reopen a tab that is waiting for payment so lines can be changed again.
CREATE OR REPLACE FUNCTION public.comanda_reopen(p_comanda uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE c pos_comandas;
BEGIN
  c := _comanda_lock(p_comanda, ARRAY['awaiting_payment']);
  UPDATE pos_comandas SET status = 'open' WHERE id = p_comanda;
  PERFORM _comanda_log(c.id, c.bar_id, 'reopened', '{}'::jsonb);
END $$;

-- Cancel an empty tab (no live lines, no live payments).
CREATE OR REPLACE FUNCTION public.comanda_cancel(p_comanda uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE c pos_comandas;
BEGIN
  c := _comanda_lock(p_comanda);
  IF EXISTS (SELECT 1 FROM pos_comanda_itens WHERE comanda_id = p_comanda AND removido_em IS NULL)
     OR EXISTS (SELECT 1 FROM pos_comanda_pagamentos WHERE comanda_id = p_comanda AND estornado_em IS NULL) THEN
    RAISE EXCEPTION 'tab still has lines or payments' USING ERRCODE = 'P0001';
  END IF;
  UPDATE pos_comandas SET status = 'cancelled', fechada_em = now() WHERE id = p_comanda;
  PERFORM _comanda_log(c.id, c.bar_id, 'cancelled', jsonb_build_object('reason', p_reason));
END $$;

-- ─── the sale (counter or tab), all or nothing ────────────────────────────────────────────
-- p_sale:   {bar_id, total, subtotal, desconto_total, metodo_pagamento, tipo, obs, space_id, drink_back_agent_id,
--            vip_member_id, discount_code_id, comissao_valor, comanda_id}
-- p_items:  [{drink_menu_id, produto_id, nome, qtd, preco_unitario, preco_lista, tipo_preco, desconto_valor}]
-- p_stock:  [{produto_id, qtd}]  bottle count computed by src/lib/posSupply.js (same rule as before)
-- Returns the venda id. Same p_key → same venda id, nothing written twice.
CREATE OR REPLACE FUNCTION public.pos_commit_sale(p_key text, p_sale jsonb, p_items jsonb, p_stock jsonb DEFAULT '[]'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_bar uuid := (p_sale->>'bar_id')::uuid;
  v_id uuid; v_sum numeric := 0; l jsonb; v_menu numeric; v_code record; v_comanda uuid := NULLIF(p_sale->>'comanda_id', '')::uuid;
  c pos_comandas; v_paid numeric;
BEGIN
  IF p_key IS NULL OR length(p_key) < 8 THEN RAISE EXCEPTION 'sale key required'; END IF;
  IF NOT jbm_can_access_bar(v_bar) THEN RAISE EXCEPTION 'bar not allowed'; END IF;

  -- Serialize the same key: the second click waits here and then finds the first sale.
  PERFORM pg_advisory_xact_lock(hashtext(v_bar::text || ':' || p_key));
  SELECT venda_id INTO v_id FROM pos_idempotency WHERE bar_id = v_bar AND key = p_key;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0 THEN RAISE EXCEPTION 'empty sale'; END IF;
  FOR l IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF COALESCE((l->>'qtd')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'quantity must be positive'; END IF;
    IF (l->>'preco_unitario')::numeric < 0 THEN RAISE EXCEPTION 'negative price'; END IF;
    IF COALESCE(l->>'tipo_preco', 'regular') = 'regular' AND (l->>'drink_menu_id') IS NOT NULL THEN
      SELECT preco_venda INTO v_menu FROM drink_menu WHERE id = (l->>'drink_menu_id')::uuid AND bar_id = v_bar;
      IF v_menu IS NULL THEN RAISE EXCEPTION 'drink not on this bar''s menu'; END IF;
      IF v_menu <> (l->>'preco_unitario')::numeric THEN
        RAISE EXCEPTION 'price changed for % (menu %, sent %)', l->>'nome', v_menu, l->>'preco_unitario' USING ERRCODE = '40001';
      END IF;
    END IF;
    v_sum := v_sum + (l->>'qtd')::numeric * (l->>'preco_unitario')::numeric;
  END LOOP;
  IF round(v_sum) <> round((p_sale->>'total')::numeric) THEN
    RAISE EXCEPTION 'total does not match lines (% vs %)', v_sum, p_sale->>'total' USING ERRCODE = '40001';
  END IF;

  IF v_comanda IS NOT NULL THEN
    c := _comanda_lock(v_comanda);
    IF c.bar_id <> v_bar THEN RAISE EXCEPTION 'tab belongs to another bar'; END IF;
    -- The drink lines sent must be exactly the tab's live lines (charges like service/set are added on top).
    IF round((comanda_totals(v_comanda)->>'itens')::numeric) <> round(COALESCE((
         SELECT sum((x->>'qtd')::numeric * (x->>'preco_unitario')::numeric) FROM jsonb_array_elements(p_items) x
         WHERE COALESCE(x->>'tipo_preco', 'regular') NOT IN ('set', 'nominho', 'service', 'room_min')), 0)) THEN
      RAISE EXCEPTION 'tab changed on another device: reload it' USING ERRCODE = '40001';
    END IF;
    SELECT COALESCE(sum(valor), 0) INTO v_paid FROM pos_comanda_pagamentos WHERE comanda_id = v_comanda AND estornado_em IS NULL;
    IF v_paid < round(v_sum) THEN
      RAISE EXCEPTION 'tab not fully paid (% of %)', v_paid, round(v_sum) USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO pos_vendas (bar_id, data, subtotal, desconto_total, total, metodo_pagamento, tipo, vip_member_id,
    discount_code_id, drink_back_agent_id, space_id, obs, comissao_valor, comanda_id, idempotency_key, criado_por)
  VALUES (v_bar, jbm_tokyo_night(), COALESCE((p_sale->>'subtotal')::numeric, v_sum), COALESCE((p_sale->>'desconto_total')::numeric, 0),
    round(v_sum), COALESCE(p_sale->>'metodo_pagamento', 'Cash'), COALESCE(p_sale->>'tipo', 'balcao'),
    NULLIF(p_sale->>'vip_member_id', '')::uuid, NULLIF(p_sale->>'discount_code_id', '')::uuid,
    NULLIF(p_sale->>'drink_back_agent_id', '')::uuid, NULLIF(p_sale->>'space_id', '')::uuid, p_sale->>'obs',
    COALESCE((p_sale->>'comissao_valor')::numeric, 0), v_comanda, p_key, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO pos_vendas_itens (pos_venda_id, drink_menu_id, produto_id, nome, qtd, preco_unitario, preco_lista, tipo_preco, desconto_valor)
  SELECT v_id, NULLIF(x->>'drink_menu_id', '')::uuid, NULLIF(x->>'produto_id', '')::uuid, x->>'nome', (x->>'qtd')::numeric,
    (x->>'preco_unitario')::numeric, NULLIF(x->>'preco_lista', '')::numeric, COALESCE(x->>'tipo_preco', 'regular'),
    COALESCE((x->>'desconto_valor')::numeric, 0)
  FROM jsonb_array_elements(p_items) x;

  INSERT INTO estoque_movimentos (produto_id, bar_id, tipo, qtd, obs, criado_por)
  SELECT (s->>'produto_id')::uuid, v_bar, 'saida', (s->>'qtd')::numeric, 'POS caixa ' || left(v_id::text, 8), auth.uid()
  FROM jsonb_array_elements(COALESCE(p_stock, '[]'::jsonb)) s
  WHERE (s->>'qtd')::numeric > 0;

  IF NULLIF(p_sale->>'discount_code_id', '') IS NOT NULL THEN
    SELECT * INTO v_code FROM discount_codes WHERE id = (p_sale->>'discount_code_id')::uuid AND bar_id = v_bar FOR UPDATE;
    IF v_code.id IS NULL OR NOT v_code.ativo THEN RAISE EXCEPTION 'discount code not valid'; END IF;
    IF v_code.max_usos IS NOT NULL AND COALESCE(v_code.usos_atual, 0) >= v_code.max_usos THEN RAISE EXCEPTION 'discount code used up'; END IF;
    UPDATE discount_codes SET usos_atual = COALESCE(usos_atual, 0) + 1 WHERE id = v_code.id;
    INSERT INTO discount_usages (bar_id, discount_code_id, pos_venda_id, valor_desconto)
    VALUES (v_bar, v_code.id, v_id, COALESCE((p_sale->>'desconto_total')::numeric, 0));
  END IF;

  IF NULLIF(p_sale->>'vip_member_id', '') IS NOT NULL THEN
    INSERT INTO vip_usages (bar_id, vip_member_id, drink_menu_id, produto_id, nome, qtd, preco_aplicado, preco_lista, tipo, pos_venda_id, criado_por)
    SELECT v_bar, (p_sale->>'vip_member_id')::uuid, NULLIF(x->>'drink_menu_id', '')::uuid, NULLIF(x->>'produto_id', '')::uuid,
      x->>'nome', (x->>'qtd')::numeric, (x->>'preco_unitario')::numeric, NULLIF(x->>'preco_lista', '')::numeric, 'vip', v_id, auth.uid()
    FROM jsonb_array_elements(p_items) x
    WHERE COALESCE(x->>'tipo_preco', 'regular') NOT IN ('set', 'nominho', 'service', 'room_min');
  END IF;

  IF v_comanda IS NOT NULL THEN
    UPDATE pos_comandas SET status = 'closed', fechada_em = now(), venda_id = v_id WHERE id = v_comanda;
    PERFORM _comanda_log(v_comanda, v_bar, 'closed', jsonb_build_object('venda', v_id, 'total', round(v_sum)));
  END IF;

  INSERT INTO pos_idempotency (bar_id, key, venda_id) VALUES (v_bar, p_key, v_id);
  RETURN v_id;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'floor_save_layout(uuid, integer, text, integer, integer, jsonb, jsonb)',
    'floor_duplicate_layout(uuid, text)', 'floor_activate_layout(uuid)',
    '_comanda_lock(uuid, text[])', '_comanda_log(uuid, uuid, text, jsonb)', 'comanda_totals(uuid)',
    'comanda_open(uuid, text, uuid, integer, text, numeric, text)', 'comanda_add_items(uuid, jsonb, text)',
    'comanda_set_qty(uuid, numeric)', 'comanda_update(uuid, text, integer, text, text, numeric)',
    'comanda_move_table(uuid, uuid)', 'comanda_transfer_items(uuid, uuid, jsonb)', 'comanda_merge(uuid, uuid)',
    'comanda_split(uuid, jsonb)', 'comanda_pay(uuid, numeric, text, text, text)', 'comanda_void_payment(uuid, text)',
    'comanda_reopen(uuid)', 'comanda_cancel(uuid, text)', 'pos_commit_sale(text, jsonb, jsonb, jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- ─── one-time copy of the legacy `mesas` into a first layout per bar ──────────────────────
-- Runs only for bars that have mesas and no layout yet. Grid placement; the editor can move them.
-- `mesas` and `tabs` are not modified. Tabs history stays readable in `tabs` (22 closed, Jun–Aug 2026).
DO $$
DECLARE b record; v_layout uuid; m record; k integer;
BEGIN
  IF to_regclass('public.mesas') IS NULL THEN RETURN; END IF;
  FOR b IN SELECT DISTINCT bar_id FROM public.mesas WHERE bar_id IS NOT NULL LOOP
    IF EXISTS (SELECT 1 FROM public.floor_layouts WHERE bar_id = b.bar_id) THEN CONTINUE; END IF;
    INSERT INTO public.floor_layouts (bar_id, nome, ativo) VALUES (b.bar_id, 'Salão', true) RETURNING id INTO v_layout;
    k := 0;
    FOR m IN SELECT * FROM public.mesas WHERE bar_id = b.bar_id ORDER BY tipo, nome LOOP
      INSERT INTO public.floor_tables (bar_id, layout_id, nome, forma, x, y, largura, altura, capacidade, ativo, legacy_mesa_id)
      VALUES (b.bar_id, v_layout, m.nome,
        CASE m.tipo WHEN 'counter' THEN 'bar' WHEN 'vip' THEN 'rect' ELSE 'square' END,
        60 + (k % 5) * 200, 60 + (k / 5) * 180,
        CASE m.tipo WHEN 'counter' THEN 260 WHEN 'vip' THEN 150 ELSE 100 END,
        CASE m.tipo WHEN 'counter' THEN 70 ELSE 100 END,
        CASE m.tipo WHEN 'vip' THEN 6 WHEN 'counter' THEN 8 ELSE 4 END,
        COALESCE(m.ativo, true), m.id);
      k := k + 1;
    END LOOP;
  END LOOP;
END $$;

-- ─── rollback (manual, only if nothing has been sold through these functions yet) ─────────
-- DROP FUNCTION IF EXISTS public.pos_commit_sale(text, jsonb, jsonb, jsonb), public.comanda_cancel(uuid, text),
--   public.comanda_reopen(uuid), public.comanda_void_payment(uuid, text), public.comanda_pay(uuid, numeric, text, text, text),
--   public.comanda_split(uuid, jsonb), public.comanda_merge(uuid, uuid), public.comanda_transfer_items(uuid, uuid, jsonb),
--   public.comanda_move_table(uuid, uuid), public.comanda_update(uuid, text, integer, text, text, numeric),
--   public.comanda_set_qty(uuid, numeric), public.comanda_add_items(uuid, jsonb, text),
--   public.comanda_open(uuid, text, uuid, integer, text, numeric, text), public.comanda_totals(uuid),
--   public._comanda_log(uuid, uuid, text, jsonb), public._comanda_lock(uuid, text[]),
--   public.floor_activate_layout(uuid), public.floor_duplicate_layout(uuid, text),
--   public.floor_save_layout(uuid, integer, text, integer, integer, jsonb, jsonb), public.floor_set_table_state(uuid, text, text);
-- DROP TABLE IF EXISTS public.pos_comanda_eventos, public.pos_comanda_pagamentos, public.pos_comanda_itens, public.pos_comandas,
--   public.floor_tables, public.floor_sectors, public.floor_layouts;
-- ALTER TABLE public.pos_vendas DROP COLUMN IF EXISTS comanda_id, DROP COLUMN IF EXISTS idempotency_key;
-- (pos_idempotency and comissao_valor may also belong to pos_floor.sql: keep them if that file was applied.)
