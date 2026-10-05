CREATE SEQUENCE public.remnant_code_seq;

CREATE TABLE public.remnants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE DEFAULT ('R-' || lpad(nextval('public.remnant_code_seq')::text, 4, '0')),
  sku_id uuid NOT NULL REFERENCES public.skus(id) ON DELETE RESTRICT,
  length_m numeric NOT NULL CHECK (length_m > 0),
  source_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','reserved','used','scrapped')),
  reserved_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  used_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  used_m numeric,
  used_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.remnants TO authenticated;
GRANT ALL ON public.remnants TO service_role;
GRANT USAGE ON SEQUENCE public.remnant_code_seq TO authenticated, service_role;
ALTER TABLE public.remnants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "remnants read" ON public.remnants FOR SELECT TO authenticated USING (private.can_view_master(auth.uid()));
CREATE POLICY "remnants insert" ON public.remnants FOR INSERT TO authenticated WITH CHECK (private.can_edit_master(auth.uid()));
CREATE POLICY "remnants update" ON public.remnants FOR UPDATE TO authenticated USING (private.can_edit_master(auth.uid())) WITH CHECK (private.can_edit_master(auth.uid()));

CREATE TABLE public.roll_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  seq int NOT NULL,
  roll_family text NOT NULL,
  sku_id uuid NOT NULL REFERENCES public.skus(id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (source IN ('new_roll','remnant')),
  remnant_id uuid REFERENCES public.remnants(id) ON DELETE SET NULL,
  roll_length_m numeric NOT NULL,
  pieces numeric[] NOT NULL DEFAULT '{}',
  leftover_m numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.roll_plans TO authenticated;
GRANT ALL ON public.roll_plans TO service_role;
ALTER TABLE public.roll_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roll plans read" ON public.roll_plans FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.plan_rolls(_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE fam text; s10 skus; s5 skus; step numeric; maxp numeric; binlen numeric; binsku uuid;
  pcs numeric[]; p numeric; ln record; x numeric; best_plan uuid; best_left numeric;
  best_rem uuid; best_rem_len numeric; seqn int := 0;
BEGIN
  IF NOT private.has_any_role(auth.uid(), ARRAY['admin','estimator','stock','production']::app_role[]) THEN
    RAISE EXCEPTION 'ไม่มีสิทธิ์วางแผนตัดม้วน';
  END IF;
  IF EXISTS (SELECT 1 FROM material_issues mi JOIN quotations q ON q.id = mi.quotation_id AND q.is_current
             WHERE mi.project_id = _project_id) THEN
    RAISE EXCEPTION 'เบิกของ Rev นี้แล้ว ไม่สามารถวางแผนตัดใหม่ได้';
  END IF;
  UPDATE remnants SET status = 'available', reserved_project_id = NULL
   WHERE reserved_project_id = _project_id AND status = 'reserved';
  DELETE FROM roll_plans WHERE project_id = _project_id;

  FOR fam IN
    SELECT DISTINCT c.roll_family FROM private.included_lines(_project_id) l
    JOIN sales_components c ON c.id = l.component_id
    WHERE c.is_roll_product AND l.kind IN ('priced','display','foc') AND coalesce(trim(c.roll_family),'') <> ''
  LOOP
    s10 := NULL; s5 := NULL;
    SELECT * INTO s10 FROM skus WHERE is_roll AND roll_family = fam AND roll_length_m = 10 ORDER BY code LIMIT 1;
    SELECT * INTO s5 FROM skus WHERE is_roll AND roll_family = fam AND roll_length_m = 5 ORDER BY code LIMIT 1;
    IF s10.id IS NULL AND s5.id IS NULL THEN
      RAISE EXCEPTION 'ไม่พบ SKU ม้วน (5 ม. หรือ 10 ม.) ของตระกูล %', fam;
    END IF;
    binsku := coalesce(s10.id, s5.id);
    binlen := CASE WHEN s10.id IS NOT NULL THEN 10 ELSE 5 END;
    step := coalesce(s10.cut_step_cm, s5.cut_step_cm, 0);
    maxp := least(coalesce(s10.max_piece_m, s5.max_piece_m, binlen), binlen);

    pcs := '{}';
    FOR ln IN
      SELECT l.cut_lengths, l.qty FROM private.included_lines(_project_id) l
      JOIN sales_components c ON c.id = l.component_id
      WHERE c.is_roll_product AND c.roll_family = fam AND l.kind IN ('priced','display','foc')
    LOOP
      FOREACH x IN ARRAY coalesce(NULLIF(ln.cut_lengths, '{}'::numeric[]), ARRAY[coalesce(ln.qty, 0)]) LOOP
        IF x IS NULL OR x <= 0 THEN CONTINUE; END IF;
        IF step > 0 THEN x := ceil(round(x * 100 / step, 6)) * step / 100; END IF;
        WHILE x > maxp LOOP pcs := pcs || maxp; x := x - maxp; END LOOP;
        IF x > 0 THEN pcs := pcs || x; END IF;
      END LOOP;
    END LOOP;
    SELECT coalesce(array_agg(v ORDER BY v DESC), '{}') INTO pcs FROM unnest(pcs) v;

    FOREACH p IN ARRAY pcs LOOP
      best_plan := NULL; best_left := NULL; best_rem := NULL; best_rem_len := NULL;
      SELECT rp.id, rp.roll_length_m - (SELECT coalesce(sum(v),0) FROM unnest(rp.pieces) v)
        INTO best_plan, best_left
        FROM roll_plans rp
       WHERE rp.project_id = _project_id AND rp.roll_family = fam AND rp.source = 'remnant'
         AND rp.roll_length_m - (SELECT coalesce(sum(v),0) FROM unnest(rp.pieces) v) >= p
       ORDER BY 2 LIMIT 1;
      SELECT r.id, r.length_m INTO best_rem, best_rem_len
        FROM remnants r JOIN skus s ON s.id = r.sku_id
       WHERE r.status = 'available' AND s.roll_family = fam AND r.length_m >= p
       ORDER BY r.length_m, r.code LIMIT 1;

      IF best_rem IS NOT NULL AND (best_plan IS NULL OR best_rem_len < best_left) THEN
        seqn := seqn + 1;
        INSERT INTO roll_plans(project_id, seq, roll_family, sku_id, source, remnant_id, roll_length_m, pieces)
        SELECT _project_id, seqn, fam, r.sku_id, 'remnant', r.id, r.length_m, ARRAY[p] FROM remnants r WHERE r.id = best_rem;
        UPDATE remnants SET status = 'reserved', reserved_project_id = _project_id WHERE id = best_rem;
      ELSIF best_plan IS NOT NULL THEN
        UPDATE roll_plans SET pieces = pieces || p WHERE id = best_plan;
      ELSE
        best_plan := NULL;
        SELECT rp.id INTO best_plan FROM roll_plans rp
         WHERE rp.project_id = _project_id AND rp.roll_family = fam AND rp.source = 'new_roll'
           AND rp.roll_length_m - (SELECT coalesce(sum(v),0) FROM unnest(rp.pieces) v) >= p
         ORDER BY rp.seq LIMIT 1;
        IF best_plan IS NOT NULL THEN
          UPDATE roll_plans SET pieces = pieces || p WHERE id = best_plan;
        ELSE
          seqn := seqn + 1;
          INSERT INTO roll_plans(project_id, seq, roll_family, sku_id, source, roll_length_m, pieces)
          VALUES (_project_id, seqn, fam, binsku, 'new_roll', binlen, ARRAY[p]);
        END IF;
      END IF;
    END LOOP;

    IF s5.id IS NOT NULL AND binlen = 10 THEN
      UPDATE roll_plans rp SET sku_id = s5.id, roll_length_m = 5
       WHERE rp.project_id = _project_id AND rp.roll_family = fam AND rp.source = 'new_roll'
         AND (SELECT coalesce(sum(v),0) FROM unnest(rp.pieces) v) <= 5;
    END IF;
  END LOOP;

  UPDATE roll_plans rp SET leftover_m = rp.roll_length_m - (SELECT coalesce(sum(v),0) FROM unnest(rp.pieces) v)
   WHERE rp.project_id = _project_id;
END $$;

-- demand: when a roll plan exists, roll SKUs of roll-product lines are replaced by new rolls from the plan
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
    SELECT lr.sku_id, lr.qty FROM ln JOIN line_recipes lr ON lr.quote_line_id = ln.id
    UNION ALL
    SELECT rp.sku_id, count(*)::numeric FROM roll_plans rp
    WHERE rp.project_id = _project_id AND rp.source = 'new_roll' GROUP BY rp.sku_id
  )
  SELECT parts.sku_id, sum(q) FROM parts GROUP BY parts.sku_id
$$;

CREATE OR REPLACE FUNCTION public.material_demand()
RETURNS TABLE(project_id uuid, project_status smallint, sku_id uuid, qty numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT private.can_view_master(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  RETURN QUERY SELECT p.id, p.status, d.sku_id, d.qty
  FROM projects p CROSS JOIN LATERAL private.project_demand(p.id) d
  WHERE p.status BETWEEN 4 AND 6;
END $$;

CREATE OR REPLACE FUNCTION public.confirm_material_issue(_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE st smallint; qid uuid; qrev text; minr numeric;
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

  UPDATE remnants r SET status = 'used', used_project_id = _project_id, used_at = now(),
         used_m = (SELECT sum(v) FROM unnest(rp.pieces) v), reserved_project_id = NULL
    FROM roll_plans rp
   WHERE rp.project_id = _project_id AND rp.source = 'remnant' AND rp.remnant_id = r.id;

  SELECT min_remnant_m INTO minr FROM settings LIMIT 1;
  INSERT INTO remnants(sku_id, length_m, source_project_id, note)
  SELECT sku_id, leftover_m, _project_id, 'เศษจากแผนตัด Rev ' || qrev
    FROM roll_plans WHERE project_id = _project_id AND leftover_m >= coalesce(minr, 1)
   ORDER BY seq;

  UPDATE projects SET status = 7 WHERE id = _project_id;
END $$;

REVOKE ALL ON FUNCTION public.plan_rolls(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.plan_rolls(uuid) TO authenticated;
REVOKE ALL ON FUNCTION private.project_demand(uuid) FROM public, anon;