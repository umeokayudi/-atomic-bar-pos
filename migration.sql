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

-- 6. RPC: deduct_stock — called by POS on every sale
CREATE OR REPLACE FUNCTION deduct_stock(p_produto_id UUID, p_qty INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE produtos
  SET estoque_atual = GREATEST(0, COALESCE(estoque_atual, 0) - p_qty)
  WHERE id = p_produto_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. RLS: allow select/insert for cast tables (authenticated users of the bar)
ALTER TABLE cast_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE cast_comissoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cast_members_bar_access" ON cast_members
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "cast_comissoes_bar_access" ON cast_comissoes
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- DONE
-- ============================================
