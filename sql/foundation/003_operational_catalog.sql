-- Tables the application and the later SQL files already name.
-- Proposed canonical shape for a fresh database. Not a production dump.
-- Later files ALTER some of these columns; creating them here makes those
-- ALTERs no-ops on a clean install.
--
-- Product model (proposed, not a verified historical schema):
--   produtos.bar_id NULL  = global catalog identity.
--   produtos.bar_id set   = legacy bar-scoped row still required by create_order.
--   bar_catalog           = bar activation, cost, stock policy, minimum stock.
--   bar_product_prices    = procurement sale price (sql/procurement.sql).
--   bar_pricing / drink_menu = till prices used by sql/pos_floor.sql.

CREATE TABLE IF NOT EXISTS public.produtos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  categoria text,
  ativo boolean NOT NULL DEFAULT true,
  barcode text,
  volume_ml integer,
  custo numeric,
  preco_venda numeric,
  estoque_atual integer,
  estoque_minimo integer DEFAULT 5,
  estoque_maximo integer DEFAULT 50,
  bar_id uuid REFERENCES public.bars(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS produtos_bar_idx ON public.produtos (bar_id);
CREATE INDEX IF NOT EXISTS produtos_barcode_idx ON public.produtos (barcode) WHERE barcode IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.bar_catalog (
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  sale_price numeric,
  cost numeric,
  min_stock integer NOT NULL DEFAULT 0,
  stock_policy text NOT NULL DEFAULT 'block' CHECK (stock_policy IN ('block', 'allow_negative')),
  barcode text,
  available boolean NOT NULL DEFAULT true,
  PRIMARY KEY (bar_id, product_id)
);

CREATE OR REPLACE VIEW public.produtos_public AS
SELECT id, nome, categoria, ativo, barcode, volume_ml, preco_venda, bar_id, created_at
FROM public.produtos
WHERE ativo IS TRUE;

COMMENT ON VIEW public.produtos_public IS
  'Till catalog without cost. Proposed view; the production view body was not read.';

CREATE TABLE IF NOT EXISTS public.drink_menu (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  nome text NOT NULL,
  categoria text,
  preco_venda numeric NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true,
  produto_id uuid REFERENCES public.produtos(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bar_pricing (
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  preco_drink numeric,
  drinks_por_garrafa numeric,
  PRIMARY KEY (bar_id, produto_id)
);

CREATE TABLE IF NOT EXISTS public.drink_back_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  nome text,
  ativo boolean NOT NULL DEFAULT true,
  comissao_pct numeric
);

CREATE TABLE IF NOT EXISTS public.vendas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  data timestamptz NOT NULL DEFAULT now(),
  data_venda timestamptz NOT NULL DEFAULT now(),
  total numeric NOT NULL DEFAULT 0,
  forma_pagamento text,
  mesa text,
  cast_id uuid,
  comissao_total numeric(10,2) DEFAULT 0,
  status text DEFAULT 'confirmada',
  obs text
);

CREATE TABLE IF NOT EXISTS public.vendas_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venda_id uuid NOT NULL REFERENCES public.vendas(id) ON DELETE CASCADE,
  produto_id uuid REFERENCES public.produtos(id),
  quantidade integer NOT NULL CHECK (quantidade > 0),
  preco_unitario numeric NOT NULL,
  subtotal numeric NOT NULL,
  comissao numeric DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.pos_vendas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  data date,
  subtotal integer,
  desconto_total integer DEFAULT 0,
  total integer,
  metodo_pagamento text,
  tipo text,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  obs text,
  drink_back_agent_id uuid,
  comissao_valor integer DEFAULT 0,
  comissao_estornada integer DEFAULT 0,
  void_status text,
  refunded integer DEFAULT 0,
  card_fee integer DEFAULT 0,
  card_fee_reversed integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.pos_vendas_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_venda_id uuid REFERENCES public.pos_vendas(id) ON DELETE CASCADE,
  drink_menu_id uuid,
  produto_id uuid,
  nome text,
  qtd integer,
  preco_unitario numeric,
  preco_lista numeric,
  tipo_preco text,
  desconto_valor integer,
  for_cast boolean DEFAULT false,
  comissao_valor integer DEFAULT 0,
  refunded_qtd integer DEFAULT 0,
  stock_mode text
);

CREATE TABLE IF NOT EXISTS public.pos_sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  ticket_id uuid,
  pos_venda_id uuid REFERENCES public.pos_vendas(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('cash', 'dinheiro', 'card', 'credit', 'other')),
  amount integer NOT NULL CHECK (amount > 0),
  fee integer NOT NULL DEFAULT 0 CHECK (fee >= 0),
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bar_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.caixa_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  valor integer NOT NULL,
  descricao text,
  referencia_id uuid,
  referencia_tipo text,
  data timestamptz NOT NULL DEFAULT now(),
  operational_day date,
  criado_por uuid
);

CREATE TABLE IF NOT EXISTS public.cash_closings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  operational_day date NOT NULL,
  expected_cash integer NOT NULL,
  counted_cash integer NOT NULL,
  closed_by uuid NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bar_id, operational_day)
);

CREATE TABLE IF NOT EXISTS public.pos_settings (
  bar_id uuid PRIMARY KEY REFERENCES public.bars(id) ON DELETE CASCADE,
  tax_rate numeric NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate < 1),
  tax_included boolean NOT NULL DEFAULT true,
  card_fee_rate numeric NOT NULL DEFAULT 0.0378 CHECK (card_fee_rate >= 0 AND card_fee_rate < 1),
  service_charge_rate numeric NOT NULL DEFAULT 0 CHECK (service_charge_rate >= 0 AND service_charge_rate < 1)
);

COMMENT ON TABLE public.pos_settings IS
  'Tax is not assumed. tax_rate 0 adds nothing. The browser demo keeps its own labeled 10 percent.';

CREATE TABLE IF NOT EXISTS public.estoque_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN (
    'entrada', 'saida', 'ajuste', 'perda', 'transferencia', 'devolucao', 'estorno'
  )),
  qtd integer NOT NULL CHECK (qtd > 0),
  criado_por uuid,
  obs text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS estoque_movimentos_bar_produto_idx
  ON public.estoque_movimentos (bar_id, produto_id);

CREATE TABLE IF NOT EXISTS public.estoque_regras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  minimo integer NOT NULL DEFAULT 0,
  UNIQUE (bar_id, produto_id)
);

CREATE TABLE IF NOT EXISTS public.pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  criado_por uuid,
  status text NOT NULL DEFAULT 'pendente',
  data_pedido timestamptz NOT NULL DEFAULT now(),
  data_entrega_prevista timestamptz,
  entrega_desejada timestamptz,
  obs text,
  total_estimado numeric DEFAULT 0,
  public_code text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pedidos_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id uuid NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.produtos(id),
  qtd numeric NOT NULL CHECK (qtd > 0),
  preco_unitario numeric
);

CREATE TABLE IF NOT EXISTS public.fornecedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  email text,
  pagamento text,
  prazo_entrega_dias integer,
  pontos_pct numeric,
  website text,
  ativo boolean NOT NULL DEFAULT true,
  default_lead_time_hours integer,
  cutoff_time time,
  delivery_days text
);

CREATE TABLE IF NOT EXISTS public.supplier_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'staff',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.fornecedor_precos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornecedor_id uuid NOT NULL REFERENCES public.fornecedores(id) ON DELETE CASCADE,
  produto_id uuid NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  preco numeric NOT NULL,
  UNIQUE (fornecedor_id, produto_id)
);

CREATE TABLE IF NOT EXISTS public.compras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid REFERENCES public.bars(id) ON DELETE SET NULL,
  data date,
  fornecedor text,
  valor numeric,
  status_pagamento text,
  data_pagamento date,
  metodo_pagamento_real text,
  obs text
);

CREATE TABLE IF NOT EXISTS public.compras_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id uuid NOT NULL REFERENCES public.compras(id) ON DELETE CASCADE,
  produto_id uuid REFERENCES public.produtos(id),
  qtd numeric,
  preco numeric
);

CREATE TABLE IF NOT EXISTS public.faturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid REFERENCES public.bars(id) ON DELETE CASCADE,
  status text,
  valor numeric,
  total numeric,
  pago numeric,
  data_vencimento date,
  periodo_inicio date,
  periodo_fim date,
  obs text,
  notes text,
  descricao text,
  client_name text,
  tipo text
);

CREATE TABLE IF NOT EXISTS public.fatura_pagamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fatura_id uuid NOT NULL REFERENCES public.faturas(id) ON DELETE CASCADE,
  valor numeric,
  confirmado boolean NOT NULL DEFAULT false,
  metodo text,
  data date,
  criado_em timestamptz NOT NULL DEFAULT now(),
  confirmado_em timestamptz
);

CREATE TABLE IF NOT EXISTS public.ryoshusho (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid REFERENCES public.bars(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  tipo text,
  titulo text,
  mensagem text,
  link text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  tipo text,
  valor numeric,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vip_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  nome text NOT NULL,
  codigo text,
  line_id text,
  ativo boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.vip_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  vip_member_id uuid REFERENCES public.vip_members(id) ON DELETE SET NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bar_spaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  nome text,
  tipo text,
  zona text,
  ordem integer DEFAULT 0,
  ativo boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.bar_guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  nome text NOT NULL,
  aniversario date,
  line_id text,
  vip_member_id uuid,
  preferencias text,
  alergias text,
  ativo boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.bar_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  space_id uuid REFERENCES public.bar_spaces(id) ON DELETE SET NULL,
  guest_id uuid REFERENCES public.bar_guests(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'seated'
);

CREATE TABLE IF NOT EXISTS public.bar_bottle_keeps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  guest_id uuid REFERENCES public.bar_guests(id) ON DELETE SET NULL,
  nome text,
  remaining_pct numeric,
  expires_on date,
  ativo boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.pos_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  night_key text NOT NULL,
  status text,
  opened_by uuid,
  opened_at timestamptz,
  closed_at timestamptz,
  UNIQUE (bar_id, night_key)
);

CREATE TABLE IF NOT EXISTS public.time_clock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL,
  punched_at timestamptz NOT NULL DEFAULT now(),
  tipo text NOT NULL CHECK (tipo IN ('in', 'out', 'break_start', 'break_end'))
);

CREATE INDEX IF NOT EXISTS time_clock_staff_idx ON public.time_clock (staff_id, punched_at);

CREATE TABLE IF NOT EXISTS public.bar_hq_meta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid REFERENCES public.bars(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text
);

CREATE TABLE IF NOT EXISTS public.bar_overhead (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid REFERENCES public.bars(id) ON DELETE CASCADE,
  nome text,
  valor numeric,
  mes date
);

CREATE TABLE IF NOT EXISTS public.schema_install (
  id integer PRIMARY KEY CHECK (id = 1),
  version text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT now()
);
