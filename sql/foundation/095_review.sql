-- Review rules applied after the install chain.
-- Does not delete drink_menu, bar_pricing, bar_product_prices, vendas, or pos_vendas.
-- verify_schema.sql stays read-only; this file is the only writer here.

-- Till drink lines use drink_menu. Till sealed-bottle lines use bar_pricing.
-- Procurement orders use bar_product_prices through resolve_bar_price.
-- A missing or non-positive price is an error. It is not replaced by another table.

CREATE OR REPLACE FUNCTION public.operation_price(
  p_bar uuid,
  p_product uuid,
  p_drink uuid,
  p_operation text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  price numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.user_can_access_bar(p_bar) OR public.is_jbm()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF p_operation = 'pos_drink' THEN
    SELECT d.preco_venda INTO price
    FROM public.drink_menu d
    WHERE d.id = p_drink AND d.bar_id = p_bar;
  ELSIF p_operation = 'pos_unit' THEN
    SELECT bp.preco_drink INTO price
    FROM public.bar_pricing bp
    WHERE bp.bar_id = p_bar AND bp.produto_id = p_product;
  ELSIF p_operation = 'procurement' THEN
    RETURN public.resolve_bar_price(p_bar, p_product, now(), 1);
  ELSE
    RAISE EXCEPTION 'unknown price operation';
  END IF;
  IF price IS NULL OR price <= 0 THEN
    RAISE EXCEPTION 'sale price not configured';
  END IF;
  RETURN price;
END;
$$;

REVOKE ALL ON FUNCTION public.operation_price(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operation_price(uuid, uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.price_conflict(p_bar uuid, p_product uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  till_price numeric;
  procurement_price numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.user_can_access_bar(p_bar) OR public.is_jbm()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  BEGIN
    till_price := public.operation_price(p_bar, p_product, NULL, 'pos_unit');
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%sale price not configured%' OR SQLERRM LIKE '%ambiguous sale price%' THEN
        till_price := NULL;
      ELSE
        RAISE;
      END IF;
  END;
  BEGIN
    procurement_price := public.operation_price(p_bar, p_product, NULL, 'procurement');
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%sale price not configured%' OR SQLERRM LIKE '%ambiguous sale price%' THEN
        procurement_price := NULL;
      ELSE
        RAISE;
      END IF;
  END;
  RETURN jsonb_build_object(
    'till_unit', till_price,
    'procurement', procurement_price,
    'diverges', till_price IS NOT NULL
      AND procurement_price IS NOT NULL
      AND till_price IS DISTINCT FROM procurement_price
  );
END;
$$;

REVOKE ALL ON FUNCTION public.price_conflict(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.price_conflict(uuid, uuid) TO authenticated;

-- One book per call. gross keeps the original total. net is the valid amount.
-- A voided till row contributes 0 to net and is not subtracted a second time.
-- refunds is the capped refund column, once per row. Rows are not deleted.

DROP FUNCTION IF EXISTS public.sales_indicator(text, uuid);

CREATE FUNCTION public.sales_indicator(p_book text, p_bar uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gross numeric := 0;
  refunds numeric := 0;
  net numeric := 0;
  transactions integer := 0;
  valid_transactions integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.user_can_access_bar(p_bar) OR public.is_jbm()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF p_book = 'till' THEN
    SELECT
      COALESCE(SUM(v.total), 0),
      COALESCE(SUM(LEAST(GREATEST(v.total, 0), GREATEST(COALESCE(v.refunded, 0), 0))), 0),
      COALESCE(SUM(
        CASE
          WHEN v.void_status IN ('void', 'cancelada', 'cancelado') THEN 0
          ELSE GREATEST(
            v.total - LEAST(GREATEST(v.total, 0), GREATEST(COALESCE(v.refunded, 0), 0)),
            0
          )
        END
      ), 0),
      COUNT(*)::integer,
      COUNT(*) FILTER (
        WHERE v.void_status IS DISTINCT FROM 'void'
          AND v.void_status IS DISTINCT FROM 'cancelada'
          AND v.void_status IS DISTINCT FROM 'cancelado'
          AND GREATEST(
            v.total - LEAST(GREATEST(v.total, 0), GREATEST(COALESCE(v.refunded, 0), 0)),
            0
          ) > 0
      )::integer
    INTO gross, refunds, net, transactions, valid_transactions
    FROM public.pos_vendas v
    WHERE v.bar_id = p_bar;
  ELSIF p_book = 'jbm' THEN
    SELECT
      COALESCE(SUM(v.total), 0),
      0,
      COALESCE(SUM(
        CASE
          WHEN v.status IN ('cancelada', 'cancelado', 'void', 'estornada') THEN 0
          ELSE v.total
        END
      ), 0),
      COUNT(*)::integer,
      COUNT(*) FILTER (
        WHERE v.status IS DISTINCT FROM 'cancelada'
          AND v.status IS DISTINCT FROM 'cancelado'
          AND v.status IS DISTINCT FROM 'void'
          AND v.status IS DISTINCT FROM 'estornada'
          AND v.total > 0
      )::integer
    INTO gross, refunds, net, transactions, valid_transactions
    FROM public.vendas v
    WHERE v.bar_id = p_bar;
  ELSE
    RAISE EXCEPTION 'unknown sales book';
  END IF;
  RETURN jsonb_build_object(
    'gross', gross,
    'refunds', refunds,
    'net', net,
    'transactions', transactions,
    'valid_transactions', valid_transactions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sales_indicator(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_indicator(text, uuid) TO authenticated;

ALTER TABLE public.pos_void_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_void_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_void_audit_read ON public.pos_void_audit;
CREATE POLICY pos_void_audit_read ON public.pos_void_audit
  FOR SELECT TO authenticated
  USING (public.user_can_access_bar(bar_id) OR public.is_jbm() OR user_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.pos_void_audit FROM authenticated;
GRANT SELECT ON public.pos_void_audit TO authenticated;

-- Fulfillment policies already exist. Grants match the app queries only.
-- SupplierPortal: SELECT supplier_users, order_supplier_assignments, fulfillment_alerts.
-- FulfillmentHq: SELECT pedido_fulfillment, fulfillment_alerts, supplier_routing_rules,
-- supplier_products; upsert supplier_routing_rules and supplier_users.
-- No DELETE. fulfillment_alerts is SELECT only: the app does not write read_at.
-- UPDATE stays ungranted, including for the bar that can see the row.
-- These policies stay without a table grant:
--   order_supplier_items, fulfillment_events, delivery_confirmations,
--   supplier_purchase_requests, audit_logs.
-- audit_logs is written by _fulfillment_audit (SECURITY DEFINER).

GRANT SELECT, INSERT, UPDATE ON public.supplier_users TO authenticated;
GRANT SELECT ON public.supplier_products TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.supplier_routing_rules TO authenticated;
GRANT SELECT ON public.pedido_fulfillment TO authenticated;
GRANT SELECT ON public.order_supplier_assignments TO authenticated;
GRANT SELECT ON public.fulfillment_alerts TO authenticated;
