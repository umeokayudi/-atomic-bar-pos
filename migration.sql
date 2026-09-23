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

-- 8. Staff payment fields on cast_members
ALTER TABLE cast_members
  ADD COLUMN IF NOT EXISTS local_id UUID,
  ADD COLUMN IF NOT EXISTS forma_pagamento TEXT DEFAULT 'comissao',
  ADD COLUMN IF NOT EXISTS valor_hora NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS percentual_comissao NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS ciclo_pagamento TEXT DEFAULT 'mensal',
  ADD COLUMN IF NOT EXISTS dia_pagamento INTEGER DEFAULT 25,
  ADD COLUMN IF NOT EXISTS pix TEXT;

-- 9. Locations (cost / staff assignment)
CREATE TABLE IF NOT EXISTS locais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  endereco TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$ BEGIN
  ALTER TABLE cast_members
    ADD CONSTRAINT cast_members_local_fk
    FOREIGN KEY (local_id) REFERENCES locais(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 10. Hours worked
CREATE TABLE IF NOT EXISTS staff_horas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES cast_members(id) ON DELETE CASCADE,
  bar_id UUID REFERENCES bars(id) ON DELETE SET NULL,
  data DATE NOT NULL,
  horas NUMERIC(6,2) NOT NULL,
  observacao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. Payroll / pay schedule records
CREATE TABLE IF NOT EXISTS staff_pagamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES cast_members(id) ON DELETE CASCADE,
  bar_id UUID REFERENCES bars(id) ON DELETE SET NULL,
  periodo_inicio DATE,
  periodo_fim DATE,
  vencimento DATE,
  valor NUMERIC(12,2) NOT NULL DEFAULT 0,
  tipo TEXT,
  status TEXT NOT NULL DEFAULT 'pendente',
  pago_em TIMESTAMPTZ,
  observacao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Mark commissions as paid
ALTER TABLE cast_comissoes
  ADD COLUMN IF NOT EXISTS pago BOOLEAN NOT NULL DEFAULT false;

-- 13. Fixed + variable costs per location
CREATE TABLE IF NOT EXISTS custos_locais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  local_id UUID NOT NULL REFERENCES locais(id) ON DELETE CASCADE,
  bar_id UUID REFERENCES bars(id) ON DELETE SET NULL,
  nome TEXT NOT NULL,
  categoria TEXT,
  natureza TEXT NOT NULL DEFAULT 'fixo',
  valor NUMERIC(12,2) NOT NULL DEFAULT 0,
  frequencia TEXT DEFAULT 'mensal',
  dia_vencimento INTEGER,
  data DATE,
  observacao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE locais ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_horas ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_pagamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE custos_locais ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "locais_access" ON locais FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "staff_horas_access" ON staff_horas FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "staff_pagamentos_access" ON staff_pagamentos FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "custos_locais_access" ON custos_locais FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 14. VIP karaoke rooms and sessions
CREATE TABLE IF NOT EXISTS salas_vip (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id UUID REFERENCES bars(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  capacidade INTEGER NOT NULL DEFAULT 4,
  preco_hora NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxa_pessoa NUMERIC(12,2) NOT NULL DEFAULT 0,
  minimo_minutos INTEGER NOT NULL DEFAULT 60,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessoes_vip (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sala_id UUID NOT NULL REFERENCES salas_vip(id) ON DELETE CASCADE,
  bar_id UUID REFERENCES bars(id) ON DELETE SET NULL,
  inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fim TIMESTAMPTZ,
  pessoas INTEGER NOT NULL DEFAULT 1,
  valor NUMERIC(12,2),
  forma_pagamento TEXT,
  status TEXT NOT NULL DEFAULT 'aberta',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 15. Clock-in for the live staff cost
CREATE TABLE IF NOT EXISTS staff_turnos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES cast_members(id) ON DELETE CASCADE,
  bar_id UUID REFERENCES bars(id) ON DELETE SET NULL,
  entrada TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  saida TIMESTAMPTZ,
  valor_hora NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE salas_vip ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessoes_vip ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_turnos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "salas_vip_access" ON salas_vip FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "sessoes_vip_access" ON sessoes_vip FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "staff_turnos_access" ON staff_turnos FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- DONE
-- ============================================

