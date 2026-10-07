CREATE OR REPLACE FUNCTION public.quote_line_discount_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE _max numeric; _lp numeric;
BEGIN
  IF NEW.component_id IS NULL THEN RETURN NEW; END IF;
  SELECT max_discount_percent, list_price INTO _max, _lp FROM public.component_prices WHERE component_id = NEW.component_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF COALESCE(NEW.discount_percent,0) > COALESCE(_max, 0) THEN
    RAISE EXCEPTION 'ส่วนลดเกินเพดาน (สูงสุด %%%)', COALESCE(_max,0);
  END IF;
  IF _lp IS NOT NULL AND NEW.unit_price IS NOT NULL AND NEW.unit_price < _lp THEN
    RAISE EXCEPTION 'ราคา @ ต่ำกว่าราคาขาย (%)', _lp;
  END IF;
  RETURN NEW;
END $$;