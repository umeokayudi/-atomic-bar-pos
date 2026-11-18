-- RLS por papel em TODAS as tabelas (Missão Máxima, Bloco 1.2).
-- PENDENTE: o dono aplica no Supabase (SQL Editor) depois de publicar o código desta branch.
-- Não altera nem apaga nenhum dado: só liga RLS, troca políticas e tira permissões do público (anon).
-- Pode rodar mais de uma vez. Rollback no fim. Testado em scripts/tests/rlsPorPapel.pg.test.mjs.
--
-- Quem é quem (perfis.role):
--   HQ (JBM):       admin, jbm, staff, funcionario     -> opera a distribuidora
--   Dinheiro do HQ: admin, jbm, staff                   -> faturas, recibos, pagamentos
--   Bar:            cliente (dono), gerente, caixa, bar_staff -> só o próprio bar
--   Dinheiro do bar: cliente, gerente                   -> vê as próprias faturas; nunca confirma recebimento
--   Sem login (anon): nada.

-- 0) Funções de apoio (SECURITY DEFINER: leem perfis sem depender das políticas de perfis).
CREATE OR REPLACE FUNCTION public.jbm_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.role FROM public.perfis p WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.jbm_my_bar() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.bar_id FROM public.perfis p WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.jbm_is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.jbm_role() IN ('admin', 'jbm'), false);
$$;

CREATE OR REPLACE FUNCTION public.jbm_is_hq() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.jbm_role() IN ('admin', 'jbm', 'staff', 'funcionario'), false);
$$;

CREATE OR REPLACE FUNCTION public.jbm_is_money_hq() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.jbm_role() IN ('admin', 'jbm', 'staff'), false);
$$;

-- HQ, ou qualquer login do próprio bar.
CREATE OR REPLACE FUNCTION public.jbm_bar_or_hq(p_bar uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.jbm_is_hq()
      OR COALESCE(p_bar IS NOT NULL AND p_bar = public.jbm_my_bar()
                  AND public.jbm_role() IN ('cliente', 'gerente', 'caixa', 'bar_staff'), false);
$$;

-- HQ, ou dono/gerente do próprio bar.
CREATE OR REPLACE FUNCTION public.jbm_bar_boss_or_hq(p_bar uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.jbm_is_hq()
      OR COALESCE(p_bar IS NOT NULL AND p_bar = public.jbm_my_bar()
                  AND public.jbm_role() IN ('cliente', 'gerente'), false);
$$;

-- Dinheiro: HQ (admin/jbm/staff) vê tudo; o bar só o dono/gerente e só o próprio bar.
CREATE OR REPLACE FUNCTION public.jbm_can_see_bar_money(p_bar uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.jbm_is_money_hq()
      OR COALESCE(p_bar IS NOT NULL AND p_bar = public.jbm_my_bar()
                  AND public.jbm_role() IN ('cliente', 'gerente'), false);
$$;

-- 1) Liga RLS nas 11 tabelas que estavam abertas e em todas as outras (não faz nada onde já está ligado).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;

-- 2) Remove as políticas "qualquer logado" / "aberto a todos" das tabelas abaixo e cria as políticas por papel.
DO $$
DECLARE
  t text;
  p record;
  tabelas text[] := ARRAY[
    'perfis','bars','produtos','compras','compras_itens','fornecedores','fornecedor_precos','caixa_movimentos',
    'pedidos','pedidos_itens','vendas','vendas_itens','faturas','fatura_pagamentos','ryoshusho',
    'estoque_movimentos','estoque_regras','notificacoes','bar_pricing','drink_menu','drink_recipes',
    'drink_recipe_itens','mesas','tabs','cast_members','cast_comissoes','hourly_revenue','pedido_itens'];
BEGIN
  FOREACH t IN ARRAY tabelas LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- perfis: cada um lê a própria linha; HQ lê todas; o bar lê as do próprio bar; os admins são visíveis
-- (o bar precisa do id deles para mandar aviso). Só admin cria, apaga, troca papel ou bar.
CREATE POLICY perfis_read ON public.perfis FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.jbm_is_hq() OR role = 'admin'
         OR (bar_id IS NOT NULL AND bar_id = public.jbm_my_bar()));
CREATE POLICY perfis_insert ON public.perfis FOR INSERT TO authenticated WITH CHECK (public.jbm_is_admin());
CREATE POLICY perfis_update ON public.perfis FOR UPDATE TO authenticated
  USING (public.jbm_is_admin() OR id = auth.uid()) WITH CHECK (public.jbm_is_admin() OR id = auth.uid());
CREATE POLICY perfis_delete ON public.perfis FOR DELETE TO authenticated USING (public.jbm_is_admin());

CREATE OR REPLACE FUNCTION public.perfis_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Servidor (service key, sem auth.uid) e admin não têm limite.
  IF auth.uid() IS NULL OR public.jbm_is_admin() THEN RETURN NEW; END IF;
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.bar_id IS DISTINCT FROM OLD.bar_id OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Only an admin can change a role or a bar';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS perfis_guard ON public.perfis;
CREATE TRIGGER perfis_guard BEFORE UPDATE ON public.perfis FOR EACH ROW EXECUTE FUNCTION public.perfis_guard();

-- bars: HQ tudo; o bar lê o próprio; dono/gerente edita o próprio (nome, cor).
CREATE POLICY bars_read ON public.bars FOR SELECT TO authenticated USING (public.jbm_bar_or_hq(id));
CREATE POLICY bars_insert ON public.bars FOR INSERT TO authenticated WITH CHECK (public.jbm_is_hq());
CREATE POLICY bars_update ON public.bars FOR UPDATE TO authenticated
  USING (public.jbm_bar_boss_or_hq(id)) WITH CHECK (public.jbm_bar_boss_or_hq(id));
CREATE POLICY bars_delete ON public.bars FOR DELETE TO authenticated USING (public.jbm_is_admin());

-- produtos (catálogo da JBM): qualquer login com perfil lê; só o HQ escreve.
CREATE POLICY produtos_read ON public.produtos FOR SELECT TO authenticated USING (public.jbm_role() IS NOT NULL);
CREATE POLICY produtos_write ON public.produtos FOR ALL TO authenticated
  USING (public.jbm_is_hq()) WITH CHECK (public.jbm_is_hq());

-- Só do HQ: compras da JBM, fornecedores e preços de fornecedor (o bar nunca vê).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['compras','compras_itens','fornecedores','fornecedor_precos'] LOOP
    EXECUTE format('CREATE POLICY hq_only ON public.%I FOR ALL TO authenticated USING (public.jbm_is_hq()) WITH CHECK (public.jbm_is_hq())', t);
  END LOOP;
END $$;

-- caixa_movimentos (antigo, sem coluna de bar, vazio): só HQ.
CREATE POLICY hq_only ON public.caixa_movimentos FOR ALL TO authenticated
  USING (public.jbm_is_hq()) WITH CHECK (public.jbm_is_hq());

-- pedidos de reposição: HQ tudo; o bar vê, cria e ajusta os do próprio bar; apagar só HQ ou dono/gerente.
CREATE POLICY pedidos_read ON public.pedidos FOR SELECT TO authenticated USING (public.jbm_bar_or_hq(bar_id));
CREATE POLICY pedidos_insert ON public.pedidos FOR INSERT TO authenticated WITH CHECK (public.jbm_bar_or_hq(bar_id));
CREATE POLICY pedidos_update ON public.pedidos FOR UPDATE TO authenticated
  USING (public.jbm_bar_or_hq(bar_id)) WITH CHECK (public.jbm_bar_or_hq(bar_id));
CREATE POLICY pedidos_delete ON public.pedidos FOR DELETE TO authenticated USING (public.jbm_bar_boss_or_hq(bar_id));

CREATE POLICY pedidos_itens_all ON public.pedidos_itens FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = pedido_id AND public.jbm_bar_or_hq(p.bar_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = pedido_id AND public.jbm_bar_or_hq(p.bar_id)));

-- vendas (entregas da JBM ao bar): HQ escreve; o bar só lê as próprias.
CREATE POLICY vendas_read ON public.vendas FOR SELECT TO authenticated USING (public.jbm_bar_or_hq(bar_id));
CREATE POLICY vendas_write ON public.vendas FOR ALL TO authenticated
  USING (public.jbm_is_hq()) WITH CHECK (public.jbm_is_hq());
CREATE POLICY vendas_itens_read ON public.vendas_itens FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.vendas v WHERE v.id = venda_id AND public.jbm_bar_or_hq(v.bar_id)));
CREATE POLICY vendas_itens_write ON public.vendas_itens FOR ALL TO authenticated
  USING (public.jbm_is_hq()) WITH CHECK (public.jbm_is_hq());

-- faturas e recibos: leitura por "dinheiro"; escrita só do HQ de dinheiro; apagar só admin.
CREATE POLICY faturas_read ON public.faturas FOR SELECT TO authenticated USING (public.jbm_can_see_bar_money(bar_id));
CREATE POLICY faturas_insert ON public.faturas FOR INSERT TO authenticated WITH CHECK (public.jbm_is_money_hq());
CREATE POLICY faturas_update ON public.faturas FOR UPDATE TO authenticated
  USING (public.jbm_is_money_hq()) WITH CHECK (public.jbm_is_money_hq());
CREATE POLICY faturas_delete ON public.faturas FOR DELETE TO authenticated USING (public.jbm_is_admin());

CREATE POLICY ryoshusho_read ON public.ryoshusho FOR SELECT TO authenticated USING (public.jbm_can_see_bar_money(bar_id));
CREATE POLICY ryoshusho_insert ON public.ryoshusho FOR INSERT TO authenticated WITH CHECK (public.jbm_is_money_hq());
CREATE POLICY ryoshusho_update ON public.ryoshusho FOR UPDATE TO authenticated
  USING (public.jbm_is_money_hq()) WITH CHECK (public.jbm_is_money_hq());
CREATE POLICY ryoshusho_delete ON public.ryoshusho FOR DELETE TO authenticated USING (public.jbm_is_admin());

-- pagamentos de fatura: o bar (dono/gerente) pode AVISAR que pagou (confirmado = false, assinado por ele);
-- confirmar, editar e apagar é só do HQ. Crédito pendente nunca vira recebido pelas mãos do bar.
CREATE POLICY fatura_pagamentos_read ON public.fatura_pagamentos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.faturas f WHERE f.id = fatura_id AND public.jbm_can_see_bar_money(f.bar_id)));
CREATE POLICY fatura_pagamentos_insert ON public.fatura_pagamentos FOR INSERT TO authenticated
  WITH CHECK (
    public.jbm_is_money_hq()
    OR (confirmado IS NOT TRUE AND confirmado_em IS NULL
        AND EXISTS (SELECT 1 FROM public.faturas f WHERE f.id = fatura_id AND public.jbm_can_see_bar_money(f.bar_id)))
  );
CREATE POLICY fatura_pagamentos_update ON public.fatura_pagamentos FOR UPDATE TO authenticated
  USING (public.jbm_is_money_hq()) WITH CHECK (public.jbm_is_money_hq());
CREATE POLICY fatura_pagamentos_delete ON public.fatura_pagamentos FOR DELETE TO authenticated USING (public.jbm_is_admin());

-- estoque do bar: HQ tudo; o bar lê e lança no próprio; corrigir/apagar só HQ ou dono/gerente.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['estoque_movimentos','estoque_regras'] LOOP
    EXECUTE format('CREATE POLICY bar_read ON public.%I FOR SELECT TO authenticated USING (public.jbm_bar_or_hq(bar_id))', t);
    EXECUTE format('CREATE POLICY bar_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.jbm_bar_or_hq(bar_id))', t);
    EXECUTE format('CREATE POLICY bar_update ON public.%I FOR UPDATE TO authenticated USING (public.jbm_bar_boss_or_hq(bar_id)) WITH CHECK (public.jbm_bar_boss_or_hq(bar_id))', t);
    EXECUTE format('CREATE POLICY bar_delete ON public.%I FOR DELETE TO authenticated USING (public.jbm_bar_boss_or_hq(bar_id))', t);
  END LOOP;
END $$;
-- estoque_regras é gravado com upsert pelo caixa (mínimo por produto): o update do próprio bar fica liberado.
DROP POLICY bar_update ON public.estoque_regras;
CREATE POLICY bar_update ON public.estoque_regras FOR UPDATE TO authenticated
  USING (public.jbm_bar_or_hq(bar_id)) WITH CHECK (public.jbm_bar_or_hq(bar_id));

-- avisos: cada um lê/fecha os seus; admin lê todos; qualquer login com perfil pode mandar um aviso.
CREATE POLICY notificacoes_read ON public.notificacoes FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.jbm_is_admin());
CREATE POLICY notificacoes_insert ON public.notificacoes FOR INSERT TO authenticated
  WITH CHECK (public.jbm_role() IS NOT NULL);
CREATE POLICY notificacoes_update ON public.notificacoes FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.jbm_is_admin()) WITH CHECK (user_id = auth.uid() OR public.jbm_is_admin());
CREATE POLICY notificacoes_delete ON public.notificacoes FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.jbm_is_admin());

-- cardápio e preços do bar, e tabelas antigas com coluna de bar: HQ ou o próprio bar.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bar_pricing','drink_menu','drink_recipes','mesas','tabs','cast_members','hourly_revenue'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('CREATE POLICY bar_scope ON public.%I FOR ALL TO authenticated USING (public.jbm_bar_or_hq(bar_id)) WITH CHECK (public.jbm_bar_or_hq(bar_id))', t);
  END LOOP;
END $$;

CREATE POLICY bar_scope ON public.drink_recipe_itens FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.drink_recipes r WHERE r.id = recipe_id AND public.jbm_bar_or_hq(r.bar_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.drink_recipes r WHERE r.id = recipe_id AND public.jbm_bar_or_hq(r.bar_id)));
CREATE POLICY bar_scope ON public.cast_comissoes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cast_members m WHERE m.id = cast_id AND public.jbm_bar_or_hq(m.bar_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cast_members m WHERE m.id = cast_id AND public.jbm_bar_or_hq(m.bar_id)));
CREATE POLICY bar_scope ON public.pedido_itens FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = pedido_id AND public.jbm_bar_or_hq(p.bar_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.pedidos p WHERE p.id = pedido_id AND public.jbm_bar_or_hq(p.bar_id)));

-- 2b) Vendas do caixa: logins de caixa e equipe registram vendas, mas não mudam dinheiro, não estornam e não
--     apagam (só a própria venda dos últimos 10 minutos). Dono/gerente e o servidor não têm limite.
--    The server (service key) and the owner/manager are not limited. Same rule as api/_posSaleStamp.js.
CREATE OR REPLACE FUNCTION public.pos_sale_front_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_sale public.pos_vendas%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  SELECT role INTO v_role FROM public.perfis WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('caixa', 'bar_staff') THEN RETURN COALESCE(NEW, OLD); END IF;

  IF TG_TABLE_NAME = 'pos_vendas' THEN
    IF TG_OP = 'INSERT' THEN
      IF COALESCE(NEW.total, 0) < 0 THEN RAISE EXCEPTION 'Only the owner or a manager can void a sale'; END IF;
      RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
      IF (NEW.total, NEW.subtotal, NEW.desconto_total, NEW.metodo_pagamento, NEW.refunded, NEW.card_fee,
          NEW.card_fee_reversed, NEW.comissao_valor, NEW.data, NEW.bar_id, NEW.obs, NEW.criado_por, NEW.drink_back_agent_id)
         IS DISTINCT FROM
         (OLD.total, OLD.subtotal, OLD.desconto_total, OLD.metodo_pagamento, OLD.refunded, OLD.card_fee,
          OLD.card_fee_reversed, OLD.comissao_valor, OLD.data, OLD.bar_id, OLD.obs, OLD.criado_por, OLD.drink_back_agent_id) THEN
        RAISE EXCEPTION 'Only the owner or a manager can change a sale';
      END IF;
      RETURN NEW;
    ELSE
      IF OLD.criado_por IS DISTINCT FROM auth.uid() OR OLD.criado_em < now() - interval '10 minutes' THEN
        RAISE EXCEPTION 'Only the owner or a manager can delete a sale';
      END IF;
      RETURN OLD;
    END IF;
  END IF;

  -- pos_vendas_itens: no edits; delete only with the parent sale rule above.
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Only the owner or a manager can change a sale'; END IF;
  IF TG_OP = 'DELETE' THEN
    SELECT * INTO v_sale FROM public.pos_vendas WHERE id = OLD.pos_venda_id;
    IF FOUND AND (v_sale.criado_por IS DISTINCT FROM auth.uid() OR v_sale.criado_em < now() - interval '10 minutes') THEN
      RAISE EXCEPTION 'Only the owner or a manager can delete a sale';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.pos_vendas') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS pos_vendas_front_guard ON public.pos_vendas;
    CREATE TRIGGER pos_vendas_front_guard BEFORE INSERT OR UPDATE OR DELETE ON public.pos_vendas
      FOR EACH ROW EXECUTE FUNCTION public.pos_sale_front_guard();
  END IF;
  IF to_regclass('public.pos_vendas_itens') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS pos_vendas_itens_front_guard ON public.pos_vendas_itens;
    CREATE TRIGGER pos_vendas_itens_front_guard BEFORE UPDATE OR DELETE ON public.pos_vendas_itens
      FOR EACH ROW EXECUTE FUNCTION public.pos_sale_front_guard();
  END IF;
END $$;

-- 3) O público (anon, sem login) perde toda permissão direta em tabelas, views e funções.
--    O app só fala com o banco depois do login; o servidor usa a service key e não é afetado.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;

-- deduct_stock(produto, qtd) antigo: SECURITY DEFINER sem checar bar e sem uso no código. Fica no banco,
-- mas ninguém além do servidor executa.
DO $$
BEGIN
  IF to_regprocedure('public.deduct_stock(uuid, integer)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.deduct_stock(uuid, integer) FROM authenticated;
  END IF;
END $$;

-- A view do catálogo sem custo continua lida por quem tem login.
GRANT SELECT ON public.produtos_public TO authenticated;

-- Rollback (volta ao estado de 2026-11-18; não recomendado):
--   para cada tabela do passo 2: DROP POLICY das políticas acima;
--   CREATE POLICY read ON <t> FOR SELECT USING (auth.role() = 'authenticated');
--   CREATE POLICY write ON <t> FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
--   DROP TRIGGER perfis_guard ON public.perfis; DROP TRIGGER pos_vendas_front_guard ON public.pos_vendas;
--   DROP TRIGGER pos_vendas_itens_front_guard ON public.pos_vendas_itens;
--   GRANT ALL ON ALL TABLES IN SCHEMA public TO anon; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
