-- Local stand-in for the legacy catalog this repository does not CREATE.
-- A passing run of this file does not prove the production database matches it.
-- Columns follow the read-only production audit and the writes in src/ and api/.
-- It is not a production dump. It does not add produtos.bar_id.
-- Supabase already has auth.uid(), authenticated, and anon. This file creates
-- them only so a disposable Postgres can apply sql/migration_final.sql.

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('pos.test_actor', true), '')::uuid;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOINHERIT;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO authenticated, anon;

CREATE TABLE IF NOT EXISTS public.bars (
  id uuid PRIMARY KEY,
  nome text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.perfis (
  id uuid PRIMARY KEY,
  nome text,
  email text,
  role text,
  bar_id uuid REFERENCES public.bars(id)
);

CREATE TABLE IF NOT EXISTS public.produtos (
  id uuid PRIMARY KEY,
  nome text NOT NULL,
  categoria text,
  preco_venda integer,
  custo numeric,
  ativo boolean NOT NULL DEFAULT true,
  estoque_atual integer,
  estoque_minimo integer,
  estoque_maximo integer,
  volume_ml integer
);

CREATE TABLE IF NOT EXISTS public.fornecedores (
  id uuid PRIMARY KEY,
  nome text NOT NULL,
  email text,
  ativo boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.pedidos (
  id uuid PRIMARY KEY,
  bar_id uuid REFERENCES public.bars(id),
  status text,
  total_estimado numeric,
  criado_em timestamptz NOT NULL DEFAULT now(),
  data_pedido date,
  obs text
);

CREATE TABLE IF NOT EXISTS public.pedidos_itens (
  id uuid PRIMARY KEY,
  pedido_id uuid NOT NULL REFERENCES public.pedidos(id),
  produto_id uuid REFERENCES public.produtos(id),
  qtd integer,
  preco_unitario numeric
);

CREATE TABLE IF NOT EXISTS public.vendas (
  id uuid PRIMARY KEY,
  bar_id uuid REFERENCES public.bars(id),
  data date,
  data_venda timestamptz,
  total numeric,
  obs text,
  criado_por uuid,
  cast_id uuid,
  comissao_total numeric
);

CREATE TABLE IF NOT EXISTS public.vendas_itens (
  id uuid PRIMARY KEY,
  venda_id uuid NOT NULL REFERENCES public.vendas(id),
  produto_id uuid REFERENCES public.produtos(id),
  qtd integer,
  preco_unitario numeric
);

CREATE TABLE IF NOT EXISTS public.caixa_movimentos (
  id uuid PRIMARY KEY,
  tipo text,
  valor numeric,
  data timestamptz,
  descricao text
);

CREATE TABLE IF NOT EXISTS public.estoque_movimentos (
  id uuid PRIMARY KEY,
  produto_id uuid,
  bar_id uuid,
  tipo text,
  qtd integer,
  criado_por uuid,
  obs text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.bars, public.perfis, public.produtos, public.fornecedores,
  public.pedidos, public.pedidos_itens, public.vendas, public.vendas_itens,
  public.caixa_movimentos, public.estoque_movimentos
TO authenticated;
