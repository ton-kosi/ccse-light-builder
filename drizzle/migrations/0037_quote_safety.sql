-- Quotation safety (owner, 09/11/2026). Additive: one function, two triggers.
-- 1. Saving a builder block replaces its lines and materials in ONE step: if anything fails,
--    nothing changes, so a lost connection can no longer leave the block half deleted.
-- 2. A quotation that a bill was issued from (and not cancelled) is frozen: its lines and its
--    money settings can't change. Changes go into a new Rev; the bill keeps pointing at the
--    version it was issued from. Materials (line_recipes) and site measurements stay editable.

CREATE OR REPLACE FUNCTION private.quotation_billed(_quotation_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.billing_docs b WHERE b.quotation_id = _quotation_id AND b.cancelled_at IS NULL);
$$;
REVOKE ALL ON FUNCTION private.quotation_billed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.quotation_billed(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.guard_billed_lines()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE qid uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.quotation_id ELSE NEW.quotation_id END;
BEGIN
  -- deleting the whole project (allowed only without bills) cascades here first
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.quotations WHERE id = qid) THEN RETURN OLD; END IF;
  IF private.quotation_billed(qid) OR (TG_OP = 'UPDATE' AND private.quotation_billed(OLD.quotation_id)) THEN
    RAISE EXCEPTION 'ใบเสนอราคานี้ออกใบเบิกเงินแล้ว แก้ไม่ได้ — สร้าง Rev ใหม่เพื่อแก้';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION private.guard_billed_lines() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_billed_lines ON public.quote_lines;
CREATE TRIGGER trg_guard_billed_lines BEFORE INSERT OR UPDATE OR DELETE ON public.quote_lines
  FOR EACH ROW EXECUTE FUNCTION private.guard_billed_lines();

CREATE OR REPLACE FUNCTION private.guard_billed_quotation()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF private.quotation_billed(OLD.id) AND (
       NEW.discount IS DISTINCT FROM OLD.discount OR NEW.vat_percent IS DISTINCT FROM OLD.vat_percent
    OR NEW.vat_mode IS DISTINCT FROM OLD.vat_mode OR NEW.adjustments IS DISTINCT FROM OLD.adjustments
    OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.ref_no IS DISTINCT FROM OLD.ref_no) THEN
    RAISE EXCEPTION 'ใบเสนอราคานี้ออกใบเบิกเงินแล้ว แก้ไม่ได้ — สร้าง Rev ใหม่เพื่อแก้';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_billed_quotation() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_guard_billed_quotation ON public.quotations;
CREATE TRIGGER trg_guard_billed_quotation BEFORE UPDATE ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION private.guard_billed_quotation();

-- One-step block save. Runs as the caller, so the usual row rules still apply.
CREATE OR REPLACE FUNCTION public.replace_quote_block(_quotation_id uuid, _old_ids uuid[], _lines jsonb, _recipes jsonb, _order jsonb)
 RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
BEGIN
  DELETE FROM public.quote_lines WHERE id = ANY(_old_ids) AND quotation_id = _quotation_id;
  INSERT INTO public.quote_lines(id, quotation_id, sort_order, option_name, zone, item_no, kind, component_id,
    customer_text, circuit_note, cut_lengths, qty, unit, unit_price, discount_percent)
  SELECT id, _quotation_id, sort_order, option_name, zone, item_no, kind, component_id,
    customer_text, circuit_note, cut_lengths, qty, unit, unit_price, coalesce(discount_percent, 0)
  FROM jsonb_populate_recordset(NULL::public.quote_lines, _lines);
  INSERT INTO public.line_recipes(quote_line_id, sku_id, qty, note)
  SELECT quote_line_id, sku_id, qty, note FROM jsonb_populate_recordset(NULL::public.line_recipes, _recipes);
  UPDATE public.quote_lines l SET sort_order = o.sort_order
  FROM jsonb_to_recordset(_order) AS o(id uuid, sort_order integer)
  WHERE l.id = o.id AND l.quotation_id = _quotation_id;
END $$;
REVOKE ALL ON FUNCTION public.replace_quote_block(uuid, uuid[], jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_quote_block(uuid, uuid[], jsonb, jsonb, jsonb) TO authenticated;