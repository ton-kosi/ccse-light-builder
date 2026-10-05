ALTER TABLE public.payment_terms
  ADD COLUMN fixed_amount numeric CHECK (fixed_amount IS NULL OR fixed_amount >= 0),
  ADD COLUMN "trigger" text CHECK ("trigger" IN ('deposit','before_delivery','material_on_site','after_delivery','substantial_completion','progress')),
  ADD COLUMN received boolean NOT NULL DEFAULT false,
  ADD COLUMN received_date date;

CREATE OR REPLACE FUNCTION private.can_manage_payments(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_any_role(_uid, ARRAY['admin','accounting']::app_role[]) $$;
REVOKE ALL ON FUNCTION private.can_manage_payments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_manage_payments(uuid) TO authenticated, service_role;

DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='payment_terms' LOOP
    EXECUTE format('DROP POLICY %I ON public.payment_terms', p.policyname);
  END LOOP; END $$;
CREATE POLICY "payments managers read" ON public.payment_terms FOR SELECT TO authenticated USING (private.can_manage_payments(auth.uid()));
CREATE POLICY "payments managers insert" ON public.payment_terms FOR INSERT TO authenticated WITH CHECK (private.can_manage_payments(auth.uid()));
CREATE POLICY "payments managers update" ON public.payment_terms FOR UPDATE TO authenticated USING (private.can_manage_payments(auth.uid())) WITH CHECK (private.can_manage_payments(auth.uid()));
CREATE POLICY "payments managers delete" ON public.payment_terms FOR DELETE TO authenticated USING (private.can_manage_payments(auth.uid()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_terms TO authenticated;

CREATE OR REPLACE FUNCTION private.trigger_status(_t text) RETURNS smallint
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _t WHEN 'deposit' THEN 4 WHEN 'before_delivery' THEN 7 WHEN 'material_on_site' THEN 8
    WHEN 'after_delivery' THEN 8 WHEN 'substantial_completion' THEN 9 END::smallint $$;

-- Header + net total of current quotation (no line prices exposed)
CREATE OR REPLACE FUNCTION private.payment_quote(_project_id uuid)
RETURNS TABLE(quotation_id uuid, ref_no text, rev text, net_total numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.can_manage_payments(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  RETURN QUERY
  SELECT q.id, q.ref_no, q.rev,
    round(((coalesce((SELECT sum(coalesce(l.qty,0)*coalesce(l.unit_price,0)*(1-coalesce(l.discount_percent,0)/100))
        FROM quote_lines l WHERE l.quotation_id = q.id AND l.kind = 'priced'
          AND (coalesce(trim(l.option_name),'') = '' OR trim(l.option_name) = trim(p.selected_option))),0)
      - coalesce(q.discount,0)) * (1 + coalesce(q.vat_percent,0)/100))::numeric, 2)
  FROM quotations q JOIN projects p ON p.id = q.project_id
  WHERE q.is_current AND (_project_id IS NULL OR q.project_id = _project_id);
END $$;

CREATE OR REPLACE FUNCTION private.payment_schedule(_project_id uuid)
RETURNS TABLE(id uuid, project_id uuid, project_code text, project_name text, project_status smallint,
  quotation_id uuid, ref_no text, rev text, seq integer, name text, percent numeric, fixed_amount numeric,
  "trigger" text, received boolean, received_date date, note text, net_total numeric, amount numeric,
  due_status text, due_since timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.can_manage_payments(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  RETURN QUERY
  SELECT t.id, p.id, p.code, p.name, p.status, pq.quotation_id, pq.ref_no, pq.rev, t.seq, t.name, t.percent,
    t.fixed_amount, t."trigger", t.received, t.received_date, t.note, pq.net_total,
    coalesce(t.fixed_amount, round(pq.net_total * t.percent / 100, 2)),
    CASE WHEN t.received THEN 'received'
         WHEN t."trigger" = 'progress' THEN 'check_progress'
         WHEN private.trigger_status(t."trigger") IS NOT NULL AND p.status >= private.trigger_status(t."trigger") THEN 'due'
         ELSE 'not_yet' END,
    (SELECT min(sl.changed_at) FROM project_status_log sl
      WHERE sl.project_id = p.id AND sl.to_status >= private.trigger_status(t."trigger"))
  FROM private.payment_quote(_project_id) pq
  JOIN quotations q ON q.id = pq.quotation_id
  JOIN projects p ON p.id = q.project_id
  JOIN payment_terms t ON t.quotation_id = pq.quotation_id
  ORDER BY p.code, t.seq;
END $$;
REVOKE ALL ON FUNCTION private.payment_quote(uuid), private.payment_schedule(uuid), private.trigger_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.payment_quote(uuid), private.payment_schedule(uuid), private.trigger_status(text) TO authenticated, service_role;

CREATE FUNCTION public.payment_quote(_project_id uuid DEFAULT NULL)
RETURNS TABLE(quotation_id uuid, ref_no text, rev text, net_total numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$ SELECT * FROM private.payment_quote(_project_id) $$;
CREATE FUNCTION public.payment_schedule(_project_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, project_id uuid, project_code text, project_name text, project_status smallint,
  quotation_id uuid, ref_no text, rev text, seq integer, name text, percent numeric, fixed_amount numeric,
  "trigger" text, received boolean, received_date date, note text, net_total numeric, amount numeric,
  due_status text, due_since timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$ SELECT * FROM private.payment_schedule(_project_id) $$;
REVOKE ALL ON FUNCTION public.payment_quote(uuid), public.payment_schedule(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_quote(uuid), public.payment_schedule(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_quotation_revision(_project_id uuid)
 RETURNS uuid LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
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
    INSERT INTO public.line_recipes(quote_line_id, sku_id, qty, note)
    SELECT new_line, sku_id, qty, note FROM public.line_recipes WHERE quote_line_id = l.id;
  END LOOP;
  INSERT INTO public.payment_terms(quotation_id, seq, name, percent, note, fixed_amount, "trigger", received, received_date)
  SELECT new_id, seq, name, percent, note, fixed_amount, "trigger", received, received_date FROM public.payment_terms WHERE quotation_id = cur.id;
  RETURN new_id;
END $function$;