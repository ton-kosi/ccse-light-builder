-- Two issuing companies (CCSE / One Engineering) for quotations and billing, and the
-- "INVOICE PAYMENT" billing layout (summary of payment, VAT, withholding tax, bank per company).
--
-- ALSO FIXES docs/sql/quote_totals.sql: that file replaced private.create_quotation_revision with an
-- older body, so a new Rev stopped copying the footer clauses / signer / print labels and stopped
-- moving billing docs + receipts to the new payment terms. The full version is restored below.

-- 1. companies ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.companies (
  id text PRIMARY KEY,
  name_th text NOT NULL,
  name_en text NOT NULL,
  short_en text NOT NULL,
  tax_id text,
  address_th text,
  address_en text,
  contact_line text,
  bank_name_en text, bank_branch_en text, bank_name_th text, bank_branch_th text,
  bank_account_name_en text, bank_account_name_th text, bank_account_no text,
  signer_name text,
  signer_title text,
  default_wht_percent numeric NOT NULL DEFAULT 0 CHECK (default_wht_percent >= 0 AND default_wht_percent <= 15),
  quote_prefix text,
  logo_data text,
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "companies read" ON public.companies;
DROP POLICY IF EXISTS "companies admin update" ON public.companies;
CREATE POLICY "companies read" ON public.companies FOR SELECT TO authenticated USING (private.has_any_app_role(auth.uid()));
CREATE POLICY "companies admin update" ON public.companies FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin')) WITH CHECK (private.has_role(auth.uid(), 'admin'));

INSERT INTO public.companies (id, name_th, name_en, short_en, tax_id, address_th, address_en, contact_line,
  bank_name_en, bank_branch_en, bank_name_th, bank_branch_th, bank_account_name_en, bank_account_name_th, bank_account_no,
  signer_name, signer_title, default_wht_percent, quote_prefix, sort_order)
VALUES
  ('ccse', 'บริษัท ชิงชัยและบุตรวิศวกรรม จำกัด', 'CHINGCHAI & SONS ENGINEERING COMPANY LIMITED', 'CHINGCHAI & SONS ENGINEERING CO., LTD.',
   '0105527021885', 'เลขที่ 213 ซอยเจริญมิตร ถนนสุขุมวิท 63 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพมหานคร 10110',
   '213 SOI CHAROENMIT, SUKUMVIT 63 ROAD, KLONGTON(NORTH), WATTANA, BANGKOK 10110 THAILAND',
   'T : 02-392-2200 (AUTOMATIC 6 LINES)  F : 02-392-6966  WWW.CCSE-GROUP.COM',
   'Bangkok Bank', 'Thong lor rd. branch', 'ธนาคารกรุงเทพ', 'ถนนทองหล่อ',
   'Chingchai & Sons Engineering Co., Ltd.', 'บริษัท ชิงชัยและบุตรวิศวกรรม จำกัด', '206 3 003863',
   'ATCH KOSIYABONG', 'MANAGING DIRECTOR', 0, 'QC', 1),
  ('one', 'บริษัท วรรณวิศวกรรม จำกัด', 'ONE ENGINEERING COMPANY LIMITED', 'ONE ENGINEERING CO., LTD.',
   '0105538071005', NULL,
   '213 Soi Chareonmit Sukhumvit 63 Road, Klongton (North), Wattana, Bangkok 10110, Thailand',
   'Tel. 662.392.2200  Fax 662.392.6966',
   'Bangkok Bank', 'Thong lor rd. branch', 'ธนาคารกรุงเทพ', 'ถนนทองหล่อ',
   'One Engineering Co., Ltd.', 'บริษัท วรรณ วิศวกรรม จำกัด', '206 3 035014',
   'ATCH KOSIYABONG', 'MANAGING DIRECTOR', 3, 'QO', 2)
ON CONFLICT (id) DO NOTHING;

-- 2. which company issues a quotation (bills follow the quotation) -------------------------------
ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS company_id text NOT NULL DEFAULT 'ccse' REFERENCES public.companies(id);

-- 3. customer branch for the ATTN block (empty = สำนักงานใหญ่) ------------------------------------
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS branch text;

-- 4. billing doc snapshot for the INVOICE PAYMENT layout -----------------------------------------
ALTER TABLE public.billing_docs
  ADD COLUMN IF NOT EXISTS company_id text REFERENCES public.companies(id),
  ADD COLUMN IF NOT EXISTS term_seq integer,
  ADD COLUMN IF NOT EXISTS term_label text,
  ADD COLUMN IF NOT EXISTS term_percent numeric,
  ADD COLUMN IF NOT EXISTS quote_total_ex_vat numeric,
  ADD COLUMN IF NOT EXISTS request_amount numeric,
  ADD COLUMN IF NOT EXISTS deduct_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wht_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wht_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_payment numeric,
  ADD COLUMN IF NOT EXISTS customer_tax_id text,
  ADD COLUMN IF NOT EXISTS customer_branch text;

-- RC NO. = Thai year (2 digits) - MMDD + running number of the day, e.g. 69-071602
CREATE TABLE IF NOT EXISTS public.billing_day_counters (day date PRIMARY KEY, last_no integer NOT NULL DEFAULT 0);
GRANT ALL ON public.billing_day_counters TO service_role;
ALTER TABLE public.billing_day_counters ENABLE ROW LEVEL SECURITY;

-- quotation total before VAT (main items + chosen option, special discount, adjustments)
CREATE OR REPLACE FUNCTION private.quote_ex_vat(_quotation_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT round(private.apply_quote_adjustments(
    coalesce((SELECT sum(coalesce(l.qty,0)*coalesce(l.unit_price,0)*(1-coalesce(l.discount_percent,0)/100))
      FROM quote_lines l WHERE l.quotation_id = q.id AND l.kind = 'priced'
        AND (coalesce(trim(l.option_name),'') = '' OR trim(l.option_name) = trim(p.selected_option))),0)
    - coalesce(q.discount,0), q.adjustments)::numeric, 2)
  FROM quotations q JOIN projects p ON p.id = q.project_id WHERE q.id = _quotation_id
$$;
REVOKE ALL ON FUNCTION private.quote_ex_vat(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.quote_ex_vat(uuid) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.issue_billing_doc(uuid, date, integer);
DROP FUNCTION IF EXISTS private.issue_billing_doc(uuid, date, integer);
CREATE OR REPLACE FUNCTION private.issue_billing_doc(_term_id uuid, _bill_date date, _credit_days integer, _wht_percent numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE t payment_terms; q quotations; p projects; c customers; co companies;
  ex numeric; vatp numeric; pre numeric; vat numeric; whtp numeric; wht numeric; n int; no text; lbl text; new_id uuid;
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
  pre := CASE WHEN t.fixed_amount IS NOT NULL THEN round(t.fixed_amount / (1 + vatp/100), 2)
              ELSE round(ex * t.percent / 100, 2) END;
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
      CASE WHEN t.fixed_amount IS NULL THEN ' (' || trim(to_char(t.percent, 'FM999990.##')) || '% x ' || trim(to_char(ex, 'FM999,999,999,990.00')) || ')' ELSE '' END,
    c.name, c.address, p.attn, p.name, q.ref_no, q.rev, p.po_number,
    vatp, pre, vat, pre + vat, auth.uid(),
    q.company_id, t.seq, lbl, CASE WHEN t.fixed_amount IS NULL THEN t.percent END, ex, pre, 0,
    whtp, wht, pre + vat - wht, c.tax_id, c.branch)
  RETURNING id INTO new_id;
  INSERT INTO payment_audit_log(entity, entity_id, term_id, action, data, changed_by)
  SELECT 'billing_docs', d.id, d.term_id, 'bill', to_jsonb(d), auth.uid() FROM billing_docs d WHERE d.id = new_id;
  RETURN new_id;
END $$;
CREATE OR REPLACE FUNCTION public.issue_billing_doc(_term_id uuid, _bill_date date, _credit_days integer, _wht_percent numeric DEFAULT NULL)
RETURNS uuid LANGUAGE sql SET search_path TO 'public' AS $$ SELECT private.issue_billing_doc(_term_id, _bill_date, _credit_days, _wht_percent) $$;
REVOKE EXECUTE ON FUNCTION public.issue_billing_doc(uuid, date, integer, numeric) FROM anon, public;
GRANT EXECUTE ON FUNCTION private.issue_billing_doc(uuid, date, integer, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_billing_doc(uuid, date, integer, numeric) TO authenticated;

-- 5. once a term is billed, what is owed is the bill's grand total (VAT on the ex-VAT request) --
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
      coalesce(b.grand_total, t.fixed_amount, round(pq.net_total * t.percent / 100, 2)) AS amt,
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


-- 6. new revision: restore the full copy (clauses, signer, print labels, billing/receipt moves)
--    and also copy the VAT display mode, the adjustments and the company
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
  FOR l IN SELECT * FROM public.quote_lines WHERE quotation_id = cur.id LOOP
    INSERT INTO public.quote_lines(quotation_id, sort_order, option_name, zone, item_no, kind, component_id, customer_text, circuit_note, cut_lengths, qty, unit, unit_price, discount_percent)
    VALUES (new_id, l.sort_order, l.option_name, l.zone, l.item_no, l.kind, l.component_id, l.customer_text, l.circuit_note, l.cut_lengths, l.qty, l.unit, l.unit_price, l.discount_percent)
    RETURNING id INTO new_line;
    INSERT INTO public.line_recipes(quote_line_id, sku_id, qty, note)
    SELECT new_line, sku_id, qty, note FROM public.line_recipes WHERE quote_line_id = l.id;
  END LOOP;
  INSERT INTO public.quotation_clauses(quotation_id, clause_id, section, text, sort_order, included, edited, is_new)
  SELECT new_id, clause_id, section, text, sort_order, included, edited, is_new FROM public.quotation_clauses WHERE quotation_id = cur.id;
  INSERT INTO public.payment_terms(quotation_id, seq, name, percent, note, fixed_amount, "trigger", received, received_date, print_label)
  SELECT new_id, seq, name, percent, note, fixed_amount, coalesce("trigger", 'progress'), received, received_date, print_label FROM public.payment_terms WHERE quotation_id = cur.id;
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
