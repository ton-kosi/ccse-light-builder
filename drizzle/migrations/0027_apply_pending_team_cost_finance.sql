-- Payment team closes the project (owner, 26/10/2026): accounting may move a project
-- 9 ส่งมอบ → 10 วางบิล, and 9/10 → 11 ปิดงาน once nothing is left to collect.
-- They still cannot edit anything else on the project (the projects update policy is unchanged).
-- Additive: two new functions.
CREATE OR REPLACE FUNCTION private.finance_set_project_status(_project_id uuid, _status smallint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cur smallint; owed numeric;
BEGIN
  IF NOT private.can_manage_payments(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  SELECT status INTO cur FROM projects WHERE id = _project_id FOR UPDATE;
  IF cur IS NULL THEN RAISE EXCEPTION 'ไม่พบโปรเจกต์'; END IF;
  IF _status = 10 THEN
    IF cur <> 9 THEN RAISE EXCEPTION 'เปลี่ยนเป็นขั้น 10 วางบิล ได้เมื่อโปรเจกต์อยู่ขั้น 9 ส่งมอบ'; END IF;
  ELSIF _status = 11 THEN
    IF cur NOT IN (9, 10) THEN RAISE EXCEPTION 'ปิดงานได้เมื่อโปรเจกต์อยู่ขั้น 9 หรือ 10'; END IF;
    SELECT coalesce(sum(s.outstanding), 0) INTO owed FROM private.payment_schedule(_project_id) s;
    IF owed > 0.005 THEN
      RAISE EXCEPTION 'ยังมียอดค้างรับ % บาท — ปิดงานไม่ได้', to_char(owed, 'FM999,999,990.00');
    END IF;
  ELSE
    RAISE EXCEPTION 'ทีมการเงินเปลี่ยนได้เฉพาะขั้น 10 วางบิล และ 11 ปิดงาน';
  END IF;
  UPDATE projects SET status = _status WHERE id = _project_id;
END $$;
REVOKE ALL ON FUNCTION private.finance_set_project_status(uuid, smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.finance_set_project_status(uuid, smallint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finance_set_project_status(_project_id uuid, _status smallint)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public AS $$
  SELECT private.finance_set_project_status(_project_id, _status) $$;
REVOKE ALL ON FUNCTION public.finance_set_project_status(uuid, smallint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_set_project_status(uuid, smallint) TO authenticated, service_role;
