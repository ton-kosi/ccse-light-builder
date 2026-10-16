-- Quotation totals options + work-sheet-only lines.
-- 1. quote_lines.kind 'internal' = note shown only on the work sheet (never printed for the customer, no price).
-- 2. quotations.vat_mode: how VAT appears on the printed quotation
--    ('show' = VAT line + grand total incl. VAT, 'excluded' = total + "(EXCLUDING VAT x%)", 'none' = no VAT wording).
--    The money (payment terms, bills) still includes vat_percent; set vat_percent = 0 for a job without VAT.
-- 3. quotations.adjustments: contract-style lines between the item total and VAT,
--    [{"label": "OVERHEAD & PROFIT 12%", "type": "percent" | "amount" | "note", "value": 12, "text": "..."}]
--    percent = on the running total (compounding), amount = fixed baht, note = text only.

DO $$ DECLARE c text; BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.quote_lines'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.quote_lines DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE public.quote_lines ADD CONSTRAINT quote_lines_kind_check
  CHECK (kind IN ('heading','priced','display','foc','by_buyer','existing','internal'));

ALTER TABLE public.quotations
  ADD COLUMN IF NOT EXISTS vat_mode text NOT NULL DEFAULT 'show' CHECK (vat_mode IN ('show','excluded','none')),
  ADD COLUMN IF NOT EXISTS adjustments jsonb NOT NULL DEFAULT '[]'::jsonb;

-- running total after the adjustments (same rule as computeTotals in src/lib/boq.ts)
CREATE OR REPLACE FUNCTION private.apply_quote_adjustments(_amount numeric, _adj jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE a jsonb; t numeric := coalesce(_amount, 0);
BEGIN
  IF jsonb_typeof(_adj) IS DISTINCT FROM 'array' THEN RETURN t; END IF;
  FOR a IN SELECT value FROM jsonb_array_elements(_adj) LOOP
    IF a->>'type' = 'amount' THEN
      t := t + coalesce(nullif(a->>'value','')::numeric, 0);
    ELSIF coalesce(a->>'type','percent') = 'percent' THEN
      t := t + t * coalesce(nullif(a->>'value','')::numeric, 0) / 100;
    END IF;
  END LOOP;
  RETURN t;
END $$;
REVOKE ALL ON FUNCTION private.apply_quote_adjustments(numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.apply_quote_adjustments(numeric, jsonb) TO authenticated, service_role;

-- Header + net total of current quotation (no line prices exposed) — now with the adjustments
CREATE OR REPLACE FUNCTION private.payment_quote(_project_id uuid)
RETURNS TABLE(quotation_id uuid, ref_no text, rev text, net_total numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.can_manage_payments(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  RETURN QUERY
  SELECT q.id, q.ref_no, q.rev,
    round((private.apply_quote_adjustments(
        coalesce((SELECT sum(coalesce(l.qty,0)*coalesce(l.unit_price,0)*(1-coalesce(l.discount_percent,0)/100))
          FROM quote_lines l WHERE l.quotation_id = q.id AND l.kind = 'priced'
            AND (coalesce(trim(l.option_name),'') = '' OR trim(l.option_name) = trim(p.selected_option))),0)
        - coalesce(q.discount,0), q.adjustments)
      * (1 + coalesce(q.vat_percent,0)/100))::numeric, 2)
  FROM quotations q JOIN projects p ON p.id = q.project_id
  WHERE q.is_current AND (_project_id IS NULL OR q.project_id = _project_id);
END $$;

-- New revision also copies the VAT display mode and the adjustments
CREATE OR REPLACE FUNCTION private.create_quotation_revision(_project_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE cur public.quotations; new_id uuid; next_rev text; l record; new_line uuid;
BEGIN
  IF NOT private.can_edit_quote(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  SELECT * INTO cur FROM public.quotations WHERE project_id = _project_id AND is_current;
  IF cur.id IS NULL THEN RAISE EXCEPTION 'ไม่พบใบเสนอราคาปัจจุบัน'; END IF;
  SELECT chr(ascii(max(rev)) + 1) INTO next_rev FROM public.quotations WHERE project_id = _project_id;
  UPDATE public.quotations SET is_current = false WHERE id = cur.id;
  INSERT INTO public.quotations(project_id, ref_no, rev, is_current, date, validity_days, delivery_text, notes, discount, vat_percent, vat_mode, adjustments)
  VALUES (_project_id, cur.ref_no, next_rev, true, CURRENT_DATE, cur.validity_days, cur.delivery_text, cur.notes, cur.discount, cur.vat_percent, cur.vat_mode, cur.adjustments)
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
REVOKE ALL ON FUNCTION private.create_quotation_revision(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION private.create_quotation_revision(uuid) TO authenticated, service_role;