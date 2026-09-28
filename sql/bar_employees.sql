-- Bar employee directory and access lifecycle.
-- Run in the Supabase SQL editor AFTER sql/payroll.sql
-- (needs perfis, user_can_access_bar, is_procurement_hq, audit_logs).
-- Does not create a second user catalog. Employees are perfis rows.
-- Does not store passwords. Does not DROP perfis, bars, or sales history.
-- Do not run this against ojirgkqtqvugqktyuhem or fxsakrshmldmkdmbevna
-- until you intend to change that database.

CREATE TABLE IF NOT EXISTS public.bar_employees (
  id uuid PRIMARY KEY REFERENCES public.perfis(id) ON DELETE RESTRICT,
  bar_id uuid NOT NULL,
  job_role text NOT NULL,
  permission_role text NOT NULL,
  phone text,
  employee_code text,
  status text NOT NULL DEFAULT 'invited',
  start_date date,
  notes text,
  invited_at timestamptz,
  activated_at timestamptz,
  suspended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bar_employees_status_chk CHECK (status IN ('invited', 'active', 'suspended', 'inactive')),
  CONSTRAINT bar_employees_permission_chk CHECK (permission_role IN ('gerente', 'caixa', 'bar_staff')),
  CONSTRAINT bar_employees_job_chk CHECK (job_role IN ('manager', 'cashier', 'bartender', 'hostess', 'staff', 'cleaner'))
);

CREATE INDEX IF NOT EXISTS bar_employees_bar_idx ON public.bar_employees (bar_id, status);

CREATE OR REPLACE FUNCTION public.bar_employees_match_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  perfil_bar uuid;
  perfil_role text;
BEGIN
  SELECT p.bar_id, p.role INTO perfil_bar, perfil_role
  FROM public.perfis p
  WHERE p.id = NEW.id;
  IF perfil_bar IS NULL OR perfil_bar <> NEW.bar_id THEN
    RAISE EXCEPTION 'employee bar does not match profile';
  END IF;
  IF perfil_role NOT IN ('cliente', 'gerente', 'caixa', 'bar_staff') THEN
    RAISE EXCEPTION 'profile is not a bar login';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bar_employees_match_profile ON public.bar_employees;
CREATE TRIGGER bar_employees_match_profile
  BEFORE INSERT OR UPDATE ON public.bar_employees
  FOR EACH ROW EXECUTE FUNCTION public.bar_employees_match_profile();

-- Final user_can_access_bar. Same roles as sql/pos_sale_security.sql.
-- A suspended, inactive, or not-yet-accepted employee cannot use the bar.
-- Rows with no bar_employees record stay active (existing logins).
CREATE OR REPLACE FUNCTION public.user_can_access_bar(target_bar uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT target_bar IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.perfis p
      WHERE p.id = auth.uid()
        AND (
          p.role = 'admin'
          OR (
            p.bar_id = target_bar
            AND p.role IN ('cliente', 'gerente', 'caixa', 'bar_staff')
            AND NOT EXISTS (
              SELECT 1
              FROM public.bar_employees e
              WHERE e.id = p.id
                AND e.status IN ('suspended', 'inactive', 'invited')
            )
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.user_can_access_bar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_access_bar(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.user_can_manage_bar_staff(target_bar uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT target_bar IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.perfis p
      WHERE p.id = auth.uid()
        AND p.bar_id = target_bar
        AND p.role IN ('cliente', 'gerente')
        AND NOT EXISTS (
          SELECT 1
          FROM public.bar_employees e
          WHERE e.id = p.id
            AND e.status IN ('suspended', 'inactive', 'invited')
        )
    );
$$;

REVOKE ALL ON FUNCTION public.user_can_manage_bar_staff(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_can_manage_bar_staff(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.bar_permission_for_job(p_job text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(btrim(COALESCE(p_job, '')))
    WHEN 'manager' THEN 'gerente'
    WHEN 'cashier' THEN 'caixa'
    WHEN 'bartender' THEN 'bar_staff'
    WHEN 'hostess' THEN 'bar_staff'
    WHEN 'staff' THEN 'bar_staff'
    WHEN 'cleaner' THEN 'bar_staff'
    ELSE NULL
  END;
$$;

REVOKE ALL ON FUNCTION public.bar_permission_for_job(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bar_permission_for_job(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.bar_accept_invitation()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.bar_employees%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO row FROM public.bar_employees WHERE id = auth.uid();
  IF row.id IS NULL OR row.status <> 'invited' THEN
    RETURN;
  END IF;
  UPDATE public.bar_employees
  SET status = 'active', activated_at = now(), updated_at = now()
  WHERE id = auth.uid();
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'invitation_accepted', 'bar_employees', auth.uid(),
    jsonb_build_object('bar_id', row.bar_id));
END;
$$;

REVOKE ALL ON FUNCTION public.bar_accept_invitation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bar_accept_invitation() TO authenticated;

CREATE OR REPLACE FUNCTION public.bar_set_employee_access(
  p_employee uuid,
  p_status text,
  p_job_role text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  emp public.bar_employees%ROWTYPE;
  actor_role text;
  actor_bar uuid;
  target_role text;
  next_perm text;
  action text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_status NOT IN ('active', 'suspended', 'inactive') THEN
    RAISE EXCEPTION 'status not allowed';
  END IF;
  SELECT * INTO emp FROM public.bar_employees WHERE id = p_employee;
  IF emp.id IS NULL THEN
    RAISE EXCEPTION 'employee not found';
  END IF;
  SELECT p.role, p.bar_id INTO actor_role, actor_bar
  FROM public.perfis p WHERE p.id = auth.uid();
  SELECT p.role INTO target_role FROM public.perfis p WHERE p.id = p_employee;

  IF NOT (
    public.is_procurement_hq()
    OR (
      actor_role IN ('cliente', 'gerente')
      AND actor_bar = emp.bar_id
      AND public.user_can_manage_bar_staff(emp.bar_id)
    )
  ) THEN
    RAISE EXCEPTION 'bar not allowed';
  END IF;
  IF NOT public.is_procurement_hq() AND target_role = 'cliente' THEN
    RAISE EXCEPTION 'cannot edit the bar owner';
  END IF;

  next_perm := emp.permission_role;
  IF p_job_role IS NOT NULL AND btrim(p_job_role) <> '' THEN
    next_perm := public.bar_permission_for_job(p_job_role);
    IF next_perm IS NULL THEN
      RAISE EXCEPTION 'unknown role';
    END IF;
    IF next_perm IS DISTINCT FROM emp.permission_role OR lower(btrim(p_job_role)) IS DISTINCT FROM emp.job_role THEN
      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
      VALUES (auth.uid(), 'role_changed', 'bar_employees', emp.id,
        jsonb_build_object('bar_id', emp.bar_id, 'from', emp.job_role, 'to', lower(btrim(p_job_role))));
    END IF;
    UPDATE public.bar_employees
    SET job_role = lower(btrim(p_job_role)), permission_role = next_perm, updated_at = now()
    WHERE id = emp.id;
    IF target_role IS DISTINCT FROM 'cliente' THEN
      UPDATE public.perfis SET role = next_perm WHERE id = emp.id AND bar_id = emp.bar_id;
    END IF;
  END IF;

  IF p_status IS DISTINCT FROM emp.status THEN
    action := CASE p_status
      WHEN 'suspended' THEN 'employee_suspended'
      WHEN 'inactive' THEN 'employee_removed'
      WHEN 'active' THEN 'employee_reactivated'
      ELSE 'account_access_changed'
    END;
    UPDATE public.bar_employees
    SET status = p_status,
        suspended_at = CASE WHEN p_status = 'suspended' THEN now() ELSE suspended_at END,
        activated_at = CASE WHEN p_status = 'active' AND activated_at IS NULL THEN now() ELSE activated_at END,
        updated_at = now()
    WHERE id = emp.id;
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    VALUES (auth.uid(), action, 'bar_employees', emp.id,
      jsonb_build_object('bar_id', emp.bar_id, 'from', emp.status, 'to', p_status));
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.bar_set_employee_access(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bar_set_employee_access(uuid, text, text) TO authenticated;

-- Login screen. Returns nothing, so it does not reveal whether the email exists.
CREATE OR REPLACE FUNCTION public.bar_note_password_recovery(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
BEGIN
  SELECT p.id INTO uid
  FROM public.perfis p
  WHERE lower(p.email) = lower(btrim(COALESCE(p_email, '')))
  LIMIT 1;
  IF uid IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (uid, 'password_recovery_requested', 'perfis', uid, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.bar_note_password_recovery(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bar_note_password_recovery(text) TO anon, authenticated;

ALTER TABLE public.bar_employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bar_employees_read ON public.bar_employees;
CREATE POLICY bar_employees_read ON public.bar_employees
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.user_can_access_bar(bar_id)
    OR public.is_procurement_hq()
  );

DROP POLICY IF EXISTS bar_employees_insert ON public.bar_employees;
CREATE POLICY bar_employees_insert ON public.bar_employees
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_manage_bar_staff(bar_id));

DROP POLICY IF EXISTS bar_employees_update ON public.bar_employees;
CREATE POLICY bar_employees_update ON public.bar_employees
  FOR UPDATE TO authenticated
  USING (public.user_can_manage_bar_staff(bar_id) OR public.is_procurement_hq())
  WITH CHECK (public.user_can_manage_bar_staff(bar_id) OR public.is_procurement_hq());

REVOKE ALL ON public.bar_employees FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.bar_employees TO authenticated;
