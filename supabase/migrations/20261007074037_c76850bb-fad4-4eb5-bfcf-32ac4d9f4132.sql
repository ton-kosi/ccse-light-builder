CREATE TABLE public.component_prices (
  component_id uuid PRIMARY KEY REFERENCES public.sales_components(id) ON DELETE CASCADE,
  list_price numeric,
  max_discount_percent numeric NOT NULL DEFAULT 0 CHECK (max_discount_percent >= 0 AND max_discount_percent <= 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.component_prices TO authenticated;
GRANT ALL ON public.component_prices TO service_role;
ALTER TABLE public.component_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quote roles read prices" ON public.component_prices FOR SELECT TO authenticated USING (private.can_edit_quote(auth.uid()));
CREATE POLICY "admin insert prices" ON public.component_prices FOR INSERT TO authenticated WITH CHECK (private.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin update prices" ON public.component_prices FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), 'admin')) WITH CHECK (private.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin delete prices" ON public.component_prices FOR DELETE TO authenticated USING (private.has_role(auth.uid(), 'admin'));
CREATE TRIGGER component_prices_updated BEFORE UPDATE ON public.component_prices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.quote_line_discount_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _max numeric;
BEGIN
  IF NEW.component_id IS NULL OR COALESCE(NEW.discount_percent,0) = 0 OR private.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  SELECT max_discount_percent INTO _max FROM public.component_prices WHERE component_id = NEW.component_id;
  IF NEW.discount_percent > COALESCE(_max, 0) THEN
    RAISE EXCEPTION 'ส่วนลดเกินเพดาน (สูงสุด %%%)', COALESCE(_max,0);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quote_lines_discount_guard BEFORE INSERT OR UPDATE OF discount_percent, component_id ON public.quote_lines FOR EACH ROW EXECUTE FUNCTION public.quote_line_discount_guard();