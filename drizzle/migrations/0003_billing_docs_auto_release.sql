
ALTER TABLE public.settings
  ADD COLUMN bank_name text, ADD COLUMN bank_branch text,
  ADD COLUMN bank_account_name text, ADD COLUMN bank_account_no text;

CREATE TABLE public.billing_counters (year integer PRIMARY KEY, last_no integer NOT NULL DEFAULT 0);
GRANT ALL ON public.billing_counters TO service_role;
ALTER TABLE public.billing_counters ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.billing_docs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no text NOT NULL UNIQUE,
  term_id uuid NOT NULL REFERENCES public.payment_terms(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL REFERENCES public.projects(id),
  quotation_id uuid NOT NULL REFERENCES public.quotations(id),
  bill_date date NOT NULL,
  credit_days integer NOT NULL DEFAULT 15 CHECK (credit_days >= 0),
  due_date date GENERATED ALWAYS AS (bill_date + credit_days) STORED,
  description text NOT NULL,
  customer_name text, customer_address text, attn text, project_name text,
  quotation_ref text, quotation_rev text, po_number text,
  vat_percent numeric NOT NULL DEFAULT 7,
  amount numeric NOT NULL,
  vat_amount numeric NOT NULL,
  grand_total numeric NOT NULL,
  pdf_path text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text
);
CREATE UNIQUE INDEX billing_docs_one_active ON public.billing_docs(term_id) WHERE cancelled_at IS NULL;
CREATE INDEX billing_docs_project_idx ON public.billing_docs(project_id);
GRANT SELECT ON public.billing_docs TO authenticated;
GRANT UPDATE (pdf_path) ON public.billing_docs TO authenticated;
GRANT ALL ON public.billing_docs TO service_role;
ALTER TABLE public.billing_docs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing docs read" ON public.billing_docs FOR SELECT TO authenticated USING (private.can_manage_payments(auth.uid()));
CREATE POLICY "billing docs pdf" ON public.billing_docs FOR UPDATE TO authenticated USING (private.can_manage_payments(auth.uid())) WITH CHECK (private.can_manage_payments(auth.uid()));

CREATE OR REPLACE FUNCTION private.issue_billing_doc(_term_id uuid, _bill_date date, _credit_days integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t payment_terms; q quotations; p projects; c customers; pq record; yr int; n int; no text; amt numeric; vatp numeric; pre numeric; new_id uuid;
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
  SELECT * INTO pq FROM private.payment_quote(p.id);
  amt := coalesce(t.fixed_amount, round(pq.net_total * t.percent / 100, 2));
  vatp := coalesce(q.vat_percent, 7);
  pre := round(amt / (1 + vatp/100), 2);
  yr := extract(year FROM _bill_date)::int;
  INSERT INTO billing_counters(year, last_no) VALUES (yr, 1)
    ON CONFLICT (year) DO UPDATE SET last_no = billing_counters.last_no + 1 RETURNING last_no INTO n;
  no := 'BL' || lpad((yr % 100)::text, 2, '0') || '-' || lpad(n::text, 4, '0');
  INSERT INTO billing_docs(doc_no, term_id, project_id, quotation_id, bill_date, credit_days, description,
    customer_name, customer_address, attn, project_name, quotation_ref, quotation_rev, po_number,
    vat_percent, amount, vat_amount, grand_total, created_by)
  VALUES (no, t.id, p.id, q.id, _bill_date, _credit_days,
    'งวดที่ ' || t.seq || ' ' || t.name ||
      CASE WHEN t.fixed_amount IS NULL THEN ' ' || trim(to_char(t.percent, 'FM999990.##')) || '%' ELSE '' END ||
      ' ตามใบเสนอราคา ' || q.ref_no || CASE WHEN q.rev <> 'A' THEN ' Rev ' || q.rev ELSE '' END,
    c.name, c.address, p.attn, p.name, q.ref_no, q.rev, p.po_number,
    vatp, pre, amt - pre, amt, auth.uid())
  RETURNING id INTO new_id;
  INSERT INTO payment_audit_log(entity, entity_id, term_id, action, data, changed_by)
  SELECT 'billing_docs', d.id, d.term_id, 'bill', to_jsonb(d), auth.uid() FROM billing_docs d WHERE d.id = new_id;
  RETURN new_id;
END $$;
CREATE OR REPLACE FUNCTION public.issue_billing_doc(_term_id uuid, _bill_date date, _credit_days integer)
RETURNS uuid LANGUAGE sql SET search_path TO 'public' AS $$ SELECT private.issue_billing_doc(_term_id, _bill_date, _credit_days) $$;

CREATE OR REPLACE FUNCTION private.cancel_billing_doc(_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT private.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'ยกเลิกใบเบิกเงินได้เฉพาะผู้ดูแลระบบ'; END IF;
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'ต้องระบุเหตุผลในการยกเลิก'; END IF;
  UPDATE billing_docs SET cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(_reason)
    WHERE id = _id AND cancelled_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบใบเบิกเงิน'; END IF;
  INSERT INTO payment_audit_log(entity, entity_id, term_id, action, data, changed_by)
  SELECT 'billing_docs', d.id, d.term_id, 'bill_cancel', to_jsonb(d), auth.uid() FROM billing_docs d WHERE d.id = _id;
END $$;
CREATE OR REPLACE FUNCTION public.cancel_billing_doc(_id uuid, _reason text)
RETURNS void LANGUAGE sql SET search_path TO 'public' AS $$ SELECT private.cancel_billing_doc(_id, _reason) $$;

REVOKE EXECUTE ON FUNCTION public.issue_billing_doc(uuid, date, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.cancel_billing_doc(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION private.issue_billing_doc(uuid, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION private.cancel_billing_doc(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_billing_doc(uuid, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_billing_doc(uuid, text) TO authenticated;

-- schedule now reads billing_docs
CREATE OR REPLACE FUNCTION private.payment_schedule(_project_id uuid)
 RETURNS TABLE(id uuid, project_id uuid, project_code text, project_name text, project_status smallint, quotation_id uuid, ref_no text, rev text, seq integer, name text, percent numeric, fixed_amount numeric, trigger text, received boolean, received_date date, note text, net_total numeric, amount numeric, due_status text, due_since timestamptz,
   bill_id uuid, bill_no text, bill_date date, credit_days integer, due_date date, received_total numeric, wht_total numeric, outstanding numeric, days_overdue integer, last_received_date date)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT private.can_manage_payments(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  RETURN QUERY
  WITH base AS (
    SELECT t.id, p.id AS pid, p.code, p.name AS pname, p.status, pq.quotation_id, pq.ref_no, pq.rev, t.seq, t.name, t.percent,
      t.fixed_amount, t."trigger", t.received, t.received_date, t.note, pq.net_total,
      coalesce(t.fixed_amount, round(pq.net_total * t.percent / 100, 2)) AS amt,
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
COMMENT ON TABLE public.payment_billings IS 'DEPRECATED: replaced by billing_docs';

-- automatic release when all deposit terms are fully paid
CREATE OR REPLACE FUNCTION private.auto_release_on_deposit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE pid uuid; st smallint; unpaid int; dep int;
BEGIN
  SELECT q.project_id INTO pid FROM payment_terms t JOIN quotations q ON q.id = t.quotation_id
    WHERE t.id = NEW.term_id AND q.is_current;
  IF pid IS NULL THEN RETURN NEW; END IF;
  SELECT status INTO st FROM projects WHERE id = pid;
  IF st >= 6 THEN RETURN NEW; END IF;
  SELECT count(*) FILTER (WHERE s."trigger" = 'deposit'),
         count(*) FILTER (WHERE s."trigger" = 'deposit' AND s.due_status <> 'paid')
    INTO dep, unpaid FROM private.payment_schedule(pid) s;
  IF dep = 0 OR unpaid > 0 THEN RETURN NEW; END IF;
  BEGIN
    UPDATE projects SET status = 6, released_by = 'deposit' WHERE id = pid;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'auto release skipped: %', SQLERRM;
  END;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payment_receipts_auto_release AFTER INSERT OR UPDATE ON public.payment_receipts
  FOR EACH ROW EXECUTE FUNCTION private.auto_release_on_deposit();

-- trigger condition required for new/edited terms
ALTER TABLE public.payment_terms ADD CONSTRAINT payment_terms_trigger_required CHECK ("trigger" IS NOT NULL) NOT VALID;

-- revision copy: billing docs follow the term
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
  SELECT new_id, seq, name, percent, note, fixed_amount, coalesce("trigger", 'progress'), received, received_date FROM public.payment_terms WHERE quotation_id = cur.id;
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

-- names (or email) for staff, used by history views
CREATE OR REPLACE FUNCTION public.user_display_names(_ids uuid[])
RETURNS TABLE(id uuid, display_name text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT u.id, coalesce(nullif(trim(p.full_name), ''), u.email::text)
  FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = ANY(_ids) AND private.has_any_app_role(auth.uid())
$$;
REVOKE EXECUTE ON FUNCTION public.user_display_names(uuid[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.user_display_names(uuid[]) TO authenticated;

CREATE POLICY "billing pdf update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'payment-slips' AND private.can_manage_payments(auth.uid()));
