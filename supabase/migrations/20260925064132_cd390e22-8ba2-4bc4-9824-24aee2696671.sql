-- ROLES
CREATE TYPE public.app_role AS ENUM ('ceo','sales','production','technician');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  full_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles))
$$;

-- can see money (prices/costs)
CREATE OR REPLACE FUNCTION public.can_see_money(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('ceo','sales'))
$$;

CREATE OR REPLACE FUNCTION public.claim_ceo()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'ceo') THEN RETURN false; END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), 'ceo')
    ON CONFLICT DO NOTHING;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE POLICY "profiles readable by authenticated" ON public.profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "own profile insert" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "own profile update" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "roles readable by authenticated" ON public.user_roles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ceo manages roles insert" ON public.user_roles
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'ceo'));
CREATE POLICY "ceo manages roles delete" ON public.user_roles
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'ceo'));

-- CUSTOMERS
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text,
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  address text,
  tax_id text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers read" ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "customers write" ON public.customers FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ceo','sales']::public.app_role[]));
CREATE POLICY "customers update" ON public.customers FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ceo','sales']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ceo','sales']::public.app_role[]));
CREATE POLICY "customers delete" ON public.customers FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'ceo'));
CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- PROJECTS
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  status smallint NOT NULL DEFAULT 1 CHECK (status BETWEEN 1 AND 11),
  site_address text,
  po_number text,
  po_date date,
  deposit_received boolean NOT NULL DEFAULT false,
  ceo_approved boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "projects read" ON public.projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "projects insert" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ceo','sales']::public.app_role[]));
CREATE POLICY "projects update" ON public.projects FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ceo','sales','production']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ceo','sales','production']::public.app_role[]));
CREATE POLICY "projects delete" ON public.projects FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'ceo'));
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- SKUS (stock layer)
CREATE TABLE public.skus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'ชิ้น',
  category text,
  stock_qty numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.skus TO authenticated;
GRANT ALL ON public.skus TO service_role;
ALTER TABLE public.skus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "skus read" ON public.skus FOR SELECT TO authenticated USING (true);
CREATE POLICY "skus insert" ON public.skus FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ceo','sales','production']::public.app_role[]));
CREATE POLICY "skus update" ON public.skus FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ceo','sales','production']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ceo','sales','production']::public.app_role[]));
CREATE POLICY "skus delete" ON public.skus FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'ceo'));
CREATE TRIGGER trg_skus_updated BEFORE UPDATE ON public.skus
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- SKU COSTS (money — hidden from production/technician)
CREATE TABLE public.sku_costs (
  sku_id uuid PRIMARY KEY REFERENCES public.skus(id) ON DELETE CASCADE,
  unit_cost numeric NOT NULL DEFAULT 0,
  supplier text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sku_costs TO authenticated;
GRANT ALL ON public.sku_costs TO service_role;
ALTER TABLE public.sku_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sku_costs money read" ON public.sku_costs FOR SELECT TO authenticated
  USING (public.can_see_money(auth.uid()));
CREATE POLICY "sku_costs money write" ON public.sku_costs FOR ALL TO authenticated
  USING (public.can_see_money(auth.uid())) WITH CHECK (public.can_see_money(auth.uid()));
CREATE TRIGGER trg_sku_costs_updated BEFORE UPDATE ON public.sku_costs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- SALES COMPONENTS + RECIPES (internal, no money)
CREATE TABLE public.sales_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  sales_name text NOT NULL,
  unit text NOT NULL DEFAULT 'ม.',
  category text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_components TO authenticated;
GRANT ALL ON public.sales_components TO service_role;
ALTER TABLE public.sales_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales_components read" ON public.sales_components FOR SELECT TO authenticated USING (true);
CREATE POLICY "sales_components write" ON public.sales_components FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ceo','sales','production']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ceo','sales','production']::public.app_role[]));
CREATE TRIGGER trg_sales_components_updated BEFORE UPDATE ON public.sales_components
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.recipe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_component_id uuid NOT NULL REFERENCES public.sales_components(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES public.skus(id) ON DELETE RESTRICT,
  qty_per_unit numeric NOT NULL DEFAULT 1,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipe_items TO authenticated;
GRANT ALL ON public.recipe_items TO service_role;
ALTER TABLE public.recipe_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recipe_items read" ON public.recipe_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "recipe_items write" ON public.recipe_items FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ceo','sales','production']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ceo','sales','production']::public.app_role[]));

-- QUOTATIONS (money — ceo/sales only)
CREATE TABLE public.quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  doc_no text NOT NULL,
  doc_date date NOT NULL DEFAULT current_date,
  revision smallint NOT NULL DEFAULT 1,
  discount numeric NOT NULL DEFAULT 0,
  vat_percent numeric NOT NULL DEFAULT 7,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotations TO authenticated;
GRANT ALL ON public.quotations TO service_role;
ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quotations money read" ON public.quotations FOR SELECT TO authenticated
  USING (public.can_see_money(auth.uid()));
CREATE POLICY "quotations money write" ON public.quotations FOR ALL TO authenticated
  USING (public.can_see_money(auth.uid())) WITH CHECK (public.can_see_money(auth.uid()));
CREATE TRIGGER trg_quotations_updated BEFORE UPDATE ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.quotation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.quotations(id) ON DELETE CASCADE,
  line_no integer NOT NULL DEFAULT 1,
  sales_name text NOT NULL,
  description text,
  qty numeric,
  unit text,
  unit_price numeric,
  sales_component_id uuid REFERENCES public.sales_components(id) ON DELETE SET NULL,
  is_header boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotation_lines TO authenticated;
GRANT ALL ON public.quotation_lines TO service_role;
ALTER TABLE public.quotation_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quotation_lines money read" ON public.quotation_lines FOR SELECT TO authenticated
  USING (public.can_see_money(auth.uid()));
CREATE POLICY "quotation_lines money write" ON public.quotation_lines FOR ALL TO authenticated
  USING (public.can_see_money(auth.uid())) WITH CHECK (public.can_see_money(auth.uid()));
CREATE TRIGGER trg_quotation_lines_updated BEFORE UPDATE ON public.quotation_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- LINE RECIPES (one-off recipe for a BOQ line; no money)
CREATE TABLE public.line_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_line_id uuid NOT NULL REFERENCES public.quotation_lines(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES public.skus(id) ON DELETE RESTRICT,
  qty_per_unit numeric NOT NULL DEFAULT 1,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.line_recipes TO authenticated;
GRANT ALL ON public.line_recipes TO service_role;
ALTER TABLE public.line_recipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "line_recipes read" ON public.line_recipes FOR SELECT TO authenticated USING (true);
CREATE POLICY "line_recipes write" ON public.line_recipes FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ceo','sales','production']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ceo','sales','production']::public.app_role[]));

-- WORK ORDERS (no money)
CREATE TABLE public.work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  doc_no text NOT NULL,
  title text NOT NULL DEFAULT '',
  wo_type text NOT NULL DEFAULT 'production',
  status text NOT NULL DEFAULT 'draft',
  scheduled_date date,
  instructions text,
  released_at timestamptz,
  released_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_orders TO authenticated;
GRANT ALL ON public.work_orders TO service_role;
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "work_orders read" ON public.work_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "work_orders insert" ON public.work_orders FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ceo','sales','production']::public.app_role[]));
CREATE POLICY "work_orders update" ON public.work_orders FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ceo','sales','production','technician']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ceo','sales','production','technician']::public.app_role[]));
CREATE POLICY "work_orders delete" ON public.work_orders FOR DELETE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ceo','production']::public.app_role[]));
CREATE TRIGGER trg_work_orders_updated BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.work_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  sku_id uuid REFERENCES public.skus(id) ON DELETE RESTRICT,
  item_name text NOT NULL,
  unit text,
  qty numeric NOT NULL DEFAULT 1,
  issued_qty numeric NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_order_items TO authenticated;
GRANT ALL ON public.work_order_items TO service_role;
ALTER TABLE public.work_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "work_order_items read" ON public.work_order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "work_order_items write" ON public.work_order_items FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['ceo','sales','production']::public.app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['ceo','sales','production']::public.app_role[]));

-- Guard: work order may only be released when project status >= 6
CREATE OR REPLACE FUNCTION public.check_work_order_release()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE st smallint;
BEGIN
  IF NEW.status <> 'draft' OR NEW.released_at IS NOT NULL THEN
    SELECT status INTO st FROM public.projects WHERE id = NEW.project_id;
    IF st IS NULL OR st < 6 THEN
      RAISE EXCEPTION 'ไม่สามารถปล่อยใบสั่งงานได้: สถานะโปรเจกต์ต้องถึงขั้นที่ 6 (รับมัดจำ หรือ CEO อนุมัติ) ก่อน';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_work_orders_release BEFORE INSERT OR UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.check_work_order_release();