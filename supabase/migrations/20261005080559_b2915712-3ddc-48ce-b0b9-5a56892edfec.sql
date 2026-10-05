ALTER FUNCTION public.confirm_material_issue(uuid) SET SCHEMA private;
ALTER FUNCTION public.material_demand() SET SCHEMA private;
ALTER FUNCTION public.plan_rolls(uuid) SET SCHEMA private;
ALTER FUNCTION public.wo_header(uuid) SET SCHEMA private;
ALTER FUNCTION public.wo_lines(uuid) SET SCHEMA private;
ALTER FUNCTION public.wo_pick_list(uuid) SET SCHEMA private;

REVOKE ALL ON FUNCTION private.confirm_material_issue(uuid), private.material_demand(), private.plan_rolls(uuid),
  private.wo_header(uuid), private.wo_lines(uuid), private.wo_pick_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.confirm_material_issue(uuid), private.material_demand(), private.plan_rolls(uuid),
  private.wo_header(uuid), private.wo_lines(uuid), private.wo_pick_list(uuid) TO authenticated, service_role;

CREATE FUNCTION public.confirm_material_issue(_project_id uuid) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT private.confirm_material_issue(_project_id) $$;

CREATE FUNCTION public.plan_rolls(_project_id uuid) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$ SELECT private.plan_rolls(_project_id) $$;

CREATE FUNCTION public.material_demand()
RETURNS TABLE(project_id uuid, project_status smallint, sku_id uuid, qty numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$ SELECT * FROM private.material_demand() $$;

CREATE FUNCTION public.wo_header(_project_id uuid)
RETURNS TABLE(quotation_id uuid, ref_no text, rev text, issued_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$ SELECT * FROM private.wo_header(_project_id) $$;

CREATE FUNCTION public.wo_lines(_project_id uuid)
RETURNS TABLE(id uuid, sort_order integer, option_name text, zone text, item_no text, kind text, component_code text, component_name text, install_category text, heading_text text, circuit_note text, cut_lengths numeric[], qty numeric, unit text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$ SELECT * FROM private.wo_lines(_project_id) $$;

CREATE FUNCTION public.wo_pick_list(_project_id uuid)
RETURNS TABLE(sku_id uuid, code text, name text, unit text, qty numeric, on_hand numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$ SELECT * FROM private.wo_pick_list(_project_id) $$;

REVOKE ALL ON FUNCTION public.confirm_material_issue(uuid), public.material_demand(), public.plan_rolls(uuid),
  public.wo_header(uuid), public.wo_lines(uuid), public.wo_pick_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_material_issue(uuid), public.material_demand(), public.plan_rolls(uuid),
  public.wo_header(uuid), public.wo_lines(uuid), public.wo_pick_list(uuid) TO authenticated, service_role;