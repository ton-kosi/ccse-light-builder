CREATE OR REPLACE FUNCTION private.can_edit_quote(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_any_role(_uid, ARRAY['admin'::app_role, 'sales'::app_role])
$$;
REVOKE ALL ON FUNCTION private.can_edit_quote(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.can_edit_quote(uuid) TO authenticated, service_role;

DROP POLICY "quotations money read" ON public.quotations;
DROP POLICY "quotations money write" ON public.quotations;
CREATE POLICY "quotations read" ON public.quotations FOR SELECT USING (private.can_edit_quote(auth.uid()));
CREATE POLICY "quotations write" ON public.quotations FOR ALL USING (private.can_edit_quote(auth.uid())) WITH CHECK (private.can_edit_quote(auth.uid()));

DROP POLICY "quote_lines money read" ON public.quote_lines;
DROP POLICY "quote_lines money write" ON public.quote_lines;
CREATE POLICY "quote_lines read" ON public.quote_lines FOR SELECT USING (private.can_edit_quote(auth.uid()));
CREATE POLICY "quote_lines write" ON public.quote_lines FOR ALL USING (private.can_edit_quote(auth.uid())) WITH CHECK (private.can_edit_quote(auth.uid()));

CREATE OR REPLACE FUNCTION public.create_quotation_revision(_project_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE cur public.quotations; new_id uuid; next_rev text; l record; new_line uuid;
BEGIN
  IF NOT private.can_edit_quote(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
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
    INSERT INTO public.line_recipes(quote_line_id, sku_id, qty, note)
    SELECT new_line, sku_id, qty, note FROM public.line_recipes WHERE quote_line_id = l.id;
  END LOOP;
  INSERT INTO public.payment_terms(quotation_id, seq, name, percent, note, fixed_amount, "trigger", received, received_date)
  SELECT new_id, seq, name, percent, note, fixed_amount, "trigger", received, received_date FROM public.payment_terms WHERE quotation_id = cur.id;
  RETURN new_id;
END $fn$;
REVOKE ALL ON FUNCTION public.create_quotation_revision(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_quotation_revision(uuid) TO authenticated, service_role;