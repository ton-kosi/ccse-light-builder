ALTER TABLE public.line_recipes DROP CONSTRAINT line_recipes_quotation_line_id_fkey;
DROP TABLE public.quotation_lines;

CREATE TABLE public.quote_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  option_name text,
  zone text,
  item_no text,
  kind text NOT NULL DEFAULT 'priced' CHECK (kind IN ('heading','priced','display','foc','by_buyer','existing')),
  component_id uuid REFERENCES public.sales_components(id) ON DELETE SET NULL,
  customer_text text,
  circuit_note text,
  cut_lengths numeric[],
  qty numeric,
  unit text,
  unit_price numeric,
  discount_percent numeric NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quote_lines_q_idx ON public.quote_lines(quotation_id, sort_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_lines TO authenticated;
GRANT ALL ON public.quote_lines TO service_role;
ALTER TABLE public.quote_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quote_lines money read" ON public.quote_lines FOR SELECT TO authenticated USING (private.can_see_money(auth.uid()));
CREATE POLICY "quote_lines money write" ON public.quote_lines FOR ALL TO authenticated USING (private.can_see_money(auth.uid())) WITH CHECK (private.can_see_money(auth.uid()));
CREATE TRIGGER trg_quote_lines_updated BEFORE UPDATE ON public.quote_lines FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.line_recipes RENAME COLUMN quotation_line_id TO quote_line_id;
ALTER TABLE public.line_recipes ADD CONSTRAINT line_recipes_quote_line_id_fkey FOREIGN KEY (quote_line_id) REFERENCES public.quote_lines(id) ON DELETE CASCADE;

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
        SELECT 1 FROM public.quote_lines l JOIN public.quotations q ON q.id = l.quotation_id
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
  FOR l IN SELECT * FROM public.quote_lines WHERE quotation_id = cur.id LOOP
    INSERT INTO public.quote_lines(quotation_id, sort_order, option_name, zone, item_no, kind, component_id, customer_text, circuit_note, cut_lengths, qty, unit, unit_price, discount_percent)
    VALUES (new_id, l.sort_order, l.option_name, l.zone, l.item_no, l.kind, l.component_id, l.customer_text, l.circuit_note, l.cut_lengths, l.qty, l.unit, l.unit_price, l.discount_percent)
    RETURNING id INTO new_line;
    INSERT INTO public.line_recipes(quote_line_id, sku_id, qty_per_unit, note)
    SELECT new_line, sku_id, qty_per_unit, note FROM public.line_recipes WHERE quote_line_id = l.id;
  END LOOP;
  INSERT INTO public.payment_terms(quotation_id, seq, name, percent, note)
  SELECT new_id, seq, name, percent, note FROM public.payment_terms WHERE quotation_id = cur.id;
  RETURN new_id;
END $$;