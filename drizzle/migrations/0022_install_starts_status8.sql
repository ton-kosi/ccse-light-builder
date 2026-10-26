-- Workflow fix: when technicians start an installation job ("กำลังทำ"), the project moves to
-- 8 ติดตั้ง by itself, so payment terms tied to step 8 ("ของถึงหน้างาน", "หลังส่งของ") become
-- "ถึงเวลาวางบิล" without anyone changing the status by hand. Only moves forward (6–7 → 8).
-- Additive only.
CREATE OR REPLACE FUNCTION public.work_order_install_started() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.wo_type = 'installation' AND NEW.status = 'in_progress'
     AND OLD.status IS DISTINCT FROM 'in_progress' THEN
    UPDATE projects SET status = 8 WHERE id = NEW.project_id AND status BETWEEN 6 AND 7;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.work_order_install_started() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_work_orders_install_started AFTER UPDATE OF status ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.work_order_install_started();
