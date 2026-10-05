CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM public, anon;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

ALTER FUNCTION public.has_role(uuid, public.app_role) SET SCHEMA private;
ALTER FUNCTION public.has_any_role(uuid, public.app_role[]) SET SCHEMA private;
ALTER FUNCTION public.can_see_money(uuid) SET SCHEMA private;
ALTER FUNCTION public.can_view_master(uuid) SET SCHEMA private;
ALTER FUNCTION public.can_edit_master(uuid) SET SCHEMA private;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM public, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_project_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE has_opt boolean;
BEGIN
  IF NEW.released_by = 'ceo' AND (TG_OP = 'INSERT' OR OLD.released_by IS DISTINCT FROM 'ceo')
     AND auth.uid() IS NOT NULL AND NOT private.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'เฉพาะผู้ดูแลระบบเท่านั้นที่เลือก "CEO อนุมัติ" ได้';
  END IF;
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status >= 4 AND NEW.selected_option IS NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM public.quotation_lines l JOIN public.quotations q ON q.id = l.quotation_id
        WHERE q.project_id = NEW.id AND q.is_current AND coalesce(trim(l.option_name),'') <> ''
      ) INTO has_opt;
      IF has_opt THEN
        RAISE EXCEPTION 'ต้องเลือก Option ที่ลูกค้าเลือกก่อนเปลี่ยนสถานะเป็นขั้น 4 ขึ้นไป';
      END IF;
    END IF;
    IF NEW.status >= 6 AND NEW.released_by IS NULL THEN
      RAISE EXCEPTION 'ต้องระบุว่าปล่อยงานจาก "รับมัดจำ" หรือ "CEO อนุมัติ" ก่อนเปลี่ยนสถานะเป็นขั้น 6';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.create_quotation_revision(_project_id uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE cur public.quotations; new_id uuid; next_rev text; l record; new_line uuid;
BEGIN
  IF NOT private.can_see_money(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  SELECT * INTO cur FROM public.quotations WHERE project_id = _project_id AND is_current;
  IF cur.id IS NULL THEN RAISE EXCEPTION 'ไม่พบใบเสนอราคาปัจจุบัน'; END IF;
  SELECT chr(ascii(max(rev)) + 1) INTO next_rev FROM public.quotations WHERE project_id = _project_id;
  UPDATE public.quotations SET is_current = false WHERE id = cur.id;
  INSERT INTO public.quotations(project_id, ref_no, rev, is_current, date, validity_days, delivery_text, notes, discount, vat_percent)
  VALUES (_project_id, cur.ref_no, next_rev, true, CURRENT_DATE, cur.validity_days, cur.delivery_text, cur.notes, cur.discount, cur.vat_percent)
  RETURNING id INTO new_id;
  FOR l IN SELECT * FROM public.quotation_lines WHERE quotation_id = cur.id LOOP
    INSERT INTO public.quotation_lines(quotation_id, line_no, sales_name, description, qty, unit, unit_price, sales_component_id, is_header, option_name)
    VALUES (new_id, l.line_no, l.sales_name, l.description, l.qty, l.unit, l.unit_price, l.sales_component_id, l.is_header, l.option_name)
    RETURNING id INTO new_line;
    INSERT INTO public.line_recipes(quotation_line_id, sku_id, qty_per_unit, note)
    SELECT new_line, sku_id, qty_per_unit, note FROM public.line_recipes WHERE quotation_line_id = l.id;
  END LOOP;
  INSERT INTO public.payment_terms(quotation_id, seq, name, percent, note)
  SELECT new_id, seq, name, percent, note FROM public.payment_terms WHERE quotation_id = cur.id;
  RETURN new_id;
END $$;