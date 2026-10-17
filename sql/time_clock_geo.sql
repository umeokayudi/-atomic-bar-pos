-- Optional: only if public.time_clock exists in Postgres. NOT applied by this repository.
-- Punches normally live in the live JSON table `time_clock`. When a Postgres time_clock exists without these
-- columns, the API strips unknown columns on insert, so the GPS check, the reason and the check-in agreement
-- would be lost. Run this once in the Supabase SQL editor in that case. No RLS or grant change.
ALTER TABLE IF EXISTS public.time_clock
  ADD COLUMN IF NOT EXISTS geo jsonb,
  ADD COLUMN IF NOT EXISTS geo_status text,
  ADD COLUMN IF NOT EXISTS geo_error text,
  ADD COLUMN IF NOT EXISTS justification text,
  ADD COLUMN IF NOT EXISTS ack_at timestamptz,
  ADD COLUMN IF NOT EXISTS role_today text,
  ADD COLUMN IF NOT EXISTS ack_mission text,
  ADD COLUMN IF NOT EXISTS in_punch_id text,
  ADD COLUMN IF NOT EXISTS recovered_in boolean;
