-- Fixes from the real CCSE files (PRD 5c): working-day overrun, people × days schedule,
-- WOS print fields, "length × sets" measurements. Additive only.

-- 1. Public holidays + working days --------------------------------------------------
CREATE TABLE public.public_holidays (
  day date PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.public_holidays TO authenticated;
GRANT ALL ON public.public_holidays TO service_role;
ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "holidays read" ON public.public_holidays FOR SELECT TO authenticated
  USING (private.has_any_app_role(auth.uid()));
CREATE POLICY "holidays write" ON public.public_holidays FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin')) WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- working days between two dates, both counted: Monday–Friday that are not public holidays
-- (quotations: "วันทำงานปกติ มิใช่วันหยุดนักขัตฤกษ์หรือวันเสาร์-อาทิตย์")
CREATE OR REPLACE FUNCTION private.working_days(_from date, _to date) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int FROM generate_series(_from, _to, interval '1 day') d
  WHERE extract(isodow FROM d) < 6
    AND NOT EXISTS (SELECT 1 FROM public_holidays h WHERE h.day = d::date)
$$;
REVOKE ALL ON FUNCTION private.working_days(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.working_days(date, date) TO authenticated, service_role;

-- handover: actual install days are now working days
CREATE OR REPLACE FUNCTION public.handover_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w record; p record; still_open boolean;
BEGIN
  SELECT * INTO w FROM work_orders WHERE id = NEW.work_order_id;
  IF w.status IN ('released','in_progress') THEN
    UPDATE work_orders SET status = 'done' WHERE id = w.id;
  END IF;
  IF w.wo_type = 'installation' THEN
    SELECT EXISTS (
      SELECT 1 FROM work_orders o
      WHERE o.project_id = w.project_id AND o.wo_type = 'installation' AND o.id <> w.id
        AND o.status NOT IN ('done','cancelled')
    ) INTO still_open;
    IF NOT still_open THEN
      SELECT * INTO p FROM projects WHERE id = w.project_id;
      UPDATE projects SET
        install_days_actual = CASE
          WHEN p.install_start_date IS NOT NULL AND NEW.handover_date >= p.install_start_date
          THEN private.working_days(p.install_start_date, NEW.handover_date)
          ELSE install_days_actual END,
        status = CASE WHEN p.status BETWEEN 6 AND 8 THEN 9 ELSE status END
      WHERE id = w.project_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- 2. WOS header fields ----------------------------------------------------------------
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS site_contacts text;   -- "K.จอม : 080-884-6759"
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS schedule_note text;   -- "ประกอบ 17/9/69 ติดตั้ง สิ้นด.9"

-- 3. "length × sets" as typed: 0.682x2 + [3.015+3.515]x2 ------------------------------
ALTER TABLE public.site_measurements ADD COLUMN IF NOT EXISTS cut_spec text;

-- new Rev also copies cut_spec (same function as 0013 + one column)
CREATE OR REPLACE FUNCTION private.create_quotation_revision(_project_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE cur public.quotations; new_id uuid; next_rev text; l record; new_line uuid;
BEGIN
  IF NOT private.can_edit_quote(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  SELECT * INTO cur FROM public.quotations WHERE project_id = _project_id AND is_current;
  IF cur.id IS NULL THEN RAISE EXCEPTION 'ไม่พบใบเสนอราคาปัจจุบัน'; END IF;
  SELECT chr(ascii(max(rev)) + 1) INTO next_rev FROM public.quotations WHERE project_id = _project_id;
  UPDATE public.quotations SET is_current = false WHERE id = cur.id;
  INSERT INTO public.quotations(project_id, ref_no, rev, is_current, date, validity_days, delivery_text, notes, discount, vat_percent, closing_text, signer_user_id, signer_name, signer_position, vat_mode, adjustments, company_id)
  VALUES (_project_id, cur.ref_no, next_rev, true, CURRENT_DATE, cur.validity_days, cur.delivery_text, cur.notes, cur.discount, cur.vat_percent, cur.closing_text, cur.signer_user_id, cur.signer_name, cur.signer_position, cur.vat_mode, cur.adjustments, cur.company_id)
  RETURNING id INTO new_id;
  PERFORM set_config('ccse.copy_measurements', 'on', true);
  FOR l IN SELECT * FROM public.quote_lines WHERE quotation_id = cur.id LOOP
    INSERT INTO public.quote_lines(quotation_id, sort_order, option_name, zone, item_no, kind, component_id, customer_text, circuit_note, cut_lengths, qty, unit, unit_price, discount_percent)
    VALUES (new_id, l.sort_order, l.option_name, l.zone, l.item_no, l.kind, l.component_id, l.customer_text, l.circuit_note, l.cut_lengths, l.qty, l.unit, l.unit_price, l.discount_percent)
    RETURNING id INTO new_line;
    INSERT INTO public.line_recipes(quote_line_id, sku_id, qty, note)
    SELECT new_line, sku_id, qty, note FROM public.line_recipes WHERE quote_line_id = l.id;
    INSERT INTO public.site_measurements(quote_line_id, project_id, work_order_id, measured_qty, cut_lengths, cut_spec, note, measured_by, measured_at)
    SELECT new_line, project_id, work_order_id, measured_qty, cut_lengths, cut_spec, note, measured_by, measured_at
      FROM public.site_measurements WHERE quote_line_id = l.id;
  END LOOP;
  PERFORM set_config('ccse.copy_measurements', 'off', true);
  INSERT INTO public.quotation_clauses(quotation_id, clause_id, section, text, sort_order, included, edited, is_new)
  SELECT new_id, clause_id, section, text, sort_order, included, edited, is_new FROM public.quotation_clauses WHERE quotation_id = cur.id;
  INSERT INTO public.payment_terms(quotation_id, seq, name, percent, note, fixed_amount, "trigger", received, received_date, print_label, is_balance)
  SELECT new_id, seq, name, percent, note, fixed_amount, coalesce("trigger", 'progress'), received, received_date, print_label, is_balance FROM public.payment_terms WHERE quotation_id = cur.id;
  PERFORM set_config('ccse.skip_payment_audit', 'on', true);
  UPDATE public.billing_docs b SET term_id = nt.id
    FROM public.payment_terms ot JOIN public.payment_terms nt ON nt.quotation_id = new_id AND nt.seq = ot.seq
    WHERE ot.quotation_id = cur.id AND b.term_id = ot.id;
  UPDATE public.payment_receipts r SET term_id = nt.id
    FROM public.payment_terms ot JOIN public.payment_terms nt ON nt.quotation_id = new_id AND nt.seq = ot.seq
    WHERE ot.quotation_id = cur.id AND r.term_id = ot.id;
  UPDATE public.payment_audit_log a SET term_id = nt.id
    FROM public.payment_terms ot JOIN public.payment_terms nt ON nt.quotation_id = new_id AND nt.seq = ot.seq
    WHERE ot.quotation_id = cur.id AND a.term_id = ot.id;
  PERFORM set_config('ccse.skip_payment_audit', 'off', true);
  RETURN new_id;
END $function$;
REVOKE ALL ON FUNCTION private.create_quotation_revision(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.create_quotation_revision(uuid) TO authenticated, service_role;

-- 4. Crews: technicians do not need a login to be scheduled ---------------------------
CREATE TABLE public.crew_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL CHECK (trim(display_name) <> ''),   -- "K.แขก"
  crew text,                                                     -- colour group on the schedule
  sort_order integer NOT NULL DEFAULT 0,
  user_id uuid UNIQUE,                                           -- optional login (the user's id; no FK to auth)
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crew_members TO authenticated;
GRANT ALL ON public.crew_members TO service_role;
ALTER TABLE public.crew_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crew read" ON public.crew_members FOR SELECT TO authenticated
  USING (private.has_any_app_role(auth.uid()));
CREATE POLICY "crew write" ON public.crew_members FOR ALL TO authenticated
  USING (private.can_plan_work(auth.uid())) WITH CHECK (private.can_plan_work(auth.uid()));

-- who works on a job (replaces work_order_assignees, which needed a login per person)
CREATE TABLE public.work_order_crew (
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_order_id, member_id)
);
CREATE INDEX work_order_crew_member_idx ON public.work_order_crew (member_id);
GRANT SELECT, INSERT, DELETE ON public.work_order_crew TO authenticated;
GRANT ALL ON public.work_order_crew TO service_role;
ALTER TABLE public.work_order_crew ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wo crew read" ON public.work_order_crew FOR SELECT TO authenticated
  USING (private.has_any_app_role(auth.uid()));
CREATE POLICY "wo crew insert" ON public.work_order_crew FOR INSERT TO authenticated
  WITH CHECK (private.can_plan_work(auth.uid()));
CREATE POLICY "wo crew delete" ON public.work_order_crew FOR DELETE TO authenticated
  USING (private.can_plan_work(auth.uid()));

-- schedule cells that are not a project job: workshop (CCSE ชั้น4), off (พัก), other
CREATE TABLE public.schedule_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  date_from date NOT NULL,
  date_to date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('workshop','off','other')),
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (date_to >= date_from)
);
CREATE INDEX schedule_entries_dates_idx ON public.schedule_entries (date_from, date_to);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_entries TO authenticated;
GRANT ALL ON public.schedule_entries TO service_role;
ALTER TABLE public.schedule_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "schedule read" ON public.schedule_entries FOR SELECT TO authenticated
  USING (private.has_any_app_role(auth.uid()));
CREATE POLICY "schedule write" ON public.schedule_entries FOR ALL TO authenticated
  USING (private.can_plan_work(auth.uid())) WITH CHECK (private.can_plan_work(auth.uid()));
