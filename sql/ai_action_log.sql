-- AI actions audit log (optional but recommended).
-- Every action the AI writes after the user presses Confirm gets one row here.
-- The unique key also stops the same confirmation from being written twice.
-- Run once in Supabase → SQL Editor for project ojirgkqtqvugqktyuhem.

CREATE TABLE IF NOT EXISTS public.ai_action_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  role text,
  bar_id uuid,
  action text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'running',
  result jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_action_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_action_log_own_insert ON public.ai_action_log;
CREATE POLICY ai_action_log_own_insert ON public.ai_action_log
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS ai_action_log_own_update ON public.ai_action_log;
CREATE POLICY ai_action_log_own_update ON public.ai_action_log
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS ai_action_log_read ON public.ai_action_log;
CREATE POLICY ai_action_log_read ON public.ai_action_log
  FOR SELECT TO authenticated USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.perfis p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

CREATE INDEX IF NOT EXISTS ai_action_log_user_idx ON public.ai_action_log (user_id, criado_em DESC);
