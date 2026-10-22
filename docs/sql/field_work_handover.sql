-- Phase A: field work & handover (workflow steps 5, 7, 8).
-- * work orders get an end date (multi-day jobs) and the type 'survey' (วัดหน้างาน)
-- * people assigned to a work order (technicians / production)
-- * files on a project or work order: drawings, site photos, handover photos, signed notes
--   (private bucket 'job-files'; no prices are ever stored here)
-- * handover (ส่งมอบงาน): who received, date, signature; closes the work order and, for the
--   last open installation job, sets the actual install days and moves the project to 9
-- Additive only: no existing data is changed.

-- 1. Work orders: end date for jobs that take several days
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_type_chk
  CHECK (wo_type IN ('survey','production','installation','service')) NOT VALID;
ALTER TABLE public.work_orders ADD CONSTRAINT work_orders_dates_chk
  CHECK (end_date IS NULL OR scheduled_date IS NULL OR end_date >= scheduled_date) NOT VALID;

-- planners: admin, sales, production (same people who create work orders)
CREATE OR REPLACE FUNCTION private.can_plan_work(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_any_role(_uid, ARRAY['admin','sales','production']::app_role[])
$$;
REVOKE ALL ON FUNCTION private.can_plan_work(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_plan_work(uuid) TO authenticated, service_role;

-- 2. Who works on a job
CREATE TABLE public.work_order_assignees (
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (work_order_id, user_id)
);
CREATE INDEX work_order_assignees_user_idx ON public.work_order_assignees (user_id);
GRANT SELECT, INSERT, DELETE ON public.work_order_assignees TO authenticated;
GRANT ALL ON public.work_order_assignees TO service_role;
ALTER TABLE public.work_order_assignees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assignees read" ON public.work_order_assignees FOR SELECT TO authenticated
  USING (private.has_any_app_role(auth.uid()));
CREATE POLICY "assignees insert" ON public.work_order_assignees FOR INSERT TO authenticated
  WITH CHECK (private.can_plan_work(auth.uid()));
CREATE POLICY "assignees delete" ON public.work_order_assignees FOR DELETE TO authenticated
  USING (private.can_plan_work(auth.uid()));

-- 3. Files (drawings, photos, signed notes) on a project or one of its work orders
CREATE TABLE public.job_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  work_order_id uuid REFERENCES public.work_orders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('drawing','photo','handover_photo','signed_note','other')),
  name text NOT NULL,
  path text NOT NULL UNIQUE,
  mime text,
  size_bytes bigint,
  uploaded_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_files_project_idx ON public.job_files (project_id, created_at DESC);
CREATE INDEX job_files_wo_idx ON public.job_files (work_order_id);
GRANT SELECT, INSERT, DELETE ON public.job_files TO authenticated;
GRANT ALL ON public.job_files TO service_role;
ALTER TABLE public.job_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "job files read" ON public.job_files FOR SELECT TO authenticated
  USING (private.has_any_app_role(auth.uid()));
CREATE POLICY "job files insert" ON public.job_files FOR INSERT TO authenticated
  WITH CHECK (private.has_any_app_role(auth.uid()) AND uploaded_by = auth.uid());
CREATE POLICY "job files delete" ON public.job_files FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid() OR private.has_role(auth.uid(), 'admin'));

-- a file must belong to the project of its work order
CREATE OR REPLACE FUNCTION public.job_file_project_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.work_order_id IS NOT NULL THEN
    SELECT project_id INTO NEW.project_id FROM work_orders WHERE id = NEW.work_order_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.job_file_project_guard() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_job_files_project BEFORE INSERT ON public.job_files
  FOR EACH ROW EXECUTE FUNCTION public.job_file_project_guard();

-- private storage bucket: images and PDF up to 20 MB
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('job-files', 'job-files', false, 20971520,
        ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
ON CONFLICT (id) DO NOTHING;
CREATE POLICY "job files storage read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'job-files' AND private.has_any_app_role(auth.uid()));
CREATE POLICY "job files storage insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'job-files' AND private.has_any_app_role(auth.uid()));
CREATE POLICY "job files storage delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'job-files' AND (owner = auth.uid() OR private.has_role(auth.uid(), 'admin')));

-- 4. Handover (ส่งมอบงาน): one per work order
CREATE TABLE public.handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL UNIQUE REFERENCES public.work_orders(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  handover_date date NOT NULL DEFAULT current_date,
  receiver_name text NOT NULL CHECK (trim(receiver_name) <> ''),
  receiver_position text,
  signature_path text,
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.handovers TO authenticated;
GRANT ALL ON public.handovers TO service_role;
ALTER TABLE public.handovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "handovers read" ON public.handovers FOR SELECT TO authenticated
  USING (private.has_any_app_role(auth.uid()));
CREATE POLICY "handovers insert" ON public.handovers FOR INSERT TO authenticated
  WITH CHECK (private.has_any_role(auth.uid(), ARRAY['admin','sales','production','technician']::app_role[]));
CREATE POLICY "handovers update" ON public.handovers FOR UPDATE TO authenticated
  USING (private.has_any_role(auth.uid(), ARRAY['admin','sales','production','technician']::app_role[]))
  WITH CHECK (private.has_any_role(auth.uid(), ARRAY['admin','sales','production','technician']::app_role[]));
CREATE POLICY "handovers delete" ON public.handovers FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_handovers_updated BEFORE UPDATE ON public.handovers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- project always follows the work order; who recorded it never changes
CREATE OR REPLACE FUNCTION public.handover_before() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  SELECT project_id INTO NEW.project_id FROM work_orders WHERE id = NEW.work_order_id;
  IF TG_OP = 'UPDATE' THEN
    NEW.created_by := OLD.created_by;
    NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.handover_before() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_handovers_before BEFORE INSERT OR UPDATE ON public.handovers
  FOR EACH ROW EXECUTE FUNCTION public.handover_before();

-- after a handover: the job is done; when it was the last open installation job,
-- actual install days = handover date - install start + 1 (calendar days) and the project
-- moves to 9 (ส่งมอบ), which makes "substantial completion" payment terms due
CREATE OR REPLACE FUNCTION public.handover_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w record; p record; still_open boolean;
BEGIN
  SELECT * INTO w FROM work_orders WHERE id = NEW.work_order_id;
  IF w.status IN ('released','in_progress') THEN
    UPDATE work_orders SET status = 'done' WHERE id = w.id;
  END IF;
  IF w.wo_type = 'installation' THEN
    SELECT EXISTS (
      SELECT 1 FROM work_orders o
      WHERE o.project_id = w.project_id AND o.wo_type = 'installation' AND o.id <> w.id
        AND o.status NOT IN ('done','cancelled')
    ) INTO still_open;
    IF NOT still_open THEN
      SELECT * INTO p FROM projects WHERE id = w.project_id;
      UPDATE projects SET
        install_days_actual = CASE
          WHEN p.install_start_date IS NOT NULL AND NEW.handover_date >= p.install_start_date
          THEN NEW.handover_date - p.install_start_date + 1
          ELSE install_days_actual END,
        status = CASE WHEN p.status BETWEEN 6 AND 8 THEN 9 ELSE status END
      WHERE id = w.project_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.handover_after() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_handovers_after AFTER INSERT ON public.handovers
  FOR EACH ROW EXECUTE FUNCTION public.handover_after();
