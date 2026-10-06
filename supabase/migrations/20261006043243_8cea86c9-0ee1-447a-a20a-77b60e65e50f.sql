-- 1. Overrun rate moved to an admin/accounting-only table
CREATE TABLE public.project_finance (
  project_id uuid PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  overrun_rate_per_day numeric CHECK (overrun_rate_per_day IS NULL OR overrun_rate_per_day >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_finance TO authenticated;
GRANT ALL ON public.project_finance TO service_role;
ALTER TABLE public.project_finance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finance read" ON public.project_finance FOR SELECT TO authenticated USING (private.can_manage_payments(auth.uid()));
CREATE POLICY "finance insert" ON public.project_finance FOR INSERT TO authenticated WITH CHECK (private.can_manage_payments(auth.uid()));
CREATE POLICY "finance update" ON public.project_finance FOR UPDATE TO authenticated USING (private.can_manage_payments(auth.uid())) WITH CHECK (private.can_manage_payments(auth.uid()));
CREATE POLICY "finance delete" ON public.project_finance FOR DELETE TO authenticated USING (private.can_manage_payments(auth.uid()));
CREATE TRIGGER trg_project_finance_updated BEFORE UPDATE ON public.project_finance FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
INSERT INTO public.project_finance(project_id, overrun_rate_per_day)
  SELECT id, overrun_rate_per_day FROM public.projects WHERE overrun_rate_per_day IS NOT NULL;
ALTER TABLE public.projects DROP COLUMN overrun_rate_per_day;

-- 2. Only admin may change a purchase request's kind
CREATE OR REPLACE FUNCTION public.purchase_request_kind_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind AND auth.uid() IS NOT NULL AND NOT private.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'เปลี่ยนประเภทใบขอซื้อได้เฉพาะผู้ดูแลระบบ';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_purchase_requests_kind BEFORE UPDATE ON public.purchase_requests
  FOR EACH ROW EXECUTE FUNCTION public.purchase_request_kind_guard();

-- 3. First-admin only for the very first user
CREATE OR REPLACE FUNCTION public.handle_first_admin() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id <> NEW.id)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

-- 4. Customer contact details hidden from technicians; names via lookup
DROP POLICY "customers read" ON public.customers;
CREATE POLICY "customers read" ON public.customers FOR SELECT TO authenticated USING (private.can_view_master(auth.uid()));

CREATE OR REPLACE FUNCTION private.customer_names() RETURNS TABLE(id uuid, name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.has_any_app_role(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  RETURN QUERY SELECT c.id, c.name FROM customers c;
END $$;
REVOKE ALL ON FUNCTION private.customer_names() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.customer_names() TO authenticated, service_role;
CREATE FUNCTION public.customer_names() RETURNS TABLE(id uuid, name text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$ SELECT * FROM private.customer_names() $$;
REVOKE ALL ON FUNCTION public.customer_names() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_names() TO authenticated, service_role;

-- 5. Remove all privileges from not-signed-in visitors
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- 6. Staff see only their own roles; admin sees all
DROP POLICY IF EXISTS "roles readable" ON public.user_roles;
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='user_roles' AND cmd='SELECT' LOOP
    EXECUTE format('DROP POLICY %I ON public.user_roles', p.policyname);
  END LOOP; END $$;
CREATE POLICY "roles read own or admin" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR private.has_role(auth.uid(), 'admin'));