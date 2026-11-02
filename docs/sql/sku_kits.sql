-- Parts lists (สูตรประกอบ), owner 31/10/2026. A SKU can be made from other SKUs:
--   kit_mode 'stock'   = assembled in-house ahead of time and kept in stock (V2 Snap mount,
--                        Strip Snap = CNC acrylic housing + magnets). "ประกอบเข้าสต็อก" takes the
--                        parts out and puts the finished items in (assemble_kit).
--   kit_mode 'phantom' = never stocked itself; when a project needs it, the material demand,
--                        pick list, store issue and purchase requests use its parts instead
--                        (Power dimmer, Mini dim, Manual dimmer, Smart control).
-- Additive: one column, one table, one new function, project_demand wraps the old logic.

ALTER TABLE public.skus ADD COLUMN IF NOT EXISTS kit_mode text NOT NULL DEFAULT 'none';
ALTER TABLE public.skus ADD CONSTRAINT skus_kit_mode_check CHECK (kit_mode IN ('none', 'stock', 'phantom'));

CREATE TABLE IF NOT EXISTS public.sku_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_sku_id uuid NOT NULL REFERENCES public.skus(id) ON DELETE CASCADE,
  component_sku_id uuid NOT NULL REFERENCES public.skus(id) ON DELETE RESTRICT,
  qty numeric NOT NULL CHECK (qty > 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kit_sku_id, component_sku_id),
  CHECK (kit_sku_id <> component_sku_id)
);
CREATE INDEX IF NOT EXISTS sku_components_component_idx ON public.sku_components (component_sku_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sku_components TO authenticated;
GRANT ALL ON public.sku_components TO service_role;
ALTER TABLE public.sku_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kit parts read" ON public.sku_components FOR SELECT TO authenticated
  USING (private.can_view_master(auth.uid()));
CREATE POLICY "kit parts write" ON public.sku_components FOR ALL TO authenticated
  USING (private.can_edit_master(auth.uid())) WITH CHECK (private.can_edit_master(auth.uid()));

-- The demand of a project as before (BOQ recipes, line recipes, roll plans) …
CREATE OR REPLACE FUNCTION private.project_demand_direct(_project_id uuid)
RETURNS TABLE(sku_id uuid, qty numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH hp AS (SELECT EXISTS (SELECT 1 FROM roll_plans WHERE project_id = _project_id) AS v),
  ln AS (
    SELECT l.id, l.component_id, l.qty, coalesce(c.is_roll_product, false) AS is_roll
    FROM private.included_lines(_project_id) l LEFT JOIN sales_components c ON c.id = l.component_id
    WHERE l.kind IN ('priced','display','foc')
  ),
  parts AS (
    SELECT r.sku_id, coalesce(ln.qty,0) * r.qty_per_unit AS q
    FROM ln JOIN recipes r ON r.component_id = ln.component_id JOIN skus s ON s.id = r.sku_id CROSS JOIN hp
    WHERE NOT (hp.v AND ln.is_roll AND s.is_roll)
    UNION ALL
    SELECT lr.sku_id, lr.qty FROM ln JOIN line_recipes lr ON lr.quote_line_id = ln.id CROSS JOIN hp
    WHERE NOT (hp.v AND coalesce(lr.note, '') LIKE 'NEO ROLLS%')
    UNION ALL
    SELECT rp.sku_id, count(*)::numeric FROM roll_plans rp
    WHERE rp.project_id = _project_id AND rp.source = 'new_roll' GROUP BY rp.sku_id
  )
  SELECT parts.sku_id, sum(q) FROM parts GROUP BY parts.sku_id
$$;
REVOKE ALL ON FUNCTION private.project_demand_direct(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.project_demand_direct(uuid) TO authenticated, service_role;

-- … with 'phantom' kits replaced by their parts (one level; a kit without parts stays itself).
-- Everything that uses project_demand (pick list, store issue, stock reservations, purchase
-- demand) follows automatically.
CREATE OR REPLACE FUNCTION private.project_demand(_project_id uuid)
RETURNS TABLE(sku_id uuid, qty numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT coalesce(c.component_sku_id, d.sku_id), sum(d.qty * coalesce(c.qty, 1))
  FROM private.project_demand_direct(_project_id) d
  LEFT JOIN skus k ON k.id = d.sku_id AND k.kit_mode = 'phantom'
  LEFT JOIN sku_components c ON c.kit_sku_id = k.id
  GROUP BY 1
$$;

-- ประกอบเข้าสต็อก: parts out, finished items in (admin, store, production).
CREATE OR REPLACE FUNCTION public.assemble_kit(_kit_sku_id uuid, _qty numeric, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE k skus; n int; label text;
BEGIN
  IF NOT private.has_any_role(auth.uid(), ARRAY['admin','stock','production']::app_role[]) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์ประกอบสินค้าเข้าสต็อก';
  END IF;
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'จำนวนต้องมากกว่า 0'; END IF;
  SELECT * INTO k FROM skus WHERE id = _kit_sku_id;
  IF k.id IS NULL THEN RAISE EXCEPTION 'ไม่พบสินค้า'; END IF;
  IF k.kit_mode <> 'stock' THEN RAISE EXCEPTION 'สินค้านี้ไม่ได้ตั้งเป็น "ประกอบเก็บสต็อก"'; END IF;
  SELECT count(*) INTO n FROM sku_components WHERE kit_sku_id = k.id;
  IF n = 0 THEN RAISE EXCEPTION 'ยังไม่มีสูตรประกอบของ %', k.code; END IF;
  label := 'ประกอบ ' || k.code || ' × ' || _qty || coalesce(' · ' || nullif(trim(_note), ''), '');
  INSERT INTO stock_movements (sku_id, qty, type, note, created_by)
  SELECT c.component_sku_id, -(c.qty * _qty), 'issue', label, auth.uid()
  FROM sku_components c WHERE c.kit_sku_id = k.id;
  INSERT INTO stock_movements (sku_id, qty, type, note, created_by)
  VALUES (k.id, _qty, 'receive', label, auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.assemble_kit(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assemble_kit(uuid, numeric, text) TO authenticated, service_role;
