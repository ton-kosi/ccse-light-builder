-- Production sheet (ใบผลิต) choices per BOQ item, kept by project + item number so they
-- survive a new Rev: round the LED cut down or up, assembly method, notified date, remark.
-- Additive only.
CREATE TABLE public.production_line_settings (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  item_no text NOT NULL,
  rounding text NOT NULL DEFAULT 'down' CHECK (rounding IN ('down','up')),
  assembly text,            -- พับ LED / เฉลี่ยกลาง / …
  notified_on date,         -- วันแจ้งผลิต
  remark text,
  updated_by uuid DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, item_no)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_line_settings TO authenticated;
GRANT ALL ON public.production_line_settings TO service_role;
ALTER TABLE public.production_line_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "production settings read" ON public.production_line_settings FOR SELECT TO authenticated
  USING (private.has_any_app_role(auth.uid()));
CREATE POLICY "production settings write" ON public.production_line_settings FOR ALL TO authenticated
  USING (private.has_any_role(auth.uid(), ARRAY['admin','sales','estimator','stock','production']::app_role[]))
  WITH CHECK (private.has_any_role(auth.uid(), ARRAY['admin','sales','estimator','stock','production']::app_role[]));
CREATE TRIGGER trg_production_line_settings_updated BEFORE UPDATE ON public.production_line_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
