-- Atomic till: the tables the POS screen needs to sell.
-- Run once in the Supabase SQL editor (project ojirgkqtqvugqktyuhem).
-- Additive only: CREATE ... IF NOT EXISTS and ADD COLUMN IF NOT EXISTS. Nothing is dropped or rewritten.
-- Policies follow the pattern the existing bar tables use (any signed-in user).
--
-- After this file:
--   pos_vendas / pos_vendas_itens  -> each sale and its lines (the till total and "most ordered")
--   drink_back_agents              -> cast / drink back on a sale (optional)
--   bar_spaces                     -> tables and counter seats (optional; the till sells at the counter without them)
--   pos_shifts                     -> night close
--   vip_members, vip_usages, discount_codes, discount_usages -> owner tabs
--   drink_menu.imagem_url, produtos.imagem_url -> photo on the till tile (empty = icon)

CREATE TABLE IF NOT EXISTS public.pos_vendas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  data date NOT NULL DEFAULT current_date,
  subtotal numeric NOT NULL DEFAULT 0,
  desconto_total numeric DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  metodo_pagamento text DEFAULT 'Cash',
  tipo text DEFAULT 'balcao',
  vip_member_id uuid,
  discount_code_id uuid,
  drink_back_agent_id uuid,
  space_id uuid,
  guest_id uuid,
  visit_id uuid,
  obs text,
  refunded numeric NOT NULL DEFAULT 0,
  card_fee numeric NOT NULL DEFAULT 0,
  card_fee_reversed numeric NOT NULL DEFAULT 0,
  criado_por uuid,
  criado_em timestamptz DEFAULT now()
);
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS drink_back_agent_id uuid;
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS space_id uuid;
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS guest_id uuid;
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS visit_id uuid;
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS obs text;
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS refunded numeric NOT NULL DEFAULT 0;
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS card_fee numeric NOT NULL DEFAULT 0;
ALTER TABLE public.pos_vendas ADD COLUMN IF NOT EXISTS card_fee_reversed numeric NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.pos_vendas_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_venda_id uuid REFERENCES public.pos_vendas(id) ON DELETE CASCADE,
  drink_menu_id uuid REFERENCES public.drink_menu(id),
  produto_id uuid REFERENCES public.produtos(id),
  nome text NOT NULL,
  qtd numeric NOT NULL DEFAULT 1,
  preco_unitario numeric NOT NULL,
  preco_lista numeric,
  tipo_preco text DEFAULT 'regular',
  desconto_valor numeric DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.drink_back_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  nome text NOT NULL,
  regiao text,
  comissao_pct numeric NOT NULL DEFAULT 10,
  notas text,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bar_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  nome text NOT NULL,
  tipo text NOT NULL DEFAULT 'table',
  capacidade integer NOT NULL DEFAULT 1,
  zona text,
  ordem integer NOT NULL DEFAULT 0,
  notas text,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pos_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  night_key date NOT NULL,
  status text NOT NULL DEFAULT 'open',
  closed_at timestamptz,
  closed_by uuid,
  ticket_count integer DEFAULT 0,
  drinks_total numeric DEFAULT 0,
  cash_total numeric DEFAULT 0,
  card_total numeric DEFAULT 0,
  other_total numeric DEFAULT 0,
  expected_cash numeric DEFAULT 0,
  counted_cash numeric DEFAULT 0,
  variance numeric DEFAULT 0,
  criado_em timestamptz DEFAULT now(),
  UNIQUE (bar_id, night_key)
);

CREATE TABLE IF NOT EXISTS public.vip_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  nome text NOT NULL,
  codigo text,
  tier text DEFAULT 'standard',
  ativo boolean DEFAULT true,
  notas text,
  criado_em timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vip_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  vip_member_id uuid REFERENCES public.vip_members(id),
  drink_menu_id uuid REFERENCES public.drink_menu(id),
  produto_id uuid REFERENCES public.produtos(id),
  nome text NOT NULL,
  qtd numeric NOT NULL DEFAULT 1,
  preco_aplicado numeric NOT NULL,
  preco_lista numeric,
  tipo text DEFAULT 'vip',
  pos_venda_id uuid REFERENCES public.pos_vendas(id) ON DELETE CASCADE,
  obs text,
  criado_por uuid,
  criado_em timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  codigo text NOT NULL,
  descricao text,
  tipo text NOT NULL DEFAULT 'percent',
  valor numeric NOT NULL,
  drink_menu_id uuid REFERENCES public.drink_menu(id),
  produto_id uuid REFERENCES public.produtos(id),
  max_usos integer,
  usos_atual integer DEFAULT 0,
  valido_ate date,
  ativo boolean DEFAULT true,
  criado_em timestamptz DEFAULT now(),
  UNIQUE (bar_id, codigo)
);

CREATE TABLE IF NOT EXISTS public.discount_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  discount_code_id uuid REFERENCES public.discount_codes(id),
  pos_venda_id uuid REFERENCES public.pos_vendas(id) ON DELETE CASCADE,
  valor_desconto numeric NOT NULL DEFAULT 0,
  criado_em timestamptz DEFAULT now()
);

ALTER TABLE public.drink_menu ADD COLUMN IF NOT EXISTS imagem_url text;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS imagem_url text;

CREATE INDEX IF NOT EXISTS pos_vendas_bar_data_idx ON public.pos_vendas (bar_id, data DESC);
CREATE INDEX IF NOT EXISTS pos_vendas_itens_venda_idx ON public.pos_vendas_itens (pos_venda_id);
CREATE INDEX IF NOT EXISTS bar_spaces_bar_idx ON public.bar_spaces (bar_id, ordem);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pos_vendas', 'pos_vendas_itens', 'drink_back_agents', 'bar_spaces', 'pos_shifts',
    'vip_members', 'vip_usages', 'discount_codes', 'discount_usages'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'read') THEN
      EXECUTE format('CREATE POLICY read ON public.%I FOR SELECT USING (auth.role() = ''authenticated'')', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'write') THEN
      EXECUTE format('CREATE POLICY write ON public.%I FOR ALL USING (auth.role() = ''authenticated'') WITH CHECK (auth.role() = ''authenticated'')', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

SELECT 'Atomic till tables ready' AS status;
