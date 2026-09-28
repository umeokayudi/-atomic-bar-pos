-- POS configuration for one bar: favorites, AI weights, service, tax, card surcharge.
-- Do not run this on ojirgkqtqvugqktyuhem or fxsakrshmldmkdmbevna.
-- It does not create a second product, order, or sale table.
-- Drink prices stay on drink_menu and bar_pricing.
-- The sale is still written by pos_close_ticket.
-- Run this only after sql/pos_floor.sql, on a disposable database.

CREATE TABLE IF NOT EXISTS public.pos_bar_config (
  bar_id uuid PRIMARY KEY REFERENCES public.bars(id) ON DELETE CASCADE,
  service_enabled boolean NOT NULL DEFAULT false,
  service_type text NOT NULL DEFAULT 'percentage' CHECK (service_type IN ('percentage', 'fixed')),
  service_value numeric NOT NULL DEFAULT 0 CHECK (service_value >= 0),
  service_dine_in boolean NOT NULL DEFAULT true,
  service_takeaway boolean NOT NULL DEFAULT false,
  service_delivery boolean NOT NULL DEFAULT false,
  tax_enabled boolean NOT NULL DEFAULT false,
  tax_rate numeric NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  card_surcharge_enabled boolean NOT NULL DEFAULT false,
  card_credit_pct numeric NOT NULL DEFAULT 0 CHECK (card_credit_pct >= 0),
  card_debit_pct numeric NOT NULL DEFAULT 0 CHECK (card_debit_pct >= 0),
  card_other_pct numeric NOT NULL DEFAULT 0 CHECK (card_other_pct >= 0),
  ai_enabled boolean NOT NULL DEFAULT false,
  ai_weights jsonb NOT NULL DEFAULT '{}'::jsonb,
  favorites jsonb NOT NULL DEFAULT '[]'::jsonb,
  featured jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pos_bar_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_bar_config_read ON public.pos_bar_config;
CREATE POLICY pos_bar_config_read ON public.pos_bar_config
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.perfis p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'jbm')
          OR (
            p.bar_id = pos_bar_config.bar_id
            AND p.role IN ('cliente', 'gerente', 'caixa', 'bar_staff')
          )
        )
    )
  );

DROP POLICY IF EXISTS pos_bar_config_write ON public.pos_bar_config;
CREATE POLICY pos_bar_config_write ON public.pos_bar_config
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.perfis p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'jbm')
          OR (p.bar_id = pos_bar_config.bar_id AND p.role IN ('cliente', 'gerente'))
        )
    )
  );

DROP POLICY IF EXISTS pos_bar_config_update ON public.pos_bar_config;
CREATE POLICY pos_bar_config_update ON public.pos_bar_config
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.perfis p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'jbm')
          OR (p.bar_id = pos_bar_config.bar_id AND p.role IN ('cliente', 'gerente'))
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.perfis p
      WHERE p.id = auth.uid()
        AND (
          p.role IN ('admin', 'jbm')
          OR (p.bar_id = pos_bar_config.bar_id AND p.role IN ('cliente', 'gerente'))
        )
    )
  );

REVOKE ALL ON public.pos_bar_config FROM PUBLIC;
REVOKE ALL ON public.pos_bar_config FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.pos_bar_config TO authenticated;

-- Same numbers as quoteSale in src/lib/posEngine.js.
-- Tax is on the drink subtotal only.
-- Card surcharge is once, on subtotal + service + tax.
-- card = debit rate, credit = credit rate, cash = none.
CREATE OR REPLACE FUNCTION public.pos_quote_charges(
  p_bar uuid,
  p_subtotal integer,
  p_payment text,
  p_point text DEFAULT 'dine-in'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg public.pos_bar_config;
  base integer := GREATEST(COALESCE(p_subtotal, 0), 0);
  service integer := 0;
  tax integer := 0;
  surcharge integer := 0;
  pct numeric := 0;
  apply_service boolean := false;
BEGIN
  PERFORM public.pos_require_bar(p_bar);
  SELECT * INTO cfg FROM public.pos_bar_config WHERE bar_id = p_bar;
  IF cfg.bar_id IS NOT NULL AND cfg.service_enabled THEN
    apply_service := (p_point = 'dine-in' AND cfg.service_dine_in)
      OR (p_point = 'takeaway' AND cfg.service_takeaway)
      OR (p_point = 'delivery' AND cfg.service_delivery);
    IF apply_service THEN
      IF cfg.service_type = 'fixed' THEN
        service := round(GREATEST(cfg.service_value, 0))::integer;
      ELSE
        service := round(base * GREATEST(cfg.service_value, 0) / 100.0)::integer;
      END IF;
    END IF;
  END IF;
  IF cfg.bar_id IS NOT NULL AND cfg.tax_enabled THEN
    tax := round(base * GREATEST(cfg.tax_rate, 0) / 100.0)::integer;
  END IF;
  IF cfg.bar_id IS NOT NULL AND cfg.card_surcharge_enabled THEN
    IF p_payment = 'credit' THEN
      pct := cfg.card_credit_pct;
    ELSIF p_payment = 'card' THEN
      pct := cfg.card_debit_pct;
    ELSIF p_payment = 'other' THEN
      pct := cfg.card_other_pct;
    ELSE
      pct := 0;
    END IF;
    surcharge := round((base + service + tax) * GREATEST(pct, 0) / 100.0)::integer;
  END IF;
  RETURN jsonb_build_object(
    'subtotal', base,
    'service', service,
    'tax', tax,
    'surcharge', surcharge,
    'total', base + service + tax + surcharge
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_quote_charges(uuid, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_quote_charges(uuid, integer, text, text) TO authenticated;

-- One transaction with the existing close. A second tap with the same key
-- comes back as duplicate and does not add the charges again.
CREATE OR REPLACE FUNCTION public.pos_close_with_charges(
  p_bar uuid,
  p_ticket uuid,
  p_payment text,
  p_key text,
  p_agent uuid DEFAULT NULL,
  p_point text DEFAULT 'dine-in'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
  venda uuid;
  subtotal integer;
  quote jsonb;
  service integer;
  tax integer;
  surcharge integer;
  customer integer;
  updated integer;
BEGIN
  result := public.pos_close_ticket(p_bar, p_ticket, p_payment, p_key, p_agent);
  IF COALESCE(result->>'duplicate', '') = 'true' THEN
    RETURN result;
  END IF;
  venda := (result->>'venda_id')::uuid;
  subtotal := COALESCE((result->>'total')::integer, 0);
  quote := public.pos_quote_charges(p_bar, subtotal, p_payment, p_point);
  service := COALESCE((quote->>'service')::integer, 0);
  tax := COALESCE((quote->>'tax')::integer, 0);
  surcharge := COALESCE((quote->>'surcharge')::integer, 0);
  customer := COALESCE((quote->>'total')::integer, subtotal);
  IF service + tax + surcharge = 0 THEN
    RETURN result || jsonb_build_object('customer_total', subtotal, 'service', 0, 'tax', 0, 'surcharge', 0);
  END IF;
  IF customer <> subtotal + service + tax + surcharge THEN
    RAISE EXCEPTION 'charge total does not add up';
  END IF;

  UPDATE public.pos_vendas
    SET total = customer,
        obs = concat_ws(E'\n', NULLIF(obs, ''), format('Charge: service=%s tax=%s surcharge=%s', service, tax, surcharge))
    WHERE id = venda AND bar_id = p_bar;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale not in this bar';
  END IF;

  UPDATE public.caixa_movimentos
    SET valor = customer
    WHERE referencia_id = venda
      AND referencia_tipo = 'pos_venda'
      AND tipo = 'entrada'
      AND bar_id = p_bar;
  GET DIAGNOSTICS updated = ROW_COUNT;
  IF updated <> 1 THEN
    RAISE EXCEPTION 'till cash line missing';
  END IF;

  RETURN result || jsonb_build_object(
    'customer_total', customer,
    'service', service,
    'tax', tax,
    'surcharge', surcharge
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pos_close_with_charges(uuid, uuid, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pos_close_with_charges(uuid, uuid, text, text, uuid, text) TO authenticated;
