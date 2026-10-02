-- Proposed canonical identity. Production column types were not read from a live database.
-- Columns below are the ones this repository already selects or writes, plus the
-- membership tables required so a role name is not itself a tenant grant.

CREATE TABLE IF NOT EXISTS public.bars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  cor text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.perfis (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  nome text,
  role text NOT NULL CHECK (role IN (
    'admin', 'jbm', 'gerente', 'caixa', 'bar_staff', 'funcionario', 'fornecedor', 'cliente', 'staff'
  )),
  bar_id uuid REFERENCES public.bars(id) ON DELETE SET NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bar_memberships (
  user_id uuid NOT NULL REFERENCES public.perfis(id) ON DELETE CASCADE,
  bar_id uuid NOT NULL REFERENCES public.bars(id) ON DELETE CASCADE,
  role text NOT NULL,
  granted_by uuid,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (user_id, bar_id)
);

CREATE TABLE IF NOT EXISTS public.platform_access (
  user_id uuid PRIMARY KEY REFERENCES public.perfis(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('hq')),
  granted_by uuid,
  reason text,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.platform_access_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  bar_id uuid,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bar_memberships_bar_idx ON public.bar_memberships (bar_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS perfis_bar_idx ON public.perfis (bar_id);

COMMENT ON TABLE public.bar_memberships IS
  'Explicit bar grant. Role jbm does not imply a row here.';
COMMENT ON TABLE public.platform_access IS
  'Explicit HQ grant. Required before is_jbm() returns true. See sql/foundation/090_security.sql.';
