ALTER TABLE public.projects
  ADD COLUMN attn text,
  ADD COLUMN selected_option text,
  ADD COLUMN released_by text CHECK (released_by IN ('deposit','ceo')),
  ADD COLUMN install_days_min integer,
  ADD COLUMN install_days_max integer,
  ADD COLUMN overrun_rate_per_day numeric,
  ADD COLUMN install_start_date date,
  ADD COLUMN install_days_actual numeric,
  DROP COLUMN deposit_received,
  DROP COLUMN ceo_approved;

ALTER TABLE public.quotations RENAME COLUMN doc_no TO ref_no;
ALTER TABLE public.quotations RENAME COLUMN doc_date TO date;
ALTER TABLE public.quotations DROP COLUMN revision;
ALTER TABLE public.quotations
  ADD COLUMN rev text NOT NULL DEFAULT 'A',
  ADD COLUMN is_current boolean NOT NULL DEFAULT true,
  ADD COLUMN validity_days integer,
  ADD COLUMN delivery_text text;
CREATE UNIQUE INDEX quotations_one_current ON public.quotations(project_id) WHERE is_current;
CREATE UNIQUE INDEX quotations_project_rev ON public.quotations(project_id, rev);

ALTER TABLE public.quotation_lines ADD COLUMN option_name text;

CREATE TABLE public.payment_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  seq integer NOT NULL DEFAULT 1,
  name text NOT NULL,
  percent numeric NOT NULL DEFAULT 0 CHECK (percent >= 0 AND percent <= 100),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_terms TO authenticated;
GRANT ALL ON public.payment_terms TO service_role;
ALTER TABLE public.payment_terms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment_terms money read" ON public.payment_terms FOR SELECT TO authenticated USING (public.can_see_money(auth.uid()));
CREATE POLICY "payment_terms money write" ON public.payment_terms FOR ALL TO authenticated USING (public.can_see_money(auth.uid())) WITH CHECK (public.can_see_money(auth.uid()));
CREATE TRIGGER payment_terms_updated BEFORE UPDATE ON public.payment_terms FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.project_status_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  from_status smallint,
  to_status smallint NOT NULL,
  changed_by uuid DEFAULT auth.uid(),
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.project_status_log TO authenticated;
GRANT ALL ON public.project_status_log TO service_role;
ALTER TABLE public.project_status_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "status log read" ON public.project_status_log FOR SELECT TO authenticated USING (true);

-- Validate status changes
CREATE OR REPLACE FUNCTION public.validate_project_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE has_opt boolean;
BEGIN
  IF NEW.released_by = 'ceo' AND (TG_OP = 'INSERT' OR OLD.released_by IS DISTINCT FROM 'ceo')
     AND auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
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
CREATE TRIGGER projects_validate_status BEFORE INSERT OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.validate_project_status();

CREATE OR REPLACE FUNCTION public.log_project_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.project_status_log(project_id, from_status, to_status, changed_by) VALUES (NEW.id, NULL, NEW.status, auth.uid());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.project_status_log(project_id, from_status, to_status, changed_by) VALUES (NEW.id, OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.log_project_status() FROM public, anon;
CREATE TRIGGER projects_log_status AFTER INSERT OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.log_project_status();

-- New revision
CREATE OR REPLACE FUNCTION public.create_quotation_revision(_project_id uuid)
RETURNS uuid LANGUAGE plpgsql SET search_path = public AS $$
DECLARE cur public.quotations; new_id uuid; next_rev text; l record; new_line uuid;
BEGIN
  IF NOT public.can_see_money(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
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
REVOKE EXECUTE ON FUNCTION public.create_quotation_revision(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_quotation_revision(uuid) TO authenticated;