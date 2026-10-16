-- Jedi flex rolls in stock demand.
-- Before a work-order roll plan exists, the rolls a quotation needs come from the BOQ's own roll
-- plan (line_recipes noted 'NEO ROLLS <family>', whole 5 m / 10 m rolls). Once the work-order plan
-- exists (it also uses remnants in stock), its rolls replace them.

-- roll families' hidden components no longer carry a per-metre recipe (it gave fractional rolls)
DELETE FROM public.recipes
 WHERE component_id IN (SELECT id FROM public.sales_components WHERE is_roll_product AND code LIKE 'RF-%');

CREATE OR REPLACE FUNCTION private.project_demand(_project_id uuid)
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