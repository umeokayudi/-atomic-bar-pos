-- Minimal copy of the production "Drink supplier" schema (columns read 2026-10-10) for local tests only.
-- Never run against Supabase. Creates the auth stub a plain Postgres needs.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO authenticated, anon;

CREATE TABLE IF NOT EXISTS public.bars (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text, cor text, criado_em timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.perfis (id uuid PRIMARY KEY, nome text, role text, bar_id uuid, email text, criado_em timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.produtos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text, categoria text, custo numeric, preco_venda numeric,
  ativo boolean DEFAULT true, drinks_por_garrafa numeric, preco_drink numeric, volume_ml numeric, criado_em timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.drink_menu (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bar_id uuid, categoria text, nome text, receita text,
  preco_venda integer, custo integer, preco_desconto integer, criado_em timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.estoque_movimentos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), produto_id uuid, bar_id uuid, tipo text, qtd numeric,
  obs text, criado_por uuid, criado_em timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.caixa_movimentos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tipo text, valor numeric, descricao text, metodo text,
  data date, criado_em timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.mesas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bar_id uuid, nome text, tipo text, qr_token text, ativo boolean,
  criado_em timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.tabs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bar_id uuid, mesa_id uuid, mesa_nome text, status text,
  opened_at timestamptz, closed_at timestamptz, total numeric, payment text, criado_em timestamptz DEFAULT now());

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
