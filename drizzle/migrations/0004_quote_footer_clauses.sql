CREATE TABLE public.quote_clauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL CHECK (section IN ('remark','warranty','note_th','warning')),
  text text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  always_include boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_clauses TO authenticated;
GRANT ALL ON public.quote_clauses TO service_role;
ALTER TABLE public.quote_clauses ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.component_clauses (
  component_id uuid NOT NULL REFERENCES public.sales_components(id) ON DELETE CASCADE,
  clause_id uuid NOT NULL REFERENCES public.quote_clauses(id) ON DELETE CASCADE,
  PRIMARY KEY (component_id, clause_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.component_clauses TO authenticated;
GRANT ALL ON public.component_clauses TO service_role;
ALTER TABLE public.component_clauses ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.quotation_clauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  clause_id uuid REFERENCES public.quote_clauses(id) ON DELETE SET NULL,
  section text NOT NULL CHECK (section IN ('remark','warranty','note_th','warning')),
  text text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  included boolean NOT NULL DEFAULT true,
  edited boolean NOT NULL DEFAULT false,
  is_new boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quotation_clauses_q ON public.quotation_clauses(quotation_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotation_clauses TO authenticated;
GRANT ALL ON public.quotation_clauses TO service_role;
ALTER TABLE public.quotation_clauses ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.can_edit_clauses(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT private.has_any_role(_uid, ARRAY['admin','estimator']::app_role[]) $$;

CREATE POLICY "clauses read" ON public.quote_clauses FOR SELECT TO authenticated USING (private.can_edit_clauses(auth.uid()) OR private.can_edit_quote(auth.uid()));
CREATE POLICY "clauses write" ON public.quote_clauses FOR ALL TO authenticated USING (private.can_edit_clauses(auth.uid())) WITH CHECK (private.can_edit_clauses(auth.uid()));
CREATE POLICY "component clauses read" ON public.component_clauses FOR SELECT TO authenticated USING (private.can_edit_clauses(auth.uid()) OR private.can_edit_quote(auth.uid()));
CREATE POLICY "component clauses write" ON public.component_clauses FOR ALL TO authenticated USING (private.can_edit_clauses(auth.uid())) WITH CHECK (private.can_edit_clauses(auth.uid()));
CREATE POLICY "quotation clauses all" ON public.quotation_clauses FOR ALL TO authenticated USING (private.can_edit_quote(auth.uid())) WITH CHECK (private.can_edit_quote(auth.uid()));

CREATE TRIGGER trg_quote_clauses_updated BEFORE UPDATE ON public.quote_clauses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.quotations ADD COLUMN closing_text text, ADD COLUMN signer_user_id uuid, ADD COLUMN signer_name text, ADD COLUMN signer_position text;
ALTER TABLE public.payment_terms ADD COLUMN print_label text;

-- quote editors may manage terms that have no bill/receipt
CREATE OR REPLACE FUNCTION private.term_untouched(_term uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT NOT EXISTS (SELECT 1 FROM public.billing_docs WHERE term_id=_term AND cancelled_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM public.payment_receipts WHERE term_id=_term AND voided_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM public.payment_billings WHERE term_id=_term) $$;
CREATE POLICY "quote editors read terms" ON public.payment_terms FOR SELECT TO authenticated USING (private.can_edit_quote(auth.uid()));
CREATE POLICY "quote editors insert terms" ON public.payment_terms FOR INSERT TO authenticated WITH CHECK (private.can_edit_quote(auth.uid()));
CREATE POLICY "quote editors update terms" ON public.payment_terms FOR UPDATE TO authenticated USING (private.can_edit_quote(auth.uid()) AND private.term_untouched(id)) WITH CHECK (private.can_edit_quote(auth.uid()));
CREATE POLICY "quote editors delete terms" ON public.payment_terms FOR DELETE TO authenticated USING (private.can_edit_quote(auth.uid()) AND private.term_untouched(id));

CREATE OR REPLACE FUNCTION private.sync_quotation_clauses(_qid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE opt text; base int;
BEGIN
  IF NOT private.can_edit_quote(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  SELECT p.selected_option INTO opt FROM public.quotations q JOIN public.projects p ON p.id=q.project_id WHERE q.id=_qid;
  CREATE TEMP TABLE IF NOT EXISTS _need(clause_id uuid) ON COMMIT DROP; DELETE FROM _need;
  INSERT INTO _need SELECT DISTINCT c.id FROM public.quote_clauses c WHERE c.active AND (c.always_include OR EXISTS (
    SELECT 1 FROM public.component_clauses cc JOIN public.quote_lines l ON l.component_id=cc.component_id
    WHERE cc.clause_id=c.id AND l.quotation_id=_qid AND l.kind<>'heading'
      AND (coalesce(trim(l.option_name),'')='' OR trim(l.option_name)=opt)));
  DELETE FROM public.quotation_clauses qc WHERE qc.quotation_id=_qid AND qc.clause_id IS NOT NULL AND NOT qc.edited
    AND qc.clause_id NOT IN (SELECT clause_id FROM _need);
  SELECT coalesce(max(sort_order),0) INTO base FROM public.quotation_clauses WHERE quotation_id=_qid;
  INSERT INTO public.quotation_clauses(quotation_id, clause_id, section, text, sort_order, is_new)
  SELECT _qid, c.id, c.section, c.text, base + row_number() OVER (ORDER BY c.sort_order, c.text),
    EXISTS (SELECT 1 FROM public.quotation_clauses x WHERE x.quotation_id=_qid)
  FROM public.quote_clauses c WHERE c.id IN (SELECT clause_id FROM _need)
    AND NOT EXISTS (SELECT 1 FROM public.quotation_clauses x WHERE x.quotation_id=_qid AND x.clause_id=c.id);
END $$;
CREATE OR REPLACE FUNCTION public.sync_quotation_clauses(_qid uuid) RETURNS void LANGUAGE sql SET search_path TO 'public'
AS $$ SELECT private.sync_quotation_clauses(_qid) $$;
GRANT EXECUTE ON FUNCTION public.sync_quotation_clauses(uuid) TO authenticated;

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
  INSERT INTO public.quotations(project_id, ref_no, rev, is_current, date, validity_days, delivery_text, notes, discount, vat_percent, closing_text, signer_user_id, signer_name, signer_position)
  VALUES (_project_id, cur.ref_no, next_rev, true, CURRENT_DATE, cur.validity_days, cur.delivery_text, cur.notes, cur.discount, cur.vat_percent, cur.closing_text, cur.signer_user_id, cur.signer_name, cur.signer_position)
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