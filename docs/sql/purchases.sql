-- Purchases (ซื้อของ): every purchase with qty and price, kept as history.
-- Each purchase receives the goods into stock and makes the SKU's cost = latest purchase cost.
-- Roles: admin, stock, accounting can see and record purchases (prices are internal);
-- only admin can delete one (stock is taken back out and the cost recalculated).

CREATE TABLE public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT current_date,
  sku_id uuid NOT NULL REFERENCES public.skus(id) ON DELETE RESTRICT,
  qty numeric NOT NULL CHECK (qty > 0),
  unit_price numeric NOT NULL CHECK (unit_price >= 0),
  extra_cost numeric NOT NULL DEFAULT 0 CHECK (extra_cost >= 0),
  supplier text,
  doc_no text,
  purchase_request_id uuid REFERENCES public.purchase_requests(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchases_sku_date_idx ON public.purchases (sku_id, date DESC, created_at DESC);

GRANT SELECT, INSERT, DELETE ON public.purchases TO authenticated;
GRANT ALL ON public.purchases TO service_role;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "purchases read" ON public.purchases FOR SELECT TO authenticated
  USING (private.has_any_role(auth.uid(), ARRAY['admin','stock','accounting']::app_role[]));
CREATE POLICY "purchases insert" ON public.purchases FOR INSERT TO authenticated
  WITH CHECK (private.has_any_role(auth.uid(), ARRAY['admin','stock','accounting']::app_role[]));
CREATE POLICY "purchases delete" ON public.purchases FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

-- cost per unit = price + extra cost (shipping, import duty…) spread over the qty
CREATE OR REPLACE FUNCTION public.refresh_sku_cost_from_purchases(_sku uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record;
BEGIN
  SELECT unit_price + extra_cost / qty AS cost, supplier INTO p
    FROM purchases WHERE sku_id = _sku
    ORDER BY date DESC, created_at DESC LIMIT 1;
  IF FOUND THEN
    INSERT INTO sku_costs (sku_id, unit_cost, supplier) VALUES (_sku, round(p.cost, 4), p.supplier)
    ON CONFLICT (sku_id) DO UPDATE SET unit_cost = EXCLUDED.unit_cost, supplier = EXCLUDED.supplier;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.refresh_sku_cost_from_purchases(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purchase_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.purchase_request_id IS NOT NULL THEN
    -- receiving an ordered purchase request moves the goods into stock (its own trigger)
    UPDATE purchase_requests SET status = 'received' WHERE id = NEW.purchase_request_id AND status = 'ordered';
    IF NOT FOUND THEN RAISE EXCEPTION 'ใบขอซื้อนี้ยังไม่ได้สั่งซื้อ หรือรับของไปแล้ว'; END IF;
  ELSE
    INSERT INTO stock_movements (sku_id, qty, type, project_id, note, created_by)
    VALUES (NEW.sku_id, NEW.qty, 'receive', NEW.project_id,
            trim('ซื้อ ' || coalesce(NEW.supplier, '') || ' ' || coalesce(NEW.doc_no, '')), auth.uid());
  END IF;
  PERFORM refresh_sku_cost_from_purchases(NEW.sku_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.purchase_after_insert() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_purchases_insert AFTER INSERT ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.purchase_after_insert();

CREATE OR REPLACE FUNCTION public.purchase_after_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO stock_movements (sku_id, qty, type, project_id, note, created_by)
  VALUES (OLD.sku_id, -OLD.qty, 'adjust', OLD.project_id,
          trim('ยกเลิกการซื้อ ' || coalesce(OLD.supplier, '') || ' ' || coalesce(OLD.doc_no, '')), auth.uid());
  PERFORM refresh_sku_cost_from_purchases(OLD.sku_id);
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.purchase_after_delete() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_purchases_delete AFTER DELETE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.purchase_after_delete();
