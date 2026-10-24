-- Phase C: warranty per product type + repair tickets (workflow step 11).
-- Warranty starts at handover; months per SKU category (quotation: CLIPSO 5 ปี, LED 2 ปี,
-- POWER SUPPLY 1 ปี). Additive only.

-- 1. Warranty months per SKU category -------------------------------------------------
CREATE TABLE public.warranty_rules (
  category text PRIMARY KEY,               -- SKU category name, e.g. "LED ribbon"
  months integer NOT NULL CHECK (months >= 0),
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warranty_rules TO authenticated;
GRANT ALL ON public.warranty_rules TO service_role;
ALTER TABLE public.warranty_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "warranty rules read" ON public.warranty_rules FOR SELECT TO authenticated
  USING (private.has_any_app_role(auth.uid()));
CREATE POLICY "warranty rules write" ON public.warranty_rules FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin')) WITH CHECK (private.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_warranty_rules_updated BEFORE UPDATE ON public.warranty_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.warranty_rules (category, months, note) VALUES
  ('Clipso fabric', 60, 'CLIPSO = 5 ปี'),
  ('Clipso track', 60, 'CLIPSO = 5 ปี'),
  ('LED ribbon', 24, 'LED = 2 ปี'),
  ('LED module', 24, 'LED = 2 ปี'),
  ('Neon flex', 24, 'LED = 2 ปี'),
  ('Power supply', 12, 'POWER SUPPLY = 1 ปี')
ON CONFLICT (category) DO NOTHING;

-- 2. Repair tickets (ใบแจ้งซ่อม) -------------------------------------------------------
CREATE TABLE public.service_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no text NOT NULL UNIQUE,                    -- SR69-0001
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  reported_on date NOT NULL DEFAULT current_date,
  reporter text,                                     -- who called, phone
  problem text NOT NULL CHECK (trim(problem) <> ''),
  part_category text,                                -- warranty category of the failed part
  in_warranty boolean,                               -- decided when the ticket is opened
  warranty_ends_on date,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','scheduled','done','quoted','closed','cancelled')),
  work_order_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  production_wo_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  quote_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_tickets_project_idx ON public.service_tickets (project_id);
GRANT SELECT, INSERT, UPDATE ON public.service_tickets TO authenticated;
GRANT ALL ON public.service_tickets TO service_role;
ALTER TABLE public.service_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tickets read" ON public.service_tickets FOR SELECT TO authenticated
  USING (private.has_any_app_role(auth.uid()));
CREATE POLICY "tickets insert" ON public.service_tickets FOR INSERT TO authenticated
  WITH CHECK (private.can_plan_work(auth.uid()));
CREATE POLICY "tickets update" ON public.service_tickets FOR UPDATE TO authenticated
  USING (private.can_plan_work(auth.uid())) WITH CHECK (private.can_plan_work(auth.uid()));
CREATE TRIGGER trg_service_tickets_updated BEFORE UPDATE ON public.service_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ticket number per Buddhist year: SR69-0001, SR69-0002 …
CREATE OR REPLACE FUNCTION public.service_ticket_number() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE prefix text; n int;
BEGIN
  prefix := 'SR' || lpad(((extract(year FROM NEW.reported_on)::int + 543) % 100)::text, 2, '0') || '-';
  PERFORM pg_advisory_xact_lock(hashtext(prefix));
  SELECT coalesce(max(substring(ticket_no FROM length(prefix) + 1)::int), 0) + 1 INTO n
    FROM service_tickets WHERE ticket_no LIKE prefix || '%';
  NEW.ticket_no := prefix || lpad(n::text, 4, '0');
  NEW.created_by := auth.uid();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.service_ticket_number() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_service_tickets_number BEFORE INSERT ON public.service_tickets
  FOR EACH ROW EXECUTE FUNCTION public.service_ticket_number();
