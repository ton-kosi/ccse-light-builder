-- Phase B: measure on site → production → final Rev → final bill (workflow steps 5, 6).
-- * site_measurements: measured qty / cut lengths per BOQ line (no prices; all staff)
-- * a new Rev carries the measurements and the balance flag over to the new lines/terms
-- * create_final_revision: new Rev whose qty / cut lengths come from the measurements
-- * payment_terms.is_balance: the term bills "total − all other terms" (final bill after re-measure)
-- Additive: existing data is not changed.

-- 1. Measurements -----------------------------------------------------------------
CREATE TABLE public.site_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_line_id uuid NOT NULL UNIQUE REFERENCES public.quote_lines(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  work_order_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  measured_qty numeric CHECK (measured_qty IS NULL OR measured_qty >= 0),
  cut_lengths numeric[] CHECK (cut_lengths IS NULL OR 0 < ALL (cut_lengths)),
  note text,
  measured_by uuid DEFAULT auth.uid(),
  measured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_measurements_project_idx ON public.site_measurements (project_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_measurements TO authenticated;
GRANT ALL ON public.site_measurements TO service_role;
ALTER TABLE public.site_measurements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "measurements read" ON public.site_measurements FOR SELECT TO authenticated
  USING (private.has_any_app_role(auth.uid()));
CREATE POLICY "measurements insert" ON public.site_measurements FOR INSERT TO authenticated
  WITH CHECK (private.has_any_app_role(auth.uid()));
CREATE POLICY "measurements update" ON public.site_measurements FOR UPDATE TO authenticated
  USING (private.has_any_app_role(auth.uid())) WITH CHECK (private.has_any_app_role(auth.uid()));
CREATE POLICY "measurements delete" ON public.site_measurements FOR DELETE TO authenticated
  USING (private.has_any_app_role(auth.uid()));

-- project follows the line; who / when is stamped on every user save
CREATE OR REPLACE FUNCTION public.site_measurement_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT q.project_id INTO NEW.project_id
    FROM quote_lines l JOIN quotations q ON q.id = l.quotation_id WHERE l.id = NEW.quote_line_id;
  IF NEW.project_id IS NULL THEN RAISE EXCEPTION 'ไม่พบรายการ BOQ'; END IF;
  -- a copy into a new Rev keeps who measured and when; every user save is stamped now
  IF coalesce(current_setting('ccse.copy_measurements', true), '') <> 'on' THEN
    NEW.measured_by := auth.uid();
    NEW.measured_at := now();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.site_measurement_before() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_site_measurements_before BEFORE INSERT OR UPDATE ON public.site_measurements
  FOR EACH ROW EXECUTE FUNCTION public.site_measurement_before();

-- 2. Balance term -------------------------------------------------------------------
ALTER TABLE public.payment_terms ADD COLUMN IF NOT EXISTS is_balance boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS payment_terms_one_balance
  ON public.payment_terms (quotation_id) WHERE is_balance;

-- 3. New Rev: the full copy as before + measurements + balance flag -------------------
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
    -- measurements follow the line into the new Rev (kept on the old line as history)
    INSERT INTO public.site_measurements(quote_line_id, project_id, work_order_id, measured_qty, cut_lengths, note, measured_by, measured_at)
    SELECT new_line, project_id, work_order_id, measured_qty, cut_lengths, note, measured_by, measured_at
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

-- 4. Final Rev from measurements ----------------------------------------------------
CREATE OR REPLACE FUNCTION private.create_final_revision(_project_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE new_id uuid; n int;
BEGIN
  IF NOT private.can_edit_quote(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  SELECT count(*) INTO n FROM site_measurements m
    JOIN quote_lines l ON l.id = m.quote_line_id JOIN quotations q ON q.id = l.quotation_id
    WHERE q.project_id = _project_id AND q.is_current;
  IF n = 0 THEN RAISE EXCEPTION 'ยังไม่มีค่าที่วัดหน้างานในใบเสนอราคาปัจจุบัน'; END IF;
  new_id := private.create_quotation_revision(_project_id);
  -- measured values become the quantities of the new Rev
  UPDATE quote_lines l SET
    qty = coalesce(m.measured_qty, l.qty),
    cut_lengths = coalesce(m.cut_lengths, l.cut_lengths)
  FROM site_measurements m
  WHERE m.quote_line_id = l.id AND l.quotation_id = new_id;
  -- the last term becomes the balance, so the final bill closes the job exactly
  IF NOT EXISTS (SELECT 1 FROM payment_terms WHERE quotation_id = new_id AND is_balance) THEN
    UPDATE payment_terms SET is_balance = true
    WHERE id = (SELECT id FROM payment_terms WHERE quotation_id = new_id ORDER BY seq DESC LIMIT 1);
  END IF;
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION private.create_final_revision(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.create_final_revision(uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.create_final_revision(_project_id uuid)
RETURNS uuid LANGUAGE sql SET search_path TO 'public' AS $$ SELECT private.create_final_revision(_project_id) $$;
REVOKE EXECUTE ON FUNCTION public.create_final_revision(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_final_revision(uuid) TO authenticated;

-- 5. Payment schedule: balance term = total − every other term ----------------------
CREATE OR REPLACE FUNCTION private.payment_schedule(_project_id uuid)
 RETURNS TABLE(id uuid, project_id uuid, project_code text, project_name text, project_status smallint, quotation_id uuid, ref_no text, rev text, seq integer, name text, percent numeric, fixed_amount numeric, trigger text, received boolean, received_date date, note text, net_total numeric, amount numeric, due_status text, due_since timestamptz,
   bill_id uuid, bill_no text, bill_date date, credit_days integer, due_date date, received_total numeric, wht_total numeric, outstanding numeric, days_overdue integer, last_received_date date)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT private.can_manage_payments(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  RETURN QUERY
  WITH raw AS (
    SELECT t.id, p.id AS pid, p.code, p.name AS pname, p.status, pq.quotation_id, pq.ref_no, pq.rev, t.seq, t.name, t.percent,
      t.fixed_amount, t."trigger", t.received, t.received_date, t.note, pq.net_total, t.is_balance,
      coalesce(b.grand_total, t.fixed_amount, round(pq.net_total * t.percent / 100, 2)) AS own_amt,
      b.grand_total AS billed_total,
      (SELECT min(sl.changed_at) FROM project_status_log sl WHERE sl.project_id = p.id AND sl.to_status >= private.trigger_status(t."trigger")) AS dsince,
      b.id AS bid, b.doc_no AS bill_no, b.bill_date, b.credit_days, b.due_date,
      coalesce(r.rec, 0) AS rec, coalesce(r.wht, 0) AS wht, r.last_date, coalesce(r.cnt,0) AS cnt,
      coalesce(private.trigger_status(t."trigger") IS NOT NULL AND p.status >= private.trigger_status(t."trigger"), false) AS reached
    FROM private.payment_quote(_project_id) pq
    JOIN quotations q ON q.id = pq.quotation_id
    JOIN projects p ON p.id = q.project_id
    JOIN payment_terms t ON t.quotation_id = pq.quotation_id
    LEFT JOIN billing_docs b ON b.term_id = t.id AND b.cancelled_at IS NULL
    LEFT JOIN LATERAL (SELECT sum(x.amount) rec, sum(x.wht_amount) wht, max(x.received_date) last_date, count(*) cnt
      FROM payment_receipts x WHERE x.term_id = t.id AND x.voided_at IS NULL) r ON true
  ), base AS (
    SELECT raw.*,
      CASE WHEN raw.is_balance AND raw.billed_total IS NULL
        THEN greatest(raw.net_total - coalesce((SELECT sum(o.own_amt) FROM raw o
               WHERE o.quotation_id = raw.quotation_id AND o.id <> raw.id), 0), 0)
        ELSE raw.own_amt END AS amt
    FROM raw
  ), s AS (
    SELECT base.*, ((base.received AND base.cnt = 0) OR (base.cnt > 0 AND base.rec + base.wht >= base.amt)) AS paid FROM base
  )
  SELECT s.id, s.pid, s.code, s.pname, s.status, s.quotation_id, s.ref_no, s.rev, s.seq, s.name, s.percent, s.fixed_amount, s."trigger",
    s.received, s.received_date, s.note, s.net_total, s.amt,
    CASE
      WHEN s.paid THEN 'paid'
      WHEN s.due_date IS NOT NULL AND s.due_date < CURRENT_DATE THEN 'overdue'
      WHEN s.cnt > 0 THEN 'partial'
      WHEN s.bid IS NOT NULL THEN 'billed'
      WHEN s."trigger" = 'progress' THEN 'check_progress'
      WHEN s.reached THEN 'to_bill'
      ELSE 'not_yet' END,
    s.dsince, s.bid, s.bill_no, s.bill_date, s.credit_days, s.due_date, s.rec, s.wht,
    CASE WHEN s.paid THEN 0::numeric ELSE greatest(s.amt - s.rec - s.wht, 0) END,
    CASE WHEN NOT s.paid AND s.due_date IS NOT NULL AND s.due_date < CURRENT_DATE THEN (CURRENT_DATE - s.due_date) ELSE NULL END,
    s.last_date
  FROM s
  ORDER BY s.code, s.seq;
END $$;

-- 6. Issue a bill: the balance term bills what is left of the total (incl. VAT) --------
CREATE OR REPLACE FUNCTION private.issue_billing_doc(_term_id uuid, _bill_date date, _credit_days integer, _wht_percent numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t payment_terms; q quotations; p projects; c customers; co companies;
  ex numeric; vatp numeric; pre numeric; vat numeric; whtp numeric; wht numeric; n int; no text; lbl text; new_id uuid;
  net_incl numeric; others numeric;
BEGIN
  IF NOT private.can_manage_payments(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  SELECT * INTO t FROM payment_terms WHERE id = _term_id;
  IF t.id IS NULL THEN RAISE EXCEPTION 'ไม่พบงวดเงิน'; END IF;
  SELECT * INTO q FROM quotations WHERE id = t.quotation_id;
  IF NOT q.is_current THEN RAISE EXCEPTION 'งวดนี้ไม่ได้อยู่ในใบเสนอราคาปัจจุบัน'; END IF;
  IF EXISTS (SELECT 1 FROM billing_docs WHERE term_id = _term_id AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'งวดนี้ออกใบเบิกเงินแล้ว (ยกเลิกใบเดิมก่อนจึงออกใหม่ได้)'; END IF;
  IF _bill_date IS NULL OR coalesce(_credit_days, -1) < 0 THEN RAISE EXCEPTION 'วันที่หรือเครดิตไม่ถูกต้อง'; END IF;
  SELECT * INTO p FROM projects WHERE id = q.project_id;
  SELECT * INTO c FROM customers WHERE id = p.customer_id;
  SELECT * INTO co FROM companies WHERE id = q.company_id;
  ex := private.quote_ex_vat(q.id);
  vatp := coalesce(q.vat_percent, 7);
  IF t.is_balance THEN
    net_incl := round(ex * (1 + vatp/100), 2);
    SELECT coalesce(sum(coalesce(b.grand_total, o.fixed_amount, round(net_incl * o.percent / 100, 2))), 0) INTO others
      FROM payment_terms o LEFT JOIN billing_docs b ON b.term_id = o.id AND b.cancelled_at IS NULL
      WHERE o.quotation_id = t.quotation_id AND o.id <> t.id;
    IF net_incl - others <= 0 THEN RAISE EXCEPTION 'ไม่มียอดคงเหลือให้เบิกในงวดนี้'; END IF;
    pre := round((net_incl - others) / (1 + vatp/100), 2);
  ELSE
    pre := CASE WHEN t.fixed_amount IS NOT NULL THEN round(t.fixed_amount / (1 + vatp/100), 2)
                ELSE round(ex * t.percent / 100, 2) END;
  END IF;
  vat := round(pre * vatp / 100, 2);
  whtp := coalesce(_wht_percent, co.default_wht_percent, 0);
  IF whtp < 0 OR whtp > 15 THEN RAISE EXCEPTION 'ภาษีหัก ณ ที่จ่ายไม่ถูกต้อง'; END IF;
  wht := round(pre * whtp / 100, 2);
  lbl := CASE t."trigger" WHEN 'deposit' THEN 'DEPOSIT' WHEN 'before_delivery' THEN 'BEFORE DELIVERY'
    WHEN 'material_on_site' THEN 'MATERIAL ON SITE' WHEN 'after_delivery' THEN 'AFTER DELIVERY'
    WHEN 'substantial_completion' THEN 'SUBSTANTIAL COMPLETION' ELSE '' END;
  INSERT INTO billing_day_counters(day, last_no) VALUES (_bill_date, 1)
    ON CONFLICT (day) DO UPDATE SET last_no = billing_day_counters.last_no + 1 RETURNING last_no INTO n;
  no := lpad(((extract(year FROM _bill_date)::int + 543) % 100)::text, 2, '0') || '-' || to_char(_bill_date, 'MMDD') || lpad(n::text, 2, '0');
  INSERT INTO billing_docs(doc_no, term_id, project_id, quotation_id, bill_date, credit_days, description,
    customer_name, customer_address, attn, project_name, quotation_ref, quotation_rev, po_number,
    vat_percent, amount, vat_amount, grand_total, created_by,
    company_id, term_seq, term_label, term_percent, quote_total_ex_vat, request_amount, deduct_amount,
    wht_percent, wht_amount, net_payment, customer_tax_id, customer_branch)
  VALUES (no, t.id, p.id, q.id, _bill_date, _credit_days,
    trim('PAYMENT ' || t.seq || ' ' || lbl) ||
      CASE WHEN t.is_balance THEN ' (BALANCE)'
           WHEN t.fixed_amount IS NULL THEN ' (' || trim(to_char(t.percent, 'FM999990.##')) || '% x ' || trim(to_char(ex, 'FM999,999,999,990.00')) || ')'
           ELSE '' END,
    c.name, c.address, p.attn, p.name, q.ref_no, q.rev, p.po_number,
    vatp, pre, vat, pre + vat, auth.uid(),
    q.company_id, t.seq, lbl, CASE WHEN t.fixed_amount IS NULL AND NOT t.is_balance THEN t.percent END, ex, pre, 0,
    whtp, wht, pre + vat - wht, c.tax_id, c.branch)
  RETURNING id INTO new_id;
  INSERT INTO payment_audit_log(entity, entity_id, term_id, action, data, changed_by)
  SELECT 'billing_docs', d.id, d.term_id, 'bill', to_jsonb(d), auth.uid() FROM billing_docs d WHERE d.id = new_id;
  RETURN new_id;
END $$;
