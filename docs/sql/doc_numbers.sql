-- Automatic document numbers (owner, 07/11/2026). Additive: one table, functions and triggers.
--   Quotation ref: QC26-11-07-001 = prefix (QC CCSE / QO One), year, month, day, then the company's count
--                  for that day (restarts every day). A new Rev keeps the ref.
--   Rev:           first one stays A (hidden on print), then R.01, R.02 …
--   P/J no:        69-048 = Buddhist year + running count shared by both companies. Given automatically
--                  when the project reaches 6 (deposit received / CEO approved), or earlier by button.
-- Issued in the database so two people can never get the same number. Numbers are not reused.

CREATE TABLE IF NOT EXISTS public.doc_counters (
  kind text NOT NULL CHECK (kind IN ('quote', 'job')),
  company_id text NOT NULL DEFAULT '-',
  -- quote: the day as yyyymmdd (count restarts daily); job: the year
  year integer NOT NULL,
  last_no integer NOT NULL DEFAULT 0 CHECK (last_no >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, company_id, year)
);
ALTER TABLE public.doc_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.doc_counters FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON public.doc_counters TO authenticated;
GRANT ALL ON public.doc_counters TO service_role;
CREATE POLICY "doc counters read" ON public.doc_counters FOR SELECT TO authenticated
  USING (private.has_any_app_role(auth.uid()));
CREATE POLICY "doc counters admin insert" ON public.doc_counters FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "doc counters admin update" ON public.doc_counters FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION private.next_doc_no(_kind text, _company text, _year integer)
 RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $$
  INSERT INTO public.doc_counters AS c (kind, company_id, year, last_no, updated_at)
  VALUES (_kind, _company, _year, 1, now())
  ON CONFLICT (kind, company_id, year)
  DO UPDATE SET last_no = c.last_no + 1, updated_at = now()
  RETURNING last_no;
$$;
REVOKE ALL ON FUNCTION private.next_doc_no(text, text, integer) FROM PUBLIC, anon, authenticated;

-- Quotation ref -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.next_quote_ref(_company_id text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE d date := (now() AT TIME ZONE 'Asia/Bangkok')::date; prefix text; ref text;
BEGIN
  IF NOT private.can_edit_quote(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  SELECT coalesce(nullif(quote_prefix, ''), 'QC') INTO prefix FROM public.companies WHERE id = _company_id;
  prefix := coalesce(prefix, 'QC');
  LOOP
    ref := prefix || to_char(d, 'YY-MM-DD') || '-'
      || lpad(private.next_doc_no('quote', _company_id, to_char(d, 'YYYYMMDD')::int)::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.quotations WHERE ref_no = ref)
      AND NOT EXISTS (SELECT 1 FROM public.projects WHERE code = ref);
  END LOOP;
  RETURN ref;
END $$;
REVOKE ALL ON FUNCTION private.next_quote_ref(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.next_quote_ref(text) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.next_quote_ref(_company_id text)
 RETURNS text LANGUAGE sql SET search_path TO 'public' AS $$ SELECT private.next_quote_ref(_company_id) $$;
REVOKE EXECUTE ON FUNCTION public.next_quote_ref(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_quote_ref(text) TO authenticated;

-- P/J number --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.next_job_no()
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE y int := extract(year FROM (now() AT TIME ZONE 'Asia/Bangkok'))::int; no text;
BEGIN
  LOOP
    no := lpad(((y + 543) % 100)::text, 2, '0') || '-' || lpad(private.next_doc_no('job', '-', y)::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.projects WHERE code = no);
  END LOOP;
  RETURN no;
END $$;
REVOKE ALL ON FUNCTION private.next_job_no() FROM PUBLIC, anon, authenticated;

-- Button: some projects start on the PO, before the deposit
CREATE OR REPLACE FUNCTION private.assign_job_no(_project_id uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE p public.projects; no text;
BEGIN
  IF NOT private.can_edit_quote(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  SELECT * INTO p FROM public.projects WHERE id = _project_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'ไม่พบโปรเจกต์'; END IF;
  IF p.code ~ '^\d{2}-\d{3,}(/\d+)?$' THEN RETURN p.code; END IF;
  IF p.status < 4 THEN RAISE EXCEPTION 'ออกเลข P/J ได้เมื่อได้ PO แล้ว (สถานะ 4 ขึ้นไป)'; END IF;
  no := private.next_job_no();
  UPDATE public.projects SET code = no WHERE id = _project_id;
  RETURN no;
END $$;
REVOKE ALL ON FUNCTION private.assign_job_no(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.assign_job_no(uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.assign_job_no(_project_id uuid)
 RETURNS text LANGUAGE sql SET search_path TO 'public' AS $$ SELECT private.assign_job_no(_project_id) $$;
REVOKE EXECUTE ON FUNCTION public.assign_job_no(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_job_no(uuid) TO authenticated;

-- Automatic when the project reaches 6, however it got there
CREATE OR REPLACE FUNCTION private.job_no_on_release()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status >= 6 AND OLD.status < 6 AND NEW.code !~ '^\d{2}-\d{3,}(/\d+)?$' THEN
    NEW.code := private.next_job_no();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.job_no_on_release() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_job_no_on_release ON public.projects;
CREATE TRIGGER trg_job_no_on_release BEFORE UPDATE OF status ON public.projects
  FOR EACH ROW EXECUTE FUNCTION private.job_no_on_release();

-- Rev: R.01, R.02 … on every revision after the first, whichever function creates it
CREATE OR REPLACE FUNCTION private.quotation_rev_number()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE n int; top int;
BEGIN
  SELECT count(*), coalesce(max((substring(rev FROM '^R\.(\d+)$'))::int), 0)
    INTO n, top FROM public.quotations WHERE project_id = NEW.project_id;
  IF n > 0 THEN NEW.rev := 'R.' || lpad((greatest(top, n - 1) + 1)::text, 2, '0'); END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.quotation_rev_number() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_quotation_rev_number ON public.quotations;
CREATE TRIGGER trg_quotation_rev_number BEFORE INSERT ON public.quotations
  FOR EACH ROW EXECUTE FUNCTION private.quotation_rev_number();
