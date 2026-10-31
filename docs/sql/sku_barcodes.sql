-- Barcode scanning (owner, 31/10/2026): each SKU keeps a list of extra codes that scan to it —
-- supplier barcodes (EAN / UPC on the box) and its own old SKU codes after a rename, so labels
-- already on the shelf keep working. Our printed labels carry the SKU code itself.
-- Additive: one column, one index, one trigger.
ALTER TABLE public.skus ADD COLUMN IF NOT EXISTS barcodes text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS skus_barcodes_idx ON public.skus USING gin (barcodes);

CREATE OR REPLACE FUNCTION public.sku_keep_old_code() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.code IS DISTINCT FROM OLD.code AND NOT (OLD.code = ANY (NEW.barcodes)) THEN
    NEW.barcodes := array_append(NEW.barcodes, OLD.code);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sku_keep_old_code() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_skus_keep_old_code BEFORE UPDATE OF code ON public.skus
  FOR EACH ROW EXECUTE FUNCTION public.sku_keep_old_code();
