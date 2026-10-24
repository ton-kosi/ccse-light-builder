-- Phase D: collections (ทวงเงิน, workflow step 10). A follow-up log per bill: when, how,
-- who was contacted, what was said, the promised payment date and the next follow-up.
-- Payments people only (admin, accounting). Additive only.
CREATE TABLE public.payment_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.billing_docs(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  followed_on date NOT NULL DEFAULT current_date,
  channel text NOT NULL DEFAULT 'call' CHECK (channel IN ('call','line','email','visit','letter','other')),
  contact text,                -- who we spoke to
  note text,
  promised_on date,            -- customer promised to pay on
  next_on date,                -- next follow-up
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_followups_bill_idx ON public.payment_followups (bill_id, followed_on DESC, created_at DESC);
GRANT SELECT, INSERT, DELETE ON public.payment_followups TO authenticated;
GRANT ALL ON public.payment_followups TO service_role;
ALTER TABLE public.payment_followups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "followups read" ON public.payment_followups FOR SELECT TO authenticated
  USING (private.can_manage_payments(auth.uid()));
CREATE POLICY "followups insert" ON public.payment_followups FOR INSERT TO authenticated
  WITH CHECK (private.can_manage_payments(auth.uid()));
CREATE POLICY "followups delete" ON public.payment_followups FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR private.has_role(auth.uid(), 'admin'));

-- project follows the bill; who logged it is always the signed-in user
CREATE OR REPLACE FUNCTION public.payment_followup_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  SELECT project_id INTO NEW.project_id FROM billing_docs WHERE id = NEW.bill_id;
  IF NEW.project_id IS NULL THEN RAISE EXCEPTION 'ไม่พบใบเบิกเงิน'; END IF;
  NEW.created_by := auth.uid();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.payment_followup_before() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_payment_followups_before BEFORE INSERT ON public.payment_followups
  FOR EACH ROW EXECUTE FUNCTION public.payment_followup_before();
