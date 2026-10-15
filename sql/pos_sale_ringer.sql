-- Who rang a till sale up (pos_vendas.criado_por) comes from the signed-in login, never from the browser.
-- NOT applied automatically. Optional hardening for the Drinks project; review and apply by hand.
--
-- Already enforced without this file:
--   * pos_commit_sale (sql/floor_comandas.sql) writes criado_por = auth.uid().
--   * /api/bar/live-db (api/_routeBarLive.js + api/_posSaleStamp.js) overwrites criado_por with the
--     authenticated login on insert and drops it from bar-login updates.
-- This trigger covers the remaining path: a client writing pos_vendas directly with its own JWT.
-- Service-role writes (auth.uid() is null) keep the value the server set.
-- src/lib/saleCredit.js credits a sale with nobody marked on it to this login.

CREATE OR REPLACE FUNCTION public.pos_vendas_stamp_ringer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      NEW.criado_por := auth.uid();
    ELSE
      NEW.criado_por := OLD.criado_por;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS pos_vendas_stamp_ringer ON public.pos_vendas;
CREATE TRIGGER pos_vendas_stamp_ringer
  BEFORE INSERT OR UPDATE OF criado_por ON public.pos_vendas
  FOR EACH ROW EXECUTE FUNCTION public.pos_vendas_stamp_ringer();

-- Rollback:
-- DROP TRIGGER IF EXISTS pos_vendas_stamp_ringer ON public.pos_vendas;
-- DROP FUNCTION IF EXISTS public.pos_vendas_stamp_ringer();
