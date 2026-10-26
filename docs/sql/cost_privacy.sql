-- Cost privacy + sale team sees payments (owner, 26/10/2026).
-- * Purchase team (stock) sees cost and purchase history of LOCAL SKUs only (skus.source =
--   'domestic'); imported SKUs are bought and costed by admin.
-- * Payment team no longer sees costs: with the BOQ prices it would show admin's margin.
--   Nobody but admin can put a cost next to a selling price.
-- * Only admin can move a SKU between local and import (others keep the old value silently,
--   so a stock-count CSV without a source column cannot unlock import costs).
-- * Sale team (sales, estimator) reads payment status: terms, bills, receipts (no slips,
--   no audit log, cannot bill or record money).
-- Additive: functions replaced, policies replaced or added, one trigger.

CREATE OR REPLACE FUNCTION private.can_see_sku_cost(_uid uuid, _sku uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_role(_uid, 'admin')
      OR (private.has_role(_uid, 'stock')
          AND EXISTS (SELECT 1 FROM public.skus WHERE id = _sku AND source = 'domestic'))
$$;
REVOKE ALL ON FUNCTION private.can_see_sku_cost(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_see_sku_cost(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.can_see_cost(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_any_role(_uid, ARRAY['admin','stock']::app_role[])
$$;

CREATE OR REPLACE FUNCTION private.can_view_payments(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_any_role(_uid, ARRAY['admin','accounting','sales','estimator']::app_role[])
$$;
REVOKE ALL ON FUNCTION private.can_view_payments(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_view_payments(uuid) TO authenticated, service_role;

-- 1. Costs and purchases: admin, or the purchase team for local SKUs
DROP POLICY IF EXISTS "sku_costs cost read" ON public.sku_costs;
CREATE POLICY "sku_costs cost read" ON public.sku_costs FOR SELECT TO authenticated
  USING (private.can_see_sku_cost(auth.uid(), sku_id));
DROP POLICY IF EXISTS "purchases read" ON public.purchases;
CREATE POLICY "purchases read" ON public.purchases FOR SELECT TO authenticated
  USING (private.can_see_sku_cost(auth.uid(), sku_id));
DROP POLICY IF EXISTS "purchases insert" ON public.purchases;
CREATE POLICY "purchases insert" ON public.purchases FOR INSERT TO authenticated
  WITH CHECK (private.can_see_sku_cost(auth.uid(), sku_id));

-- 2. Only admin changes local / import
CREATE OR REPLACE FUNCTION public.sku_source_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.source IS DISTINCT FROM OLD.source AND auth.uid() IS NOT NULL
     AND NOT private.has_role(auth.uid(), 'admin') THEN
    NEW.source := OLD.source;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sku_source_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_skus_source_guard BEFORE UPDATE ON public.skus
  FOR EACH ROW EXECUTE FUNCTION public.sku_source_guard();

-- 3. Sale team reads payment status
CREATE POLICY "sales read billing docs" ON public.billing_docs FOR SELECT TO authenticated
  USING (private.can_view_payments(auth.uid()));
CREATE POLICY "sales read billings" ON public.payment_billings FOR SELECT TO authenticated
  USING (private.can_view_payments(auth.uid()));
CREATE POLICY "sales read receipts" ON public.payment_receipts FOR SELECT TO authenticated
  USING (private.can_view_payments(auth.uid()));

CREATE OR REPLACE FUNCTION private.payment_quote(_project_id uuid)
RETURNS TABLE(quotation_id uuid, ref_no text, rev text, net_total numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.can_view_payments(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
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

CREATE OR REPLACE FUNCTION private.payment_schedule(_project_id uuid)
 RETURNS TABLE(id uuid, project_id uuid, project_code text, project_name text, project_status smallint, quotation_id uuid, ref_no text, rev text, seq integer, name text, percent numeric, fixed_amount numeric, trigger text, received boolean, received_date date, note text, net_total numeric, amount numeric, due_status text, due_since timestamptz,
   bill_id uuid, bill_no text, bill_date date, credit_days integer, due_date date, received_total numeric, wht_total numeric, outstanding numeric, days_overdue integer, last_received_date date)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT private.can_view_payments(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
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
