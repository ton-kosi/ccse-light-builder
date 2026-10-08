
CREATE TABLE public.payment_billings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term_id uuid NOT NULL UNIQUE REFERENCES public.payment_terms(id) ON DELETE CASCADE,
  bill_no text NOT NULL,
  bill_date date NOT NULL,
  credit_days integer NOT NULL DEFAULT 15 CHECK (credit_days >= 0),
  due_date date GENERATED ALWAYS AS (bill_date + credit_days) STORED,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.payment_billings TO authenticated;
GRANT ALL ON public.payment_billings TO service_role;
ALTER TABLE public.payment_billings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billings read" ON public.payment_billings FOR SELECT TO authenticated USING (private.can_manage_payments(auth.uid()));
CREATE POLICY "billings insert" ON public.payment_billings FOR INSERT TO authenticated WITH CHECK (private.can_manage_payments(auth.uid()));
CREATE POLICY "billings update" ON public.payment_billings FOR UPDATE TO authenticated USING (private.can_manage_payments(auth.uid())) WITH CHECK (private.can_manage_payments(auth.uid()));

CREATE TABLE public.payment_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term_id uuid NOT NULL REFERENCES public.payment_terms(id) ON DELETE CASCADE,
  received_date date NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  method text NOT NULL CHECK (method IN ('transfer','cheque','cash')),
  bank_ref text,
  wht_amount numeric NOT NULL DEFAULT 0 CHECK (wht_amount >= 0),
  slip_path text,
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text
);
CREATE INDEX payment_receipts_term_idx ON public.payment_receipts(term_id);
GRANT SELECT, INSERT ON public.payment_receipts TO authenticated;
GRANT ALL ON public.payment_receipts TO service_role;
ALTER TABLE public.payment_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "receipts read" ON public.payment_receipts FOR SELECT TO authenticated USING (private.can_manage_payments(auth.uid()));
CREATE POLICY "receipts insert" ON public.payment_receipts FOR INSERT TO authenticated WITH CHECK (private.can_manage_payments(auth.uid()) AND voided_at IS NULL);

CREATE TABLE public.payment_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity text NOT NULL,
  entity_id uuid NOT NULL,
  term_id uuid,
  action text NOT NULL,
  data jsonb,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_audit_term_idx ON public.payment_audit_log(term_id);
GRANT SELECT ON public.payment_audit_log TO authenticated;
GRANT ALL ON public.payment_audit_log TO service_role;
ALTER TABLE public.payment_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit read" ON public.payment_audit_log FOR SELECT TO authenticated USING (private.can_manage_payments(auth.uid()));

CREATE OR REPLACE FUNCTION private.payment_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE act text;
BEGIN
  IF current_setting('ccse.skip_payment_audit', true) = 'on' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'payment_billings' THEN
    IF TG_OP = 'UPDATE' THEN NEW.updated_by := auth.uid(); NEW.updated_at := now(); NEW.created_by := OLD.created_by; NEW.created_at := OLD.created_at; act := 'bill_edit';
    ELSE NEW.created_by := auth.uid(); NEW.created_at := now(); act := 'bill'; END IF;
  ELSE
    IF TG_OP = 'INSERT' THEN NEW.created_by := auth.uid(); NEW.created_at := now(); act := 'receive';
    ELSE act := CASE WHEN NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL THEN 'void' ELSE 'receipt_edit' END; END IF;
  END IF;
  INSERT INTO public.payment_audit_log(entity, entity_id, term_id, action, data, changed_by)
  VALUES (TG_TABLE_NAME, NEW.id, NEW.term_id, act, to_jsonb(NEW), auth.uid());
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payment_billings_audit BEFORE INSERT OR UPDATE ON public.payment_billings FOR EACH ROW EXECUTE FUNCTION private.payment_audit();
CREATE TRIGGER trg_payment_receipts_audit BEFORE INSERT OR UPDATE ON public.payment_receipts FOR EACH ROW EXECUTE FUNCTION private.payment_audit();

CREATE OR REPLACE FUNCTION private.void_receipt(_id uuid, _reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT private.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'ลบรายการรับเงินได้เฉพาะผู้ดูแลระบบ'; END IF;
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'ต้องระบุเหตุผลในการลบ'; END IF;
  UPDATE public.payment_receipts SET voided_at = now(), voided_by = auth.uid(), void_reason = trim(_reason)
  WHERE id = _id AND voided_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'ไม่พบรายการรับเงิน'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.void_receipt(_id uuid, _reason text) RETURNS void LANGUAGE sql SET search_path TO 'public' AS $$ SELECT private.void_receipt(_id, _reason) $$;
GRANT EXECUTE ON FUNCTION private.void_receipt(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_receipt(uuid, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.void_receipt(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.void_receipt(uuid, text) TO authenticated;

DROP FUNCTION public.payment_schedule(uuid);
DROP FUNCTION private.payment_schedule(uuid);
CREATE FUNCTION private.payment_schedule(_project_id uuid)
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
      b.id AS bid, b.bill_no, b.bill_date, b.credit_days, b.due_date,
      coalesce(r.rec, 0) AS rec, coalesce(r.wht, 0) AS wht, r.last_date, coalesce(r.cnt,0) AS cnt,
      coalesce(private.trigger_status(t."trigger") IS NOT NULL AND p.status >= private.trigger_status(t."trigger"), false) AS reached
    FROM private.payment_quote(_project_id) pq
    JOIN quotations q ON q.id = pq.quotation_id
    JOIN projects p ON p.id = q.project_id
    JOIN payment_terms t ON t.quotation_id = pq.quotation_id
    LEFT JOIN payment_billings b ON b.term_id = t.id
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
CREATE FUNCTION public.payment_schedule(_project_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, project_id uuid, project_code text, project_name text, project_status smallint, quotation_id uuid, ref_no text, rev text, seq integer, name text, percent numeric, fixed_amount numeric, trigger text, received boolean, received_date date, note text, net_total numeric, amount numeric, due_status text, due_since timestamptz,
   bill_id uuid, bill_no text, bill_date date, credit_days integer, due_date date, received_total numeric, wht_total numeric, outstanding numeric, days_overdue integer, last_received_date date)
 LANGUAGE sql STABLE SET search_path TO 'public'
AS $$ SELECT * FROM private.payment_schedule(_project_id) $$;
REVOKE EXECUTE ON FUNCTION public.payment_schedule(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION private.payment_schedule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payment_schedule(uuid) TO authenticated;

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
  SELECT new_id, seq, name, percent, note, fixed_amount, "trigger", received, received_date FROM public.payment_terms WHERE quotation_id = cur.id;
  -- move billing/receipt history to the matching new terms (by seq)
  PERFORM set_config('ccse.skip_payment_audit', 'on', true);
  UPDATE public.payment_billings b SET term_id = nt.id
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

COMMENT ON COLUMN public.payment_terms.received IS 'DEPRECATED: replaced by payment_receipts';
COMMENT ON COLUMN public.payment_terms.received_date IS 'DEPRECATED: replaced by payment_receipts';

CREATE POLICY "payment slips read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'payment-slips' AND private.can_manage_payments(auth.uid()));
CREATE POLICY "payment slips insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'payment-slips' AND private.can_manage_payments(auth.uid()));
