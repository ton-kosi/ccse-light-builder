-- Edit a recorded purchase (แก้ไขรายการซื้อ). Admin only, like delete.
-- Stock follows the change (difference posted as an 'adjust' movement) and the
-- SKU cost is recalculated from the latest purchase. Additive: no data is changed.

GRANT UPDATE ON public.purchases TO authenticated;
CREATE POLICY "purchases update" ON public.purchases FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- who/when recorded and the purchase-request link never change;
-- a purchase received from a purchase request keeps that request's SKU
CREATE OR REPLACE FUNCTION public.purchase_before_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.id := OLD.id;
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;
  NEW.purchase_request_id := OLD.purchase_request_id;
  IF OLD.purchase_request_id IS NOT NULL AND NEW.sku_id IS DISTINCT FROM OLD.sku_id THEN
    RAISE EXCEPTION 'รายการนี้รับของตามใบขอซื้อ เปลี่ยน SKU ไม่ได้ (ลบแล้วบันทึกใหม่แทน)';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.purchase_before_update() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_purchases_before_update BEFORE UPDATE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.purchase_before_update();

CREATE OR REPLACE FUNCTION public.purchase_after_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE label text := trim('แก้ไขการซื้อ ' || coalesce(NEW.supplier, '') || ' ' || coalesce(NEW.doc_no, ''));
BEGIN
  IF NEW.sku_id IS DISTINCT FROM OLD.sku_id OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
    -- moved to another SKU or project: take the old qty out, put the new qty in
    INSERT INTO stock_movements (sku_id, qty, type, project_id, note, created_by)
    VALUES (OLD.sku_id, -OLD.qty, 'adjust', OLD.project_id, label, auth.uid()),
           (NEW.sku_id, NEW.qty, 'adjust', NEW.project_id, label, auth.uid());
  ELSIF NEW.qty <> OLD.qty THEN
    INSERT INTO stock_movements (sku_id, qty, type, project_id, note, created_by)
    VALUES (NEW.sku_id, NEW.qty - OLD.qty, 'adjust', NEW.project_id, label, auth.uid());
  END IF;
  PERFORM refresh_sku_cost_from_purchases(NEW.sku_id);
  IF NEW.sku_id IS DISTINCT FROM OLD.sku_id THEN
    PERFORM refresh_sku_cost_from_purchases(OLD.sku_id);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.purchase_after_update() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_purchases_after_update AFTER UPDATE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.purchase_after_update();
