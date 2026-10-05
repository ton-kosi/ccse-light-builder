CREATE OR REPLACE FUNCTION public.material_demand()
RETURNS TABLE(project_id uuid, project_status smallint, sku_id uuid, qty numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT private.can_view_master(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  RETURN QUERY
  WITH lines AS (
    SELECT l.id, l.component_id, coalesce(l.qty,0) AS qty, p.id AS pid, p.status
    FROM quote_lines l
    JOIN quotations q ON q.id = l.quotation_id AND q.is_current
    JOIN projects p ON p.id = q.project_id
    WHERE l.kind IN ('priced','display','foc')
      AND (coalesce(trim(l.option_name),'') = '' OR l.option_name = p.selected_option)
    -- TODO roll plan (Prompt 8): roll-product components treated as normal lines for now
  ), parts AS (
    SELECT ln.pid, ln.status, r.sku_id, ln.qty * r.qty_per_unit AS q
    FROM lines ln JOIN recipes r ON r.component_id = ln.component_id
    UNION ALL
    SELECT ln.pid, ln.status, lr.sku_id, lr.qty
    FROM lines ln JOIN line_recipes lr ON lr.quote_line_id = ln.id
  )
  SELECT pid, status, parts.sku_id, sum(q) FROM parts GROUP BY pid, status, parts.sku_id;
END $$;
REVOKE ALL ON FUNCTION public.material_demand() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.material_demand() TO authenticated;