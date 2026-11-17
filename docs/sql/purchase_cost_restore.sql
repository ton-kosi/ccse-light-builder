-- Deleting the last purchase of a SKU left that purchase's cost on the SKU (backlog, 14/11/2026).
-- Costs are also typed by hand / imported on the SKU page, so the cost cannot simply be removed.
-- Now sku_costs remembers which purchase its cost came from and the cost it had before purchases:
--   purchase_id             the purchase the current cost came from (null = typed by hand or imported)
--   pre_purchase_cost / _supplier   the hand-entered cost that the first purchase replaced
-- When no purchase is left: the hand-entered cost comes back, or the cost row is removed if there was none.
-- A hand edit of the cost (SKU page, CSV) makes it a hand cost again. Additive: two columns + function changes.

ALTER TABLE public.sku_costs ADD COLUMN IF NOT EXISTS purchase_id uuid;
ALTER TABLE public.sku_costs ADD COLUMN IF NOT EXISTS pre_purchase_cost numeric;
ALTER TABLE public.sku_costs ADD COLUMN IF NOT EXISTS pre_purchase_supplier text;

-- Existing costs equal to the SKU's latest purchase came from that purchase
UPDATE public.sku_costs c SET purchase_id = p.id
FROM (
  SELECT DISTINCT ON (sku_id) id, sku_id, round(unit_price + extra_cost / qty, 4) AS cost
  FROM public.purchases ORDER BY sku_id, date DESC, created_at DESC
) p
WHERE p.sku_id = c.sku_id AND p.cost = c.unit_cost AND c.purchase_id IS NULL;

-- A cost change that does not come from the purchase refresh is a hand cost
CREATE OR REPLACE FUNCTION public.sku_cost_before_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('ccse.cost_refresh', true), '') <> 'on' THEN
    IF NEW.unit_cost IS DISTINCT FROM OLD.unit_cost THEN
      NEW.purchase_id := NULL;
      NEW.pre_purchase_cost := NULL;
      NEW.pre_purchase_supplier := NULL;
    ELSE
      NEW.purchase_id := OLD.purchase_id;
      NEW.pre_purchase_cost := OLD.pre_purchase_cost;
      NEW.pre_purchase_supplier := OLD.pre_purchase_supplier;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sku_cost_before_update() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_sku_costs_before_update ON public.sku_costs;
CREATE TRIGGER trg_sku_costs_before_update BEFORE UPDATE ON public.sku_costs
  FOR EACH ROW EXECUTE FUNCTION public.sku_cost_before_update();

-- cost per unit = price + extra cost (shipping, import duty…) spread over the qty
CREATE OR REPLACE FUNCTION public.refresh_sku_cost_from_purchases(_sku uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; c public.sku_costs;
BEGIN
  PERFORM set_config('ccse.cost_refresh', 'on', true);
  SELECT * INTO c FROM sku_costs WHERE sku_id = _sku;
  SELECT id, unit_price + extra_cost / qty AS cost, supplier INTO p
    FROM purchases WHERE sku_id = _sku
    ORDER BY date DESC, created_at DESC LIMIT 1;
  IF FOUND THEN
    IF c.sku_id IS NULL THEN
      INSERT INTO sku_costs (sku_id, unit_cost, supplier, purchase_id) VALUES (_sku, round(p.cost, 4), p.supplier, p.id);
    ELSE
      UPDATE sku_costs SET unit_cost = round(p.cost, 4), supplier = p.supplier, purchase_id = p.id,
        -- the first purchase over a hand cost keeps that hand cost to come back to
        pre_purchase_cost = CASE WHEN c.purchase_id IS NULL THEN c.unit_cost ELSE c.pre_purchase_cost END,
        pre_purchase_supplier = CASE WHEN c.purchase_id IS NULL THEN c.supplier ELSE c.pre_purchase_supplier END
      WHERE sku_id = _sku;
    END IF;
  ELSIF c.sku_id IS NOT NULL AND c.purchase_id IS NOT NULL THEN
    -- no purchase left and the cost came from one: back to the hand cost, or no cost
    IF c.pre_purchase_cost IS NOT NULL THEN
      UPDATE sku_costs SET unit_cost = c.pre_purchase_cost, supplier = c.pre_purchase_supplier,
        purchase_id = NULL, pre_purchase_cost = NULL, pre_purchase_supplier = NULL
      WHERE sku_id = _sku;
    ELSE
      DELETE FROM sku_costs WHERE sku_id = _sku;
    END IF;
  END IF;
  PERFORM set_config('ccse.cost_refresh', 'off', true);
END $$;
REVOKE ALL ON FUNCTION public.refresh_sku_cost_from_purchases(uuid) FROM PUBLIC, anon, authenticated;
