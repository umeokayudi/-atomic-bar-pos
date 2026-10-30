-- Money structure (HQ): invoice adjustment with a reason, and receipts tied to the payment and invoice they cover.
-- Additive and safe to run more than once. The app works without it, but then an invoice cannot be saved
-- with an adjustment and duplicate receipts are only blocked by the app (not by the database).

-- 1.3 Invoice lock: total = linked deliveries + ajuste (signed; a discount is negative) with a reason.
ALTER TABLE public.faturas ADD COLUMN IF NOT EXISTS ajuste numeric NOT NULL DEFAULT 0;
ALTER TABLE public.faturas ADD COLUMN IF NOT EXISTS ajuste_motivo text;

-- 2.3 Receipts: which invoice and which payment each receipt covers; one receipt per payment; unique numbers.
ALTER TABLE public.ryoshusho ADD COLUMN IF NOT EXISTS fatura_id uuid REFERENCES public.faturas(id) ON DELETE SET NULL;
ALTER TABLE public.ryoshusho ADD COLUMN IF NOT EXISTS pagamento_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS ryoshusho_pagamento_ref_uq ON public.ryoshusho (pagamento_ref) WHERE pagamento_ref IS NOT NULL;
-- Fails if two receipts already share a number: delete the duplicate first (see the PR notes).
CREATE UNIQUE INDEX IF NOT EXISTS ryoshusho_numero_uq ON public.ryoshusho (numero) WHERE numero IS NOT NULL;
