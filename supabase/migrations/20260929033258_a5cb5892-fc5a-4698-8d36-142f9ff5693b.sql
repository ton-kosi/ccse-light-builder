CREATE OR REPLACE FUNCTION public.can_see_money(_user_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin') $$;

DROP FUNCTION IF EXISTS public.claim_ceo();

CREATE OR REPLACE FUNCTION public.handle_first_admin()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.handle_first_admin() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_profiles_first_admin AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_first_admin();

-- widen write access for new roles
DROP POLICY IF EXISTS "skus insert" ON public.skus;
DROP POLICY IF EXISTS "skus update" ON public.skus;
CREATE POLICY "skus insert" ON public.skus FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','stock','production']::app_role[]));
CREATE POLICY "skus update" ON public.skus FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','stock','production']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','stock','production']::app_role[]));

DROP POLICY IF EXISTS "sales_components write" ON public.sales_components;
CREATE POLICY "sales_components write" ON public.sales_components FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','sales','estimator','production']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','sales','estimator','production']::app_role[]));
DROP POLICY IF EXISTS "recipe_items write" ON public.recipe_items;
CREATE POLICY "recipe_items write" ON public.recipe_items FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','sales','estimator','production']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','sales','estimator','production']::app_role[]));
DROP POLICY IF EXISTS "line_recipes write" ON public.line_recipes;
CREATE POLICY "line_recipes write" ON public.line_recipes FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','sales','estimator','production']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','sales','estimator','production']::app_role[]));

-- settings (single row)
CREATE TABLE public.settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  min_remnant_m numeric NOT NULL DEFAULT 1.0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.settings TO authenticated;
GRANT ALL ON public.settings TO service_role;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings read" ON public.settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings admin update" ON public.settings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
INSERT INTO public.settings (id) VALUES (true);