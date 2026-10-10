-- AI Center: conversation history per user. Optional: without it the app keeps history on the device.
-- Project ojirgkqtqvugqktyuhem. Not applied by the app. Additive and idempotent.
-- Pair with sql/ai_action_log.sql (actions confirmed from AI proposals).

CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  bar_id uuid,
  module text NOT NULL DEFAULT 'overview',
  titulo text NOT NULL DEFAULT '',
  mensagens jsonb NOT NULL DEFAULT '[]'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_conversations_user_idx ON public.ai_conversations (user_id, atualizado_em DESC);

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
-- Private to the person who had the conversation.
DROP POLICY IF EXISTS ai_conversations_own ON public.ai_conversations;
CREATE POLICY ai_conversations_own ON public.ai_conversations
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Rollback: DROP TABLE IF EXISTS public.ai_conversations;
