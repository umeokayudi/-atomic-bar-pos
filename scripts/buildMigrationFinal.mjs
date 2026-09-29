/**
 * Builds sql/migration_final.sql. Does not connect to a database.
 * Procurement is copied after supplier fulfillment so its functions win.
 * pos_vendas is created before sql/pos_floor.sql alters it.
 * The historical caixa backfill UPDATE is left out.
 * deduct_stock and create_order are left out.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const header = `-- Migration designed but not executed.
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

`

const floor = read('sql/pos_floor.sql').replace(
  /UPDATE public\.caixa_movimentos\s+SET operational_day = public\.pos_tokyo_night\(data::timestamptz\)\s+WHERE operational_day IS NULL\s+AND data IS NOT NULL;\s*/,
  '-- Historical operational_day backfill omitted. Old cash rows keep a null night until a person assigns the bar.\n\n',
)

const tail = `
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
`

if (!floor.includes('Historical operational_day backfill omitted')) {
  throw new Error('pos_floor backfill was not removed')
}
if (/UPDATE public\.caixa_movimentos/.test(floor)) {
  throw new Error('pos_floor still updates caixa_movimentos')
}

const parts = [
  header,
  '\n-- ===== sql/supplier_fulfillment.sql =====\n',
  read('sql/supplier_fulfillment.sql'),
  '\n-- ===== sql/procurement.sql =====\n',
  read('sql/procurement.sql'),
  '\n-- ===== sql/pos_floor.sql (backfill removed) =====\n',
  floor,
  '\n-- ===== sql/payroll.sql =====\n',
  read('sql/payroll.sql'),
  '\n-- ===== sql/bar_employees.sql =====\n',
  read('sql/bar_employees.sql'),
  '\n-- ===== sql/pos_ux.sql =====\n',
  read('sql/pos_ux.sql'),
  tail,
]

const sql = parts.join('\n')
if (/CREATE (?:OR REPLACE )?FUNCTION public\.(deduct_stock|create_order)\b/.test(sql)) {
  throw new Error('blocked functions were included')
}
if (/ADD COLUMN IF NOT EXISTS bar_id/.test(sql) && /ALTER TABLE public\.produtos[^;]*bar_id/.test(sql)) {
  throw new Error('produtos.bar_id was included')
}
writeFileSync(new URL('sql/migration_final.sql', root), sql)
console.log(`wrote sql/migration_final.sql (${sql.split('\n').length} lines)`)
