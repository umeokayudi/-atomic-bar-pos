-- Tables as they are in production on 2026-11-18 (columns only), with the old "any logged-in user" policies
-- and the public (anon) grants, so sql/rls_por_papel.sql is tested against the real starting point.
CREATE TABLE IF NOT EXISTS public.bar_pricing (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bar_id uuid, produto_id uuid, drinks_por_garrafa numeric, preco_drink numeric, criado_em timestamptz DEFAULT now());
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF; END $$;
ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS estoque_atual integer;
CREATE TABLE IF NOT EXISTS public.cast_members (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bar_id uuid, nome text, ativo boolean);
CREATE TABLE IF NOT EXISTS public.cast_comissoes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cast_id uuid, venda_id uuid, valor numeric(12,2), data timestamptz);
CREATE TABLE IF NOT EXISTS public.compras (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), data date, fornecedor text, total_pago numeric, total_real numeric, criado_por uuid);
CREATE TABLE IF NOT EXISTS public.compras_itens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), compra_id uuid, nome text, qtd numeric, custo_unitario numeric);
CREATE TABLE IF NOT EXISTS public.drink_recipes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bar_id uuid, nome text, preco_venda numeric);
CREATE TABLE IF NOT EXISTS public.drink_recipe_itens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipe_id uuid, produto_id uuid, quantidade_ml numeric);
CREATE TABLE IF NOT EXISTS public.estoque_regras (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bar_id uuid, produto_id uuid, minimo integer);
CREATE TABLE IF NOT EXISTS public.faturas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bar_id uuid, venda_id uuid, valor numeric, status text, data_emissao date, data_vencimento date, data_pagamento date, obs text, periodo_inicio date, periodo_fim date, total numeric, pago numeric, notas text);
CREATE TABLE IF NOT EXISTS public.fatura_pagamentos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fatura_id uuid, valor numeric, metodo text, data date, notas text, criado_em timestamptz DEFAULT now(), comprovante_url text, confirmado boolean DEFAULT false, confirmado_em timestamptz, submetido_por uuid);
CREATE TABLE IF NOT EXISTS public.fornecedores (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text, ativo boolean);
CREATE TABLE IF NOT EXISTS public.fornecedor_precos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fornecedor_id uuid, produto_id uuid, preco numeric);
CREATE TABLE IF NOT EXISTS public.hourly_revenue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bar_id uuid, hora integer, total numeric(12,2));
CREATE TABLE IF NOT EXISTS public.notificacoes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, tipo text, titulo text, mensagem text, lida boolean DEFAULT false);
CREATE TABLE IF NOT EXISTS public.pedidos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bar_id uuid, criado_por uuid, status text, obs text, total_estimado numeric);
CREATE TABLE IF NOT EXISTS public.pedidos_itens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pedido_id uuid, produto_id uuid, qtd numeric, preco_unitario numeric);
CREATE TABLE IF NOT EXISTS public.pedido_itens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pedido_id uuid, produto_id uuid, qtd integer);
CREATE TABLE IF NOT EXISTS public.ryoshusho (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), numero text, bar_id uuid, data_emissao date, subtotal numeric, consumo_tax numeric, total numeric, itens jsonb);
CREATE TABLE IF NOT EXISTS public.vendas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), data date, bar_id uuid, total numeric(12,2), obs text, criado_por uuid);
CREATE TABLE IF NOT EXISTS public.vendas_itens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), venda_id uuid, produto_id uuid, qtd numeric, preco_unitario numeric(12,2));
CREATE OR REPLACE VIEW public.produtos_public AS SELECT id, nome, categoria, preco_venda FROM public.produtos;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bar_pricing','bars','compras','compras_itens','drink_menu','drink_recipe_itens','drink_recipes',
    'estoque_movimentos','estoque_regras','fatura_pagamentos','faturas','fornecedor_precos','fornecedores','notificacoes',
    'pedidos_itens','perfis','ryoshusho'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS read ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS write ON public.%I', t);
    EXECUTE format($p$CREATE POLICY read ON public.%I FOR SELECT USING (auth.role() = 'authenticated')$p$, t);
    EXECUTE format($p$CREATE POLICY write ON public.%I FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated')$p$, t);
  END LOOP;
  -- RLS off + open policies (ignored while RLS is off), as in production.
  FOREACH t IN ARRAY ARRAY['caixa_movimentos','cast_comissoes','cast_members','hourly_revenue','mesas','pedido_itens','pedidos','produtos','tabs','vendas','vendas_itens'] LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS aberto ON public.%I', t);
    EXECUTE format('CREATE POLICY aberto ON public.%I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
CREATE OR REPLACE FUNCTION public.deduct_stock(p_produto_id uuid, p_qty integer) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$ UPDATE public.produtos SET estoque_atual = COALESCE(estoque_atual, 0) - p_qty WHERE id = p_produto_id $$;
CREATE TABLE IF NOT EXISTS public.pos_vendas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bar_id uuid, data date, subtotal numeric, desconto_total numeric, total numeric, metodo_pagamento text, drink_back_agent_id uuid, obs text, refunded numeric, card_fee numeric, card_fee_reversed numeric, criado_por uuid, criado_em timestamptz DEFAULT now(), comissao_valor numeric);
CREATE TABLE IF NOT EXISTS public.pos_vendas_itens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pos_venda_id uuid, nome text, qtd numeric, preco_unitario numeric);
ALTER TABLE public.pos_vendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_vendas_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bar ON public.pos_vendas;
CREATE POLICY bar ON public.pos_vendas FOR ALL TO authenticated USING (bar_id = (SELECT p.bar_id FROM public.perfis p WHERE p.id = auth.uid())) WITH CHECK (bar_id = (SELECT p.bar_id FROM public.perfis p WHERE p.id = auth.uid()));
GRANT ALL ON public.pos_vendas, public.pos_vendas_itens TO authenticated;
