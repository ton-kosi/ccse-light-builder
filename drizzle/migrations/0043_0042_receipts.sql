-- Receipts (ใบเสร็จรับเงิน), retention and withholding tax certificates (owner's ใบเสร็จรับเงิน 2569.xlsx, 16/11/2026).
-- Additive: columns on payment_receipts, three functions, one widened check.
--   receipt_no         69-11001 = Buddhist year, month of the receipt, count in that month, per company
--   tax_invoice_no     the tax invoice the receipt refers to (CCSE issues those in Easy-Acc)
--   retention_amount   money the customer keeps back (e.g. 5 %); the term stays open for it
--   wht_cert_*         the 3 % withholding tax certificate: when it arrived and its number
-- payment_receipts has no UPDATE grant, so these are set only through the functions below (and stay in the audit log).

ALTER TABLE public.payment_receipts ADD COLUMN IF NOT EXISTS receipt_no text;
ALTER TABLE public.payment_receipts ADD COLUMN IF NOT EXISTS receipt_company_id text REFERENCES public.companies(id);
ALTER TABLE public.payment_receipts ADD COLUMN IF NOT EXISTS tax_invoice_no text;
ALTER TABLE public.payment_receipts ADD COLUMN IF NOT EXISTS retention_amount numeric NOT NULL DEFAULT 0 CHECK (retention_amount >= 0);
ALTER TABLE public.payment_receipts ADD COLUMN IF NOT EXISTS wht_cert_received_on date;
ALTER TABLE public.payment_receipts ADD COLUMN IF NOT EXISTS wht_cert_no text;
CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_no_idx ON public.payment_receipts(receipt_company_id, receipt_no) WHERE receipt_no IS NOT NULL;

ALTER TABLE public.doc_counters DROP CONSTRAINT IF EXISTS doc_counters_kind_check;
ALTER TABLE public.doc_counters ADD CONSTRAINT doc_counters_kind_check CHECK (kind IN ('quote','job','po','receipt'));

-- Give a recorded payment its receipt number (once) and the receipt details
CREATE OR REPLACE FUNCTION private.issue_receipt(_id uuid, _tax_invoice_no text, _retention numeric)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.payment_receipts; co text; d date; ym int; no text;
BEGIN
  IF NOT private.can_manage_payments(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  SELECT * INTO r FROM public.payment_receipts WHERE id = _id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'ไม่พบรายการรับเงิน'; END IF;
  IF r.voided_at IS NOT NULL THEN RAISE EXCEPTION 'รายการรับเงินนี้ถูกลบแล้ว'; END IF;
  IF coalesce(_retention, 0) < 0 THEN RAISE EXCEPTION 'เงินประกันผลงานต้องไม่ติดลบ'; END IF;
  no := r.receipt_no;
  IF no IS NULL THEN
    SELECT q.company_id INTO co FROM public.payment_terms t JOIN public.quotations q ON q.id = t.quotation_id WHERE t.id = r.term_id;
    co := coalesce(co, 'ccse');
    d := r.received_date;
    ym := extract(year FROM d)::int * 100 + extract(month FROM d)::int;
    LOOP
      no := lpad(((extract(year FROM d)::int + 543) % 100)::text, 2, '0') || '-' || to_char(d, 'MM')
        || lpad(private.next_doc_no('receipt', co, ym)::text, 3, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.payment_receipts WHERE receipt_company_id = co AND receipt_no = no);
    END LOOP;
    UPDATE public.payment_receipts SET receipt_no = no, receipt_company_id = co WHERE id = _id;
  END IF;
  UPDATE public.payment_receipts
    SET tax_invoice_no = nullif(trim(coalesce(_tax_invoice_no, '')), ''), retention_amount = coalesce(_retention, 0)
    WHERE id = _id;
  RETURN no;
END $$;
REVOKE ALL ON FUNCTION private.issue_receipt(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.issue_receipt(uuid, text, numeric) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.issue_receipt(_id uuid, _tax_invoice_no text, _retention numeric)
 RETURNS text LANGUAGE sql SET search_path TO 'public' AS $$ SELECT private.issue_receipt(_id, _tax_invoice_no, _retention) $$;
REVOKE EXECUTE ON FUNCTION public.issue_receipt(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_receipt(uuid, text, numeric) TO authenticated;

-- The customer's withholding tax certificate arrived (or set back to not yet: _received_on null)
CREATE OR REPLACE FUNCTION private.set_wht_certificate(_id uuid, _received_on date, _cert_no text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT private.can_manage_payments(auth.uid()) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  UPDATE public.payment_receipts
    SET wht_cert_received_on = _received_on,
        wht_cert_no = CASE WHEN _received_on IS NULL THEN NULL ELSE nullif(trim(coalesce(_cert_no, '')), '') END
    WHERE id = _id AND voided_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION private.set_wht_certificate(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.set_wht_certificate(uuid, date, text) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.set_wht_certificate(_id uuid, _received_on date, _cert_no text)
 RETURNS void LANGUAGE sql SET search_path TO 'public' AS $$ SELECT private.set_wht_certificate(_id, _received_on, _cert_no) $$;
REVOKE EXECUTE ON FUNCTION public.set_wht_certificate(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_wht_certificate(uuid, date, text) TO authenticated;
