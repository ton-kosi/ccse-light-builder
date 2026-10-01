-- SKUs
ALTER TABLE public.skus DROP COLUMN stock_qty, DROP COLUMN category;
ALTER TABLE public.skus
  ADD COLUMN source text NOT NULL DEFAULT 'domestic' CHECK (source IN ('domestic','import')),
  ADD COLUMN lead_time_days integer NOT NULL DEFAULT 0,
  ADD COLUMN min_stock numeric NOT NULL DEFAULT 0,
  ADD COLUMN is_roll boolean NOT NULL DEFAULT false,
  ADD COLUMN roll_length_m numeric,
  ADD COLUMN roll_family text,
  ADD COLUMN cut_step_cm numeric,
  ADD COLUMN max_piece_m numeric,
  ADD CONSTRAINT skus_roll_len_chk CHECK ((is_roll AND roll_length_m IN (5,10)) OR (NOT is_roll AND roll_length_m IS NULL));
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='skus_code_key') THEN
    ALTER TABLE public.skus ADD CONSTRAINT skus_code_key UNIQUE (code);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.can_view_master(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role <> 'technician') $$;
CREATE OR REPLACE FUNCTION public.can_edit_master(_uid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role IN ('admin','estimator','stock')) $$;
REVOKE EXECUTE ON FUNCTION public.can_view_master(uuid), public.can_edit_master(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.can_view_master(uuid), public.can_edit_master(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "skus delete" ON public.skus;
DROP POLICY IF EXISTS "skus insert" ON public.skus;
DROP POLICY IF EXISTS "skus read" ON public.skus;
DROP POLICY IF EXISTS "skus update" ON public.skus;
CREATE POLICY "skus read" ON public.skus FOR SELECT TO authenticated USING (public.can_view_master(auth.uid()));
CREATE POLICY "skus write" ON public.skus FOR ALL TO authenticated USING (public.can_edit_master(auth.uid())) WITH CHECK (public.can_edit_master(auth.uid()));

-- Stock movements
CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id uuid NOT NULL REFERENCES public.skus(id) ON DELETE CASCADE,
  qty numeric NOT NULL CHECK (qty <> 0),
  type text NOT NULL CHECK (type IN ('receive','issue','adjust')),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.stock_movements(sku_id);
GRANT SELECT, INSERT ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "movements read" ON public.stock_movements FOR SELECT TO authenticated USING (public.can_view_master(auth.uid()));
CREATE POLICY "movements insert" ON public.stock_movements FOR INSERT TO authenticated WITH CHECK (public.can_edit_master(auth.uid()) AND created_by = auth.uid());

CREATE VIEW public.sku_on_hand WITH (security_invoker = true) AS
  SELECT s.id AS sku_id, COALESCE(SUM(m.qty),0)::numeric AS on_hand
  FROM public.skus s LEFT JOIN public.stock_movements m ON m.sku_id = s.id GROUP BY s.id;
GRANT SELECT ON public.sku_on_hand TO authenticated;

-- Sales components
ALTER TABLE public.sales_components RENAME COLUMN sales_name TO name;
ALTER TABLE public.sales_components DROP COLUMN category;
ALTER TABLE public.sales_components
  ADD COLUMN install_category text CHECK (install_category IS NULL OR install_category IN ('ไฟเส้น (ม.)','Driver/PSU (ตัว)','Dimmer/Control (ชุด)','Fiber optic (จุด)','Fiber light source (เครื่อง)','ผ้า Clipso (ชุด)','โคม/อุปกรณ์ (ชุด)')),
  ADD COLUMN is_roll_product boolean NOT NULL DEFAULT false,
  ADD COLUMN roll_family text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sales_components_code_key') THEN
    ALTER TABLE public.sales_components ADD CONSTRAINT sales_components_code_key UNIQUE (code);
  END IF;
END $$;
DROP POLICY IF EXISTS "sales_components read" ON public.sales_components;
DROP POLICY IF EXISTS "sales_components write" ON public.sales_components;
CREATE POLICY "sales_components read" ON public.sales_components FOR SELECT TO authenticated USING (public.can_view_master(auth.uid()));
CREATE POLICY "sales_components write" ON public.sales_components FOR ALL TO authenticated USING (public.can_edit_master(auth.uid())) WITH CHECK (public.can_edit_master(auth.uid()));

-- Recipes
DROP TABLE public.recipe_items;
CREATE TABLE public.recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id uuid NOT NULL REFERENCES public.sales_components(id) ON DELETE CASCADE,
  sku_id uuid NOT NULL REFERENCES public.skus(id) ON DELETE RESTRICT,
  qty_per_unit numeric NOT NULL DEFAULT 1 CHECK (qty_per_unit > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (component_id, sku_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recipes TO authenticated;
GRANT ALL ON public.recipes TO service_role;
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recipes read" ON public.recipes FOR SELECT TO authenticated USING (public.can_view_master(auth.uid()));
CREATE POLICY "recipes write" ON public.recipes FOR ALL TO authenticated USING (public.can_edit_master(auth.uid())) WITH CHECK (public.can_edit_master(auth.uid()));
CREATE TRIGGER trg_recipes_updated BEFORE UPDATE ON public.recipes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();