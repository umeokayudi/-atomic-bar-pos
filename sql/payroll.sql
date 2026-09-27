-- Operational payroll ledger.
-- Does not change procurement, time_clock writes, or the employee registry (perfis).
-- Hours stay in time_clock. This file only reads that table from payroll_my_pack.
-- Tax, social insurance, vacation and 13th salary are not calculated here.
-- Apply manually in the Supabase SQL editor. This repository does not apply it.

CREATE TABLE IF NOT EXISTS public.payroll_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid,
  pay_hourly boolean NOT NULL DEFAULT false,
  pay_overtime boolean NOT NULL DEFAULT false,
  overtime_multiplier numeric,
  night_premium_rate numeric,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competence text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'calculated', 'approved', 'paid', 'cancelled')),
  opened_by uuid,
  approved_by uuid,
  paid_at date,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  bar_id uuid,
  payroll_period_id uuid NOT NULL REFERENCES public.payroll_periods(id),
  type text NOT NULL
    CHECK (type IN (
      'base_salary', 'regular_hours', 'overtime', 'night_premium',
      'commission', 'bonus', 'reward', 'advance', 'deduction', 'adjustment'
    )),
  description text NOT NULL DEFAULT '',
  quantity numeric,
  unit_value numeric,
  amount integer NOT NULL,
  source text,
  source_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payroll_lines_source_uidx
  ON public.payroll_lines (payroll_period_id, employee_id, type, source, source_id)
  WHERE source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.payroll_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_period_id uuid,
  employee_id uuid,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_shift_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  bar_id uuid,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  bar_id uuid,
  note text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  bar_id uuid,
  points integer NOT NULL,
  reason text NOT NULL,
  source text,
  source_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_goal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  bar_id uuid,
  competence text NOT NULL,
  title text NOT NULL,
  target numeric,
  actual numeric,
  source text,
  source_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  bar_id uuid,
  competence text NOT NULL,
  title text NOT NULL,
  amount integer NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'posted', 'cancelled')),
  source text,
  source_id text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  bar_id uuid,
  competence text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'paid', 'cancelled')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payroll_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL,
  bar_id uuid,
  competence text,
  reason text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  reference text,
  approved_by uuid,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'posted', 'rejected', 'cancelled')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_payroll_hq()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.perfis p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'jbm')
  );
$$;

REVOKE ALL ON FUNCTION public.is_payroll_hq() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_payroll_hq() TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_require_hq()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL OR NOT public.is_payroll_hq() THEN
    RAISE EXCEPTION 'payroll hq only';
  END IF;
  RETURN actor;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_require_hq() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_require_hq() TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_audit(
  p_action text,
  p_period uuid,
  p_employee uuid,
  p_detail jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.payroll_audit (payroll_period_id, employee_id, action, detail, actor_id)
  VALUES (p_period, p_employee, p_action, COALESCE(p_detail, '{}'::jsonb), auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_audit(text, uuid, uuid, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.payroll_open_period(p_competence text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  period_id uuid;
BEGIN
  actor := public.payroll_require_hq();
  IF p_competence IS NULL OR p_competence !~ '^[0-9]{4}-[0-9]{2}$' THEN
    RAISE EXCEPTION 'competence must be YYYY-MM';
  END IF;
  SELECT id INTO period_id FROM public.payroll_periods WHERE competence = p_competence;
  IF period_id IS NOT NULL THEN
    RETURN period_id;
  END IF;
  INSERT INTO public.payroll_periods (competence, status, opened_by)
  VALUES (p_competence, 'draft', actor)
  RETURNING id INTO period_id;
  PERFORM public.payroll_audit('open', period_id, NULL, jsonb_build_object('competence', p_competence));
  RETURN period_id;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_open_period(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_open_period(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_post_lines(p_period uuid, p_lines jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  period public.payroll_periods;
  item jsonb;
  inserted integer := 0;
  kind text;
BEGIN
  actor := public.payroll_require_hq();
  SELECT * INTO period FROM public.payroll_periods WHERE id = p_period;
  IF period.id IS NULL THEN
    RAISE EXCEPTION 'period not found';
  END IF;
  IF period.status IN ('approved', 'paid', 'cancelled') THEN
    RAISE EXCEPTION 'period is locked';
  END IF;
  IF jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'lines must be an array';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_lines) AS t(value)
  LOOP
    kind := item->>'type';
    IF kind NOT IN (
      'base_salary', 'regular_hours', 'overtime', 'night_premium',
      'commission', 'bonus', 'reward', 'advance', 'deduction', 'adjustment'
    ) THEN
      RAISE EXCEPTION 'unknown payroll type';
    END IF;
    IF item->>'employee_id' IS NULL OR item->>'amount' IS NULL THEN
      RAISE EXCEPTION 'employee_id and amount are required';
    END IF;
    INSERT INTO public.payroll_lines (
      employee_id, bar_id, payroll_period_id, type, description,
      quantity, unit_value, amount, source, source_id, created_by
    ) VALUES (
      (item->>'employee_id')::uuid,
      NULLIF(item->>'bar_id', '')::uuid,
      p_period,
      kind,
      COALESCE(item->>'description', ''),
      NULLIF(item->>'quantity', '')::numeric,
      NULLIF(item->>'unit_value', '')::numeric,
      (item->>'amount')::integer,
      NULLIF(item->>'source', ''),
      NULLIF(item->>'source_id', ''),
      actor
    );
    inserted := inserted + 1;
    PERFORM public.payroll_audit('calculate', p_period, (item->>'employee_id')::uuid, item);
  END LOOP;
  UPDATE public.payroll_periods
    SET status = 'calculated'
    WHERE id = p_period AND status = 'draft';
  RETURN inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_post_lines(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_post_lines(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_adjust(
  p_period uuid,
  p_employee uuid,
  p_bar uuid,
  p_amount integer,
  p_description text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  period public.payroll_periods;
  line_id uuid;
BEGIN
  actor := public.payroll_require_hq();
  SELECT * INTO period FROM public.payroll_periods WHERE id = p_period;
  IF period.id IS NULL OR period.status = 'cancelled' THEN
    RAISE EXCEPTION 'period cannot be adjusted';
  END IF;
  INSERT INTO public.payroll_lines (
    employee_id, bar_id, payroll_period_id, type, description, amount, source, created_by
  ) VALUES (
    p_employee, p_bar, p_period, 'adjustment', COALESCE(p_description, 'Adjustment'), p_amount, 'adjustment', actor
  ) RETURNING id INTO line_id;
  PERFORM public.payroll_audit(
    'adjustment', p_period, p_employee,
    jsonb_build_object('amount', p_amount, 'description', p_description, 'line_id', line_id, 'status', period.status)
  );
  RETURN line_id;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_adjust(uuid, uuid, uuid, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_adjust(uuid, uuid, uuid, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_transition(p_period uuid, p_status text, p_paid_on date DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  period public.payroll_periods;
BEGIN
  actor := public.payroll_require_hq();
  SELECT * INTO period FROM public.payroll_periods WHERE id = p_period FOR UPDATE;
  IF period.id IS NULL THEN
    RAISE EXCEPTION 'period not found';
  END IF;
  IF NOT (
    (period.status = 'draft' AND p_status IN ('calculated', 'cancelled'))
    OR (period.status = 'calculated' AND p_status IN ('approved', 'cancelled'))
    OR (period.status = 'approved' AND p_status = 'paid')
  ) THEN
    RAISE EXCEPTION 'cannot move payroll from % to %', period.status, p_status;
  END IF;
  UPDATE public.payroll_periods
    SET status = p_status,
        approved_by = CASE WHEN p_status = 'approved' THEN actor ELSE approved_by END,
        paid_at = CASE WHEN p_status = 'paid' THEN COALESCE(p_paid_on, CURRENT_DATE) ELSE paid_at END,
        closed_at = CASE WHEN p_status IN ('approved', 'paid', 'cancelled') THEN now() ELSE closed_at END
    WHERE id = p_period;
  PERFORM public.payroll_audit(p_status, p_period, NULL, jsonb_build_object('from', period.status, 'paid_on', p_paid_on));
  RETURN p_status;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_transition(uuid, text, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_transition(uuid, text, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_my_pack(p_competence text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
  period public.payroll_periods;
  punches jsonb := '[]'::jsonb;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT * INTO period FROM public.payroll_periods WHERE competence = p_competence;
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', t.id, 'bar_id', t.bar_id, 'punched_at', t.punched_at, 'tipo', t.tipo, 'staff_id', t.staff_id
    )), '[]'::jsonb)
      INTO punches
    FROM public.time_clock t
    WHERE t.staff_id = me;
  EXCEPTION WHEN undefined_table THEN
    punches := '[]'::jsonb;
  END;
  RETURN jsonb_build_object(
    'employee_id', me,
    'period', CASE WHEN period.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', period.id, 'competence', period.competence, 'status', period.status, 'paid_at', period.paid_at
    ) END,
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(l))
      FROM public.payroll_lines l
      WHERE l.employee_id = me
        AND (period.id IS NULL OR l.payroll_period_id = period.id)
    ), '[]'::jsonb),
    'plans', COALESCE((
      SELECT jsonb_agg(to_jsonb(s))
      FROM public.payroll_shift_plans s
      WHERE s.employee_id = me
    ), '[]'::jsonb),
    'occurrences', COALESCE((
      SELECT jsonb_agg(to_jsonb(o))
      FROM public.payroll_occurrences o
      WHERE o.employee_id = me
    ), '[]'::jsonb),
    'points', COALESCE((
      SELECT jsonb_agg(to_jsonb(p))
      FROM public.payroll_points p
      WHERE p.employee_id = me
    ), '[]'::jsonb),
    'goals', COALESCE((
      SELECT jsonb_agg(to_jsonb(g))
      FROM public.payroll_goal_notes g
      WHERE g.employee_id = me AND (p_competence IS NULL OR g.competence = p_competence)
    ), '[]'::jsonb),
    'rewards', COALESCE((
      SELECT jsonb_agg(to_jsonb(r))
      FROM public.payroll_rewards r
      WHERE r.employee_id = me AND (p_competence IS NULL OR r.competence = p_competence)
    ), '[]'::jsonb),
    'advances', COALESCE((
      SELECT jsonb_agg(to_jsonb(a))
      FROM public.payroll_advances a
      WHERE a.employee_id = me AND (p_competence IS NULL OR a.competence = p_competence)
    ), '[]'::jsonb),
    'deductions', COALESCE((
      SELECT jsonb_agg(to_jsonb(d))
      FROM public.payroll_deductions d
      WHERE d.employee_id = me AND (p_competence IS NULL OR d.competence = p_competence)
    ), '[]'::jsonb),
    'punches', punches
  );
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_my_pack(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_my_pack(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_hq_board(
  p_competence text,
  p_bar uuid DEFAULT NULL,
  p_employee uuid DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  period public.payroll_periods;
BEGIN
  PERFORM public.payroll_require_hq();
  SELECT * INTO period FROM public.payroll_periods WHERE competence = p_competence;
  RETURN jsonb_build_object(
    'period', CASE WHEN period.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', period.id, 'competence', period.competence, 'status', period.status, 'paid_at', period.paid_at
    ) END,
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(l) || jsonb_build_object('nome', pf.nome))
      FROM public.payroll_lines l
      LEFT JOIN public.perfis pf ON pf.id = l.employee_id
      WHERE period.id IS NOT NULL
        AND l.payroll_period_id = period.id
        AND (p_bar IS NULL OR l.bar_id = p_bar)
        AND (p_employee IS NULL OR l.employee_id = p_employee)
    ), '[]'::jsonb),
    'status_filter', p_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_hq_board(text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_hq_board(text, uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_hq_write(p_kind text, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  row_id uuid;
  employee uuid;
BEGIN
  actor := public.payroll_require_hq();
  employee := NULLIF(p_payload->>'employee_id', '')::uuid;
  IF employee IS NULL THEN
    RAISE EXCEPTION 'employee_id is required';
  END IF;
  IF p_kind = 'shift_plan' THEN
    INSERT INTO public.payroll_shift_plans (employee_id, bar_id, starts_at, ends_at, created_by)
    VALUES (
      employee,
      NULLIF(p_payload->>'bar_id', '')::uuid,
      (p_payload->>'starts_at')::timestamptz,
      (p_payload->>'ends_at')::timestamptz,
      actor
    ) RETURNING id INTO row_id;
  ELSIF p_kind = 'occurrence' THEN
    INSERT INTO public.payroll_occurrences (employee_id, bar_id, note, created_by)
    VALUES (employee, NULLIF(p_payload->>'bar_id', '')::uuid, COALESCE(p_payload->>'note', ''), actor)
    RETURNING id INTO row_id;
  ELSIF p_kind = 'points' THEN
    INSERT INTO public.payroll_points (employee_id, bar_id, points, reason, source, source_id, created_by)
    VALUES (
      employee,
      NULLIF(p_payload->>'bar_id', '')::uuid,
      (p_payload->>'points')::integer,
      COALESCE(p_payload->>'reason', ''),
      NULLIF(p_payload->>'source', ''),
      NULLIF(p_payload->>'source_id', ''),
      actor
    ) RETURNING id INTO row_id;
  ELSIF p_kind = 'goal' THEN
    INSERT INTO public.payroll_goal_notes (employee_id, bar_id, competence, title, target, actual, source, source_id, created_by)
    VALUES (
      employee,
      NULLIF(p_payload->>'bar_id', '')::uuid,
      p_payload->>'competence',
      COALESCE(p_payload->>'title', ''),
      NULLIF(p_payload->>'target', '')::numeric,
      NULLIF(p_payload->>'actual', '')::numeric,
      NULLIF(p_payload->>'source', ''),
      NULLIF(p_payload->>'source_id', ''),
      actor
    ) RETURNING id INTO row_id;
  ELSIF p_kind = 'reward' THEN
    INSERT INTO public.payroll_rewards (employee_id, bar_id, competence, title, amount, status, source, source_id, created_by)
    VALUES (
      employee,
      NULLIF(p_payload->>'bar_id', '')::uuid,
      p_payload->>'competence',
      COALESCE(p_payload->>'title', ''),
      (p_payload->>'amount')::integer,
      COALESCE(NULLIF(p_payload->>'status', ''), 'draft'),
      NULLIF(p_payload->>'source', ''),
      NULLIF(p_payload->>'source_id', ''),
      actor
    ) RETURNING id INTO row_id;
  ELSIF p_kind = 'advance' THEN
    INSERT INTO public.payroll_advances (employee_id, bar_id, competence, amount, status, created_by)
    VALUES (
      employee,
      NULLIF(p_payload->>'bar_id', '')::uuid,
      p_payload->>'competence',
      (p_payload->>'amount')::integer,
      COALESCE(NULLIF(p_payload->>'status', ''), 'draft'),
      actor
    ) RETURNING id INTO row_id;
  ELSIF p_kind = 'deduction' THEN
    INSERT INTO public.payroll_deductions (employee_id, bar_id, competence, reason, amount, reference, status, created_by)
    VALUES (
      employee,
      NULLIF(p_payload->>'bar_id', '')::uuid,
      NULLIF(p_payload->>'competence', ''),
      COALESCE(p_payload->>'reason', ''),
      (p_payload->>'amount')::integer,
      NULLIF(p_payload->>'reference', ''),
      'draft',
      actor
    ) RETURNING id INTO row_id;
  ELSE
    RAISE EXCEPTION 'unknown payroll write';
  END IF;
  PERFORM public.payroll_audit(p_kind, NULL, employee, p_payload || jsonb_build_object('id', row_id));
  RETURN row_id;
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_hq_write(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_hq_write(text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.payroll_approve_deduction(p_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid;
  row public.payroll_deductions;
BEGIN
  actor := public.payroll_require_hq();
  SELECT * INTO row FROM public.payroll_deductions WHERE id = p_id;
  IF row.id IS NULL OR row.status <> 'draft' THEN
    RAISE EXCEPTION 'deduction cannot be approved';
  END IF;
  UPDATE public.payroll_deductions
    SET status = 'approved', approved_by = actor
    WHERE id = p_id;
  PERFORM public.payroll_audit('deduction', NULL, row.employee_id, jsonb_build_object('id', p_id, 'amount', row.amount, 'reason', row.reason));
  RETURN 'approved';
END;
$$;

REVOKE ALL ON FUNCTION public.payroll_approve_deduction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payroll_approve_deduction(uuid) TO authenticated;

ALTER TABLE public.payroll_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_shift_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_goal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_deductions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_rules_read ON public.payroll_rules;
CREATE POLICY payroll_rules_read ON public.payroll_rules
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq());

DROP POLICY IF EXISTS payroll_periods_read ON public.payroll_periods;
CREATE POLICY payroll_periods_read ON public.payroll_periods
  FOR SELECT TO authenticated
  USING (
    public.is_payroll_hq()
    OR EXISTS (
      SELECT 1 FROM public.payroll_lines l
      WHERE l.payroll_period_id = payroll_periods.id
        AND l.employee_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS payroll_lines_read ON public.payroll_lines;
CREATE POLICY payroll_lines_read ON public.payroll_lines
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq() OR employee_id = auth.uid());

DROP POLICY IF EXISTS payroll_audit_read ON public.payroll_audit;
CREATE POLICY payroll_audit_read ON public.payroll_audit
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq() OR employee_id = auth.uid());

DROP POLICY IF EXISTS payroll_plans_read ON public.payroll_shift_plans;
CREATE POLICY payroll_plans_read ON public.payroll_shift_plans
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq() OR employee_id = auth.uid());

DROP POLICY IF EXISTS payroll_occurrences_read ON public.payroll_occurrences;
CREATE POLICY payroll_occurrences_read ON public.payroll_occurrences
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq() OR employee_id = auth.uid());

DROP POLICY IF EXISTS payroll_points_read ON public.payroll_points;
CREATE POLICY payroll_points_read ON public.payroll_points
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq() OR employee_id = auth.uid());

DROP POLICY IF EXISTS payroll_goals_read ON public.payroll_goal_notes;
CREATE POLICY payroll_goals_read ON public.payroll_goal_notes
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq() OR employee_id = auth.uid());

DROP POLICY IF EXISTS payroll_rewards_read ON public.payroll_rewards;
CREATE POLICY payroll_rewards_read ON public.payroll_rewards
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq() OR employee_id = auth.uid());

DROP POLICY IF EXISTS payroll_advances_read ON public.payroll_advances;
CREATE POLICY payroll_advances_read ON public.payroll_advances
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq() OR employee_id = auth.uid());

DROP POLICY IF EXISTS payroll_deductions_read ON public.payroll_deductions;
CREATE POLICY payroll_deductions_read ON public.payroll_deductions
  FOR SELECT TO authenticated
  USING (public.is_payroll_hq() OR employee_id = auth.uid());

REVOKE ALL ON public.payroll_rules FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_periods FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_lines FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_audit FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_shift_plans FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_occurrences FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_points FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_goal_notes FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_rewards FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_advances FROM PUBLIC, anon;
REVOKE ALL ON public.payroll_deductions FROM PUBLIC, anon;

GRANT SELECT ON public.payroll_rules TO authenticated;
GRANT SELECT ON public.payroll_periods TO authenticated;
GRANT SELECT ON public.payroll_lines TO authenticated;
GRANT SELECT ON public.payroll_audit TO authenticated;
GRANT SELECT ON public.payroll_shift_plans TO authenticated;
GRANT SELECT ON public.payroll_occurrences TO authenticated;
GRANT SELECT ON public.payroll_points TO authenticated;
GRANT SELECT ON public.payroll_goal_notes TO authenticated;
GRANT SELECT ON public.payroll_rewards TO authenticated;
GRANT SELECT ON public.payroll_advances TO authenticated;
GRANT SELECT ON public.payroll_deductions TO authenticated;
