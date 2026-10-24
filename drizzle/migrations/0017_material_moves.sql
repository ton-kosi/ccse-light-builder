-- Material issue rounds + returns (ใบเบิกของ / ใบคืนของ), as on the CCSE workbook:
-- round 1 is the existing "ยืนยันเบิกของ" (confirm_material_issue); this adds extra issues
-- (round 2, 3, …) and returns. Every move posts the stock movement. Additive only.

CREATE TABLE public.material_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('issue','return')),
  round_no integer CHECK (round_no IS NULL OR round_no >= 2),   -- extra issue round; null for returns
  sku_id uuid NOT NULL REFERENCES public.skus(id) ON DELETE RESTRICT,
  qty numeric NOT NULL CHECK (qty > 0),
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'issue') = (round_no IS NOT NULL))
);
CREATE INDEX material_moves_project_idx ON public.material_moves (project_id, created_at);
GRANT SELECT, INSERT ON public.material_moves TO authenticated;
GRANT ALL ON public.material_moves TO service_role;
ALTER TABLE public.material_moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "material moves read" ON public.material_moves FOR SELECT TO authenticated
  USING (private.has_any_app_role(auth.uid()));
-- the store hands out and takes back the goods
CREATE POLICY "material moves insert" ON public.material_moves FOR INSERT TO authenticated
  WITH CHECK (private.has_any_role(auth.uid(), ARRAY['admin','stock']::app_role[]));

-- rules + stock: only after round 1, a return never exceeds what is out on the project
CREATE OR REPLACE FUNCTION public.material_move_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE issued numeric; returned numeric; label text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM material_issues WHERE project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'ต้อง "ยืนยันเบิกของ" ครั้งที่ 1 ก่อน จึงเบิกเพิ่มหรือคืนของได้';
  END IF;
  NEW.created_by := auth.uid();
  IF NEW.kind = 'return' THEN
    SELECT coalesce(sum(-qty), 0) INTO issued FROM stock_movements
      WHERE project_id = NEW.project_id AND sku_id = NEW.sku_id AND type = 'issue';
    SELECT coalesce(sum(qty), 0) INTO returned FROM material_moves
      WHERE project_id = NEW.project_id AND sku_id = NEW.sku_id AND kind = 'return';
    IF NEW.qty > issued - returned + 0.0005 THEN
      RAISE EXCEPTION 'คืนได้ไม่เกินที่เบิกไป (คงค้าง % )', round(issued - returned, 3);
    END IF;
    label := 'คืนของ';
    INSERT INTO stock_movements (sku_id, qty, type, project_id, note, created_by)
    VALUES (NEW.sku_id, NEW.qty, 'receive', NEW.project_id, trim(label || ' ' || coalesce(NEW.note, '')), auth.uid());
  ELSE
    label := 'เบิกเพิ่มครั้งที่ ' || NEW.round_no;
    INSERT INTO stock_movements (sku_id, qty, type, project_id, note, created_by)
    VALUES (NEW.sku_id, -NEW.qty, 'issue', NEW.project_id, trim(label || ' ' || coalesce(NEW.note, '')), auth.uid());
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.material_move_before() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_material_moves_before BEFORE INSERT ON public.material_moves
  FOR EACH ROW EXECUTE FUNCTION public.material_move_before();
