-- Team access (owner, 26/10/2026). Teams map onto the existing roles:
--   admin = everything · sale team = sales + estimator (BOQ, WOS, schedule, repairs; selling
--   prices, stock; never costs or suppliers) · purchase team = stock (stock, purchases, costs;
--   never selling prices) · payment team = accounting (payments; reads the BOQ and purchases) ·
--   production (production sheet; never prices or costs) · technician (schedule, WOS, repairs,
--   handover, site photos).
-- Policies are only replaced or added; no table or data changes.

-- 1. Helpers
CREATE OR REPLACE FUNCTION private.can_edit_quote(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_any_role(_uid, ARRAY['admin','sales','estimator']::app_role[])
$$;
CREATE OR REPLACE FUNCTION private.can_plan_work(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_any_role(_uid, ARRAY['admin','sales','estimator','production']::app_role[])
$$;
-- purchase costs (sku_costs, purchases): admin, purchase team, payment team
CREATE OR REPLACE FUNCTION private.can_see_cost(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_any_role(_uid, ARRAY['admin','stock','accounting']::app_role[])
$$;
REVOKE ALL ON FUNCTION private.can_see_cost(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_see_cost(uuid) TO authenticated, service_role;

-- 2. Payment team reads the quotation (read only) so it can check what it bills
CREATE POLICY "payments read quotations" ON public.quotations FOR SELECT TO authenticated
  USING (private.can_manage_payments(auth.uid()));
CREATE POLICY "payments read quote lines" ON public.quote_lines FOR SELECT TO authenticated
  USING (private.can_manage_payments(auth.uid()));
CREATE POLICY "payments read quotation clauses" ON public.quotation_clauses FOR SELECT TO authenticated
  USING (private.can_manage_payments(auth.uid()));
CREATE POLICY "payments read clauses" ON public.quote_clauses FOR SELECT TO authenticated
  USING (private.can_manage_payments(auth.uid()));
CREATE POLICY "payments read prices" ON public.component_prices FOR SELECT TO authenticated
  USING (private.can_manage_payments(auth.uid()));

-- 3. Costs: purchase + payment team read the latest purchase cost (admin still edits it by hand)
CREATE POLICY "sku_costs cost read" ON public.sku_costs FOR SELECT TO authenticated
  USING (private.can_see_cost(auth.uid()));

-- 4. Purchases are recorded by the purchase team; the payment team only reads them
DROP POLICY IF EXISTS "purchases insert" ON public.purchases;
CREATE POLICY "purchases insert" ON public.purchases FOR INSERT TO authenticated
  WITH CHECK (private.has_any_role(auth.uid(), ARRAY['admin','stock']::app_role[]));

-- 5. Purchase requests (no prices) are visible to the sale team too
DROP POLICY IF EXISTS "pr read" ON public.purchase_requests;
CREATE POLICY "pr read" ON public.purchase_requests FOR SELECT TO authenticated
  USING (private.has_any_role(auth.uid(), ARRAY['admin','sales','estimator','stock','production','accounting']::app_role[]));

-- 6. Production sheet choices belong to the production team
DROP POLICY IF EXISTS "production settings write" ON public.production_line_settings;
CREATE POLICY "production settings write" ON public.production_line_settings FOR ALL TO authenticated
  USING (private.has_any_role(auth.uid(), ARRAY['admin','production']::app_role[]))
  WITH CHECK (private.has_any_role(auth.uid(), ARRAY['admin','production']::app_role[]));

-- 7. Estimators are part of the sale team: customers, projects, work orders
DROP POLICY IF EXISTS "customers write" ON public.customers;
CREATE POLICY "customers write" ON public.customers FOR INSERT TO authenticated
  WITH CHECK (private.has_any_role(auth.uid(), ARRAY['admin','sales','estimator']::app_role[]));
DROP POLICY IF EXISTS "customers update" ON public.customers;
CREATE POLICY "customers update" ON public.customers FOR UPDATE TO authenticated
  USING (private.has_any_role(auth.uid(), ARRAY['admin','sales','estimator']::app_role[]))
  WITH CHECK (private.has_any_role(auth.uid(), ARRAY['admin','sales','estimator']::app_role[]));
DROP POLICY IF EXISTS "projects insert" ON public.projects;
CREATE POLICY "projects insert" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (private.has_any_role(auth.uid(), ARRAY['admin','sales','estimator']::app_role[]));
DROP POLICY IF EXISTS "projects update" ON public.projects;
CREATE POLICY "projects update" ON public.projects FOR UPDATE TO authenticated
  USING (private.has_any_role(auth.uid(), ARRAY['admin','sales','estimator','production']::app_role[]))
  WITH CHECK (private.has_any_role(auth.uid(), ARRAY['admin','sales','estimator','production']::app_role[]));
DROP POLICY IF EXISTS "work_orders insert" ON public.work_orders;
CREATE POLICY "work_orders insert" ON public.work_orders FOR INSERT TO authenticated
  WITH CHECK (private.can_plan_work(auth.uid()));
DROP POLICY IF EXISTS "work_orders update" ON public.work_orders;
CREATE POLICY "work_orders update" ON public.work_orders FOR UPDATE TO authenticated
  USING (private.can_plan_work(auth.uid()) OR private.has_role(auth.uid(), 'technician'))
  WITH CHECK (private.can_plan_work(auth.uid()) OR private.has_role(auth.uid(), 'technician'));
DROP POLICY IF EXISTS "work_order_items write" ON public.work_order_items;
CREATE POLICY "work_order_items write" ON public.work_order_items FOR ALL TO authenticated
  USING (private.can_plan_work(auth.uid())) WITH CHECK (private.can_plan_work(auth.uid()));
