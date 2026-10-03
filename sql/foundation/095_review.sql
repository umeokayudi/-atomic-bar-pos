-- Review rules applied after the install chain.
-- Does not delete drink_menu, bar_pricing, bar_product_prices, vendas, or pos_vendas.
-- verify_schema.sql stays read-only; this file is the only writer here.

-- Till drink lines use drink_menu. Till sealed-bottle lines use bar_pricing.
-- Procurement orders use bar_product_prices. A missing procurement price does
-- not fall through to the till price. resolve_bar_price still falls back to
-- produtos.preco_venda for the legacy order book; that fallback is not a POS price.

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
    RETURN price;
  ELSIF p_operation = 'pos_unit' THEN
    SELECT bp.preco_drink INTO price
    FROM public.bar_pricing bp
    WHERE bp.bar_id = p_bar AND bp.produto_id = p_product;
    RETURN price;
  ELSIF p_operation = 'procurement' THEN
    SELECT bp.sale_price INTO price
    FROM public.bar_product_prices bp
    WHERE bp.bar_id = p_bar
      AND bp.product_id = p_product
      AND bp.active
    ORDER BY bp.minimum_quantity DESC, bp.valid_from DESC NULLS LAST
    LIMIT 1;
    RETURN price;
  END IF;
  RAISE EXCEPTION 'unknown price operation';
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
  till_price := public.operation_price(p_bar, p_product, NULL, 'pos_unit');
  procurement_price := public.operation_price(p_bar, p_product, NULL, 'procurement');
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

-- Official indicators read one book. They do not add vendas and pos_vendas.

CREATE OR REPLACE FUNCTION public.sales_indicator(p_book text, p_bar uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT (public.user_can_access_bar(p_bar) OR public.is_jbm()) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  IF p_book = 'till' THEN
    RETURN COALESCE((
      SELECT SUM(v.total) FROM public.pos_vendas v WHERE v.bar_id = p_bar
    ), 0);
  ELSIF p_book = 'jbm' THEN
    RETURN COALESCE((
      SELECT SUM(v.total) FROM public.vendas v WHERE v.bar_id = p_bar
    ), 0);
  END IF;
  RAISE EXCEPTION 'unknown sales book';
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

GRANT SELECT ON public.pos_void_audit TO authenticated;

-- Fulfillment policies already exist. Grants match the app queries only.
-- SupplierPortal: SELECT supplier_users, order_supplier_assignments, fulfillment_alerts.
-- FulfillmentHq: SELECT pedido_fulfillment, fulfillment_alerts, supplier_routing_rules,
-- supplier_products; upsert supplier_routing_rules and supplier_users.
-- No DELETE. fulfillment_alerts is SELECT only: the app does not set read_at.
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
