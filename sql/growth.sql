-- JBMTech growth modules: marketing campaigns and consulting plans/tasks.
-- Project ojirgkqtqvugqktyuhem. Not applied by the app. Additive and idempotent. Needs sql/floor_comandas.sql
-- (for jbm_can_access_bar / jbm_can_manage_bar).
-- HQ (admin/jbm) sees all bars; a bar owner/manager sees only rows of their bar; rows with bar_id NULL are HQ-wide.

CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid REFERENCES public.bars(id),
  nome text NOT NULL,
  canal text NOT NULL DEFAULT 'in_store',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'running', 'done', 'cancelled')),
  inicio date,
  fim date,
  produtos text,
  oferta text,
  objetivo text,
  orcamento numeric CHECK (orcamento IS NULL OR orcamento >= 0),
  resultado_notas text,
  criado_por uuid DEFAULT auth.uid(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (fim IS NULL OR inicio IS NULL OR fim >= inicio)
);

CREATE TABLE IF NOT EXISTS public.consulting_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  titulo text NOT NULL,
  diagnostico text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'paused')),
  baseline jsonb NOT NULL DEFAULT '{}'::jsonb,
  baseline_em date NOT NULL DEFAULT current_date,
  criado_por uuid DEFAULT auth.uid(),
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.consulting_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.consulting_plans(id) ON DELETE CASCADE,
  bar_id uuid NOT NULL REFERENCES public.bars(id),
  titulo text NOT NULL,
  responsavel text,
  prazo date,
  prioridade text NOT NULL DEFAULT 'medium' CHECK (prioridade IN ('high', 'medium', 'low')),
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  kpi text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  concluida_em timestamptz
);

ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consulting_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consulting_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS marketing_campaigns_read ON public.marketing_campaigns;
CREATE POLICY marketing_campaigns_read ON public.marketing_campaigns FOR SELECT TO authenticated
  USING (CASE WHEN bar_id IS NULL THEN EXISTS (SELECT 1 FROM public.perfis p WHERE p.id = auth.uid() AND p.role IN ('admin', 'jbm'))
              ELSE public.jbm_can_manage_bar(bar_id) END);
DROP POLICY IF EXISTS marketing_campaigns_write ON public.marketing_campaigns;
CREATE POLICY marketing_campaigns_write ON public.marketing_campaigns FOR ALL TO authenticated
  USING (CASE WHEN bar_id IS NULL THEN EXISTS (SELECT 1 FROM public.perfis p WHERE p.id = auth.uid() AND p.role IN ('admin', 'jbm'))
              ELSE public.jbm_can_manage_bar(bar_id) END)
  WITH CHECK (CASE WHEN bar_id IS NULL THEN EXISTS (SELECT 1 FROM public.perfis p WHERE p.id = auth.uid() AND p.role IN ('admin', 'jbm'))
              ELSE public.jbm_can_manage_bar(bar_id) END);

-- Consulting is run by JBM; the bar owner can read their own plan and update task status.
DROP POLICY IF EXISTS consulting_plans_read ON public.consulting_plans;
CREATE POLICY consulting_plans_read ON public.consulting_plans FOR SELECT TO authenticated USING (public.jbm_can_manage_bar(bar_id));
DROP POLICY IF EXISTS consulting_plans_write ON public.consulting_plans;
CREATE POLICY consulting_plans_write ON public.consulting_plans FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.perfis p WHERE p.id = auth.uid() AND p.role IN ('admin', 'jbm')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.perfis p WHERE p.id = auth.uid() AND p.role IN ('admin', 'jbm')));
DROP POLICY IF EXISTS consulting_tasks_read ON public.consulting_tasks;
CREATE POLICY consulting_tasks_read ON public.consulting_tasks FOR SELECT TO authenticated USING (public.jbm_can_manage_bar(bar_id));
DROP POLICY IF EXISTS consulting_tasks_write ON public.consulting_tasks;
CREATE POLICY consulting_tasks_write ON public.consulting_tasks FOR ALL TO authenticated
  USING (public.jbm_can_manage_bar(bar_id)) WITH CHECK (public.jbm_can_manage_bar(bar_id));

-- Rollback: DROP TABLE IF EXISTS public.consulting_tasks, public.consulting_plans, public.marketing_campaigns;
