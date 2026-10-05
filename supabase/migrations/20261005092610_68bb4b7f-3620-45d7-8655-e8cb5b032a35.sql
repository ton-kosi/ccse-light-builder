CREATE TABLE public.purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  sku_id uuid NOT NULL REFERENCES public.skus(id) ON DELETE RESTRICT,
  qty numeric NOT NULL CHECK (qty > 0),
  kind text NOT NULL CHECK (kind IN ('domestic','sundry','import')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ordered','received')),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  note text,
  approved_by uuid,
  approved_at timestamptz,
  ordered_at timestamptz,
  received_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_requests TO authenticated;
GRANT ALL ON public.purchase_requests TO service_role;
ALTER TABLE public.purchase_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pr read" ON public.purchase_requests FOR SELECT TO authenticated
  USING (private.has_any_role(auth.uid(), ARRAY['admin','stock','production','accounting']::app_role[]));
CREATE POLICY "pr insert" ON public.purchase_requests FOR INSERT TO authenticated
  WITH CHECK (private.has_any_role(auth.uid(), ARRAY['admin','stock']::app_role[]));
CREATE POLICY "pr update" ON public.purchase_requests FOR UPDATE TO authenticated
  USING (private.has_any_role(auth.uid(), ARRAY['admin','stock']::app_role[]))
  WITH CHECK (private.has_any_role(auth.uid(), ARRAY['admin','stock']::app_role[]));
CREATE POLICY "pr delete pending" ON public.purchase_requests FOR DELETE TO authenticated
  USING (status = 'pending' AND private.has_any_role(auth.uid(), ARRAY['admin','stock']::app_role[]));

CREATE OR REPLACE FUNCTION public.purchase_request_rules()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_admin boolean := auth.uid() IS NULL OR private.has_role(auth.uid(), 'admin');
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.approved_by := NULL; NEW.approved_at := NULL; NEW.received_at := NULL; NEW.ordered_at := NULL;
    IF NEW.kind = 'import' AND NOT is_admin THEN
      RAISE EXCEPTION 'ใบขอซื้อแบบนำเข้า สร้างได้เฉพาะผู้ดูแลระบบ';
    END IF;
    IF NEW.status = 'received' THEN RAISE EXCEPTION 'ต้องสั่งซื้อก่อนจึงจะรับของได้'; END IF;
  ELSE
    IF OLD.status = 'received' THEN RAISE EXCEPTION 'ใบขอซื้อนี้รับของแล้ว แก้ไขไม่ได้'; END IF;
    IF NEW.kind IS DISTINCT FROM OLD.kind AND (NEW.kind = 'import' OR OLD.kind = 'import') AND NOT is_admin THEN
      RAISE EXCEPTION 'เปลี่ยนเป็น/จากแบบนำเข้าได้เฉพาะผู้ดูแลระบบ';
    END IF;
    IF NEW.kind = 'import' AND NOT is_admin THEN
      RAISE EXCEPTION 'ใบขอซื้อแบบนำเข้า แก้ไขได้เฉพาะผู้ดูแลระบบ';
    END IF;
    -- approval (sundry): admin only; keep server-side stamps
    IF NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      IF NOT is_admin THEN RAISE EXCEPTION 'อนุมัติได้เฉพาะผู้ดูแลระบบ'; END IF;
      IF NEW.approved_at IS NULL THEN NEW.approved_by := NULL;
      ELSE NEW.approved_at := now(); NEW.approved_by := auth.uid(); END IF;
    ELSE
      NEW.approved_by := OLD.approved_by;
    END IF;
    IF NEW.status = 'received' AND OLD.status <> 'ordered' THEN
      RAISE EXCEPTION 'ต้องสั่งซื้อก่อนจึงจะรับของได้';
    END IF;
    IF NEW.status = 'pending' AND OLD.status = 'ordered' THEN NEW.ordered_at := NULL; END IF;
    NEW.received_at := OLD.received_at;
    IF NEW.status IS DISTINCT FROM 'ordered' OR OLD.status = 'ordered' THEN NEW.ordered_at := coalesce(NEW.ordered_at, OLD.ordered_at); END IF;
  END IF;

  IF NEW.status = 'ordered' AND (TG_OP = 'INSERT' OR OLD.status <> 'ordered') THEN
    IF NEW.kind = 'sundry' AND NOT is_admin AND NEW.approved_at IS NULL THEN
      RAISE EXCEPTION 'ใบขอซื้อของจิปาถะ ต้องให้ผู้ดูแลระบบอนุมัติก่อนสั่งซื้อ';
    END IF;
    IF NEW.kind = 'sundry' AND is_admin AND NEW.approved_at IS NULL THEN
      NEW.approved_at := now(); NEW.approved_by := auth.uid();
    END IF;
    NEW.ordered_at := now();
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status = 'received' AND OLD.status = 'ordered' THEN
    NEW.received_at := now();
    INSERT INTO stock_movements(sku_id, qty, type, project_id, note, created_by)
    VALUES (NEW.sku_id, NEW.qty, 'receive', NEW.project_id,
            'รับตามใbขอซื้อ'::text, auth.uid());
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.purchase_request_rules() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_purchase_requests_rules BEFORE INSERT OR UPDATE ON public.purchase_requests
  FOR EACH ROW EXECUTE FUNCTION public.purchase_request_rules();