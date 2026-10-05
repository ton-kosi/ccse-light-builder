CREATE TABLE public.material_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  quotation_id uuid NOT NULL UNIQUE REFERENCES public.quotations(id) ON DELETE CASCADE,
  issued_by uuid DEFAULT auth.uid(),
  issued_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.material_issues TO authenticated;
GRANT ALL ON public.material_issues TO service_role;
ALTER TABLE public.material_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "issues read" ON public.material_issues FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION private.has_any_app_role(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid) $$;

-- included lines of current quotation (no prices)
CREATE OR REPLACE FUNCTION private.included_lines(_project_id uuid)
RETURNS SETOF public.quote_lines LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT l.* FROM quote_lines l
  JOIN quotations q ON q.id = l.quotation_id AND q.is_current
  JOIN projects p ON p.id = q.project_id
  WHERE p.id = _project_id
    AND (coalesce(trim(l.option_name),'') = '' OR l.option_name = p.selected_option)
$$;

CREATE OR REPLACE FUNCTION private.project_demand(_project_id uuid)
RETURNS TABLE(sku_id uuid, qty numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH ln AS (SELECT * FROM private.included_lines(_project_id) WHERE kind IN ('priced','display','foc')),
  parts AS (
    SELECT r.sku_id, coalesce(ln.qty,0) * r.qty_per_unit AS q FROM ln JOIN recipes r ON r.component_id = ln.component_id
    UNION ALL
    SELECT lr.sku_id, lr.qty FROM ln JOIN line_recipes lr ON lr.quote_line_id = ln.id
  )
  SELECT parts.sku_id, sum(q) FROM parts GROUP BY parts.sku_id
$$;
REVOKE ALL ON FUNCTION private.has_any_app_role(uuid), private.included_lines(uuid), private.project_demand(uuid) FROM public, anon;

CREATE OR REPLACE FUNCTION public.wo_header(_project_id uuid)
RETURNS TABLE(quotation_id uuid, ref_no text, rev text, issued_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT private.has_any_app_role(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  RETURN QUERY SELECT q.id, q.ref_no, q.rev, mi.issued_at
  FROM quotations q LEFT JOIN material_issues mi ON mi.quotation_id = q.id
  WHERE q.project_id = _project_id AND q.is_current;
END $$;

CREATE OR REPLACE FUNCTION public.wo_lines(_project_id uuid)
RETURNS TABLE(id uuid, sort_order int, option_name text, zone text, item_no text, kind text,
  component_code text, component_name text, install_category text, heading_text text,
  circuit_note text, cut_lengths numeric[], qty numeric, unit text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT private.has_any_app_role(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  RETURN QUERY SELECT l.id, l.sort_order, l.option_name, l.zone, l.item_no, l.kind,
    c.code, c.name, c.install_category,
    CASE WHEN l.component_id IS NULL THEN l.customer_text END,
    l.circuit_note, l.cut_lengths, l.qty, coalesce(l.unit, c.unit)
  FROM private.included_lines(_project_id) l
  LEFT JOIN sales_components c ON c.id = l.component_id
  ORDER BY l.sort_order;
END $$;

CREATE OR REPLACE FUNCTION public.wo_pick_list(_project_id uuid)
RETURNS TABLE(sku_id uuid, code text, name text, unit text, qty numeric, on_hand numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT private.has_any_app_role(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  RETURN QUERY SELECT s.id, s.code, s.name, s.unit, d.qty,
    coalesce((SELECT sum(m.qty) FROM stock_movements m WHERE m.sku_id = s.id), 0)
  FROM private.project_demand(_project_id) d JOIN skus s ON s.id = d.sku_id
  ORDER BY s.code;
END $$;

CREATE OR REPLACE FUNCTION public.confirm_material_issue(_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE st smallint; qid uuid; qrev text;
BEGIN
  IF NOT private.has_any_role(auth.uid(), ARRAY['stock','admin']::app_role[]) THEN
    RAISE EXCEPTION 'เฉพาะฝ่ายคลังสินค้าเท่านั้นที่ยืนยันเบิกของได้';
  END IF;
  SELECT status INTO st FROM projects WHERE id = _project_id FOR UPDATE;
  IF st IS DISTINCT FROM 6 THEN RAISE EXCEPTION 'ยืนยันเบิกของได้เฉพาะเมื่อสถานะโปรเจกต์ = 6'; END IF;
  SELECT id, rev INTO qid, qrev FROM quotations WHERE project_id = _project_id AND is_current;
  IF qid IS NULL THEN RAISE EXCEPTION 'ไม่พบใบเสนอราคาปัจจุบัน'; END IF;
  IF EXISTS (SELECT 1 FROM material_issues WHERE quotation_id = qid) THEN
    RAISE EXCEPTION 'Rev % ถูกเบิกของไปแล้ว', qrev;
  END IF;
  INSERT INTO material_issues(project_id, quotation_id, issued_by) VALUES (_project_id, qid, auth.uid());
  INSERT INTO stock_movements(sku_id, qty, type, project_id, note, created_by)
  SELECT d.sku_id, -d.qty, 'issue', _project_id, 'เบิกตามใบ Work Rev ' || qrev, auth.uid()
  FROM private.project_demand(_project_id) d WHERE d.qty > 0;
  UPDATE projects SET status = 7 WHERE id = _project_id;
END $$;

REVOKE ALL ON FUNCTION public.wo_header(uuid), public.wo_lines(uuid), public.wo_pick_list(uuid), public.confirm_material_issue(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.wo_header(uuid), public.wo_lines(uuid), public.wo_pick_list(uuid), public.confirm_material_issue(uuid) TO authenticated;