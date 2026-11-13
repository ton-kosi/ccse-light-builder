-- Suppliers and purchase orders (owner's PO-CH / PO-ONE workbooks, 13/11/2026). Additive except one widened check.
--   suppliers            one list for both companies (Easy-Acc AP + the PO workbooks' ร้านค้า sheets)
--   purchase_orders      ใบสั่งซื้อ per company: CCSE 26-061 (Western year), ONE 69-093 (Buddhist year), R.1 revisions
--   purchase_order_lines SKU or free text, qty, unit, price, discount; received_qty follows the purchases received
--   purchases.po_line_id goods received against a PO line (stock and cost as before)
-- Prices on a PO are costs: admin sees every PO; the purchase team sees POs without imported SKUs (same rule as purchases).

-- Suppliers -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE,
  name text NOT NULL CHECK (trim(name) <> ''),
  contact_person text,
  phone text,
  fax text,
  email text,
  address text,
  tax_id text,
  branch text,
  credit_days integer CHECK (credit_days IS NULL OR credit_days >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.suppliers FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
DROP POLICY IF EXISTS "suppliers read" ON public.suppliers;
CREATE POLICY "suppliers read" ON public.suppliers FOR SELECT TO authenticated
  USING (private.has_any_role(auth.uid(), ARRAY['admin','stock','accounting','sales','estimator','production']::app_role[]));
DROP POLICY IF EXISTS "suppliers write" ON public.suppliers;
CREATE POLICY "suppliers write" ON public.suppliers FOR INSERT TO authenticated
  WITH CHECK (private.has_any_role(auth.uid(), ARRAY['admin','stock']::app_role[]));
DROP POLICY IF EXISTS "suppliers update" ON public.suppliers;
CREATE POLICY "suppliers update" ON public.suppliers FOR UPDATE TO authenticated
  USING (private.has_any_role(auth.uid(), ARRAY['admin','stock']::app_role[]))
  WITH CHECK (private.has_any_role(auth.uid(), ARRAY['admin','stock']::app_role[]));
DROP POLICY IF EXISTS "suppliers delete" ON public.suppliers;
CREATE POLICY "suppliers delete" ON public.suppliers FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'));

-- Purchase orders -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL DEFAULT 'ccse' REFERENCES public.companies(id),
  po_no text NOT NULL,
  rev text NOT NULL DEFAULT '',
  date date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Bangkok')::date),
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name text NOT NULL,
  attn text,
  phone text,
  fax text,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  run_label text,
  delivery_text text,
  ship_to text DEFAULT 'CCSE OFFICE',
  credit_text text,
  vat_percent numeric NOT NULL DEFAULT 7,
  status text NOT NULL DEFAULT 'ordered' CHECK (status IN ('draft','ordered','received','cancelled','revised')),
  note text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, po_no, rev)
);
CREATE TABLE IF NOT EXISTS public.purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  sku_id uuid REFERENCES public.skus(id) ON DELETE RESTRICT,
  description text NOT NULL CHECK (trim(description) <> ''),
  qty numeric NOT NULL CHECK (qty > 0),
  unit text,
  unit_price numeric NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  discount_percent numeric NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  purchase_request_id uuid REFERENCES public.purchase_requests(id) ON DELETE SET NULL,
  received_qty numeric NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS purchase_order_lines_po_idx ON public.purchase_order_lines(po_id);
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS po_line_id uuid REFERENCES public.purchase_order_lines(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION private.can_see_po(_uid uuid, _po uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.has_role(_uid, 'admin')
      OR (private.has_role(_uid, 'stock') AND NOT EXISTS (
            SELECT 1 FROM public.purchase_order_lines l JOIN public.skus s ON s.id = l.sku_id
            WHERE l.po_id = _po AND s.source IS DISTINCT FROM 'domestic'))
$$;
REVOKE ALL ON FUNCTION private.can_see_po(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_see_po(uuid, uuid) TO authenticated, service_role;

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.purchase_orders, public.purchase_order_lines FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders, public.purchase_order_lines TO authenticated;
GRANT ALL ON public.purchase_orders, public.purchase_order_lines TO service_role;
DROP POLICY IF EXISTS "po read" ON public.purchase_orders;
CREATE POLICY "po read" ON public.purchase_orders FOR SELECT TO authenticated USING (private.can_see_po(auth.uid(), id));
DROP POLICY IF EXISTS "po insert" ON public.purchase_orders;
CREATE POLICY "po insert" ON public.purchase_orders FOR INSERT TO authenticated
  WITH CHECK (private.has_any_role(auth.uid(), ARRAY['admin','stock']::app_role[]));
DROP POLICY IF EXISTS "po update" ON public.purchase_orders;
CREATE POLICY "po update" ON public.purchase_orders FOR UPDATE TO authenticated
  USING (private.can_see_po(auth.uid(), id)) WITH CHECK (private.can_see_po(auth.uid(), id));
DROP POLICY IF EXISTS "po delete" ON public.purchase_orders;
CREATE POLICY "po delete" ON public.purchase_orders FOR DELETE TO authenticated USING (private.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "po lines read" ON public.purchase_order_lines;
CREATE POLICY "po lines read" ON public.purchase_order_lines FOR SELECT TO authenticated USING (private.can_see_po(auth.uid(), po_id));
DROP POLICY IF EXISTS "po lines write" ON public.purchase_order_lines;
CREATE POLICY "po lines write" ON public.purchase_order_lines FOR INSERT TO authenticated
  WITH CHECK (private.can_see_po(auth.uid(), po_id)
    AND (private.has_role(auth.uid(), 'admin') OR sku_id IS NULL OR private.can_see_sku_cost(auth.uid(), sku_id)));
DROP POLICY IF EXISTS "po lines update" ON public.purchase_order_lines;
CREATE POLICY "po lines update" ON public.purchase_order_lines FOR UPDATE TO authenticated
  USING (private.can_see_po(auth.uid(), po_id))
  WITH CHECK (private.can_see_po(auth.uid(), po_id)
    AND (private.has_role(auth.uid(), 'admin') OR sku_id IS NULL OR private.can_see_sku_cost(auth.uid(), sku_id)));
DROP POLICY IF EXISTS "po lines delete" ON public.purchase_order_lines;
CREATE POLICY "po lines delete" ON public.purchase_order_lines FOR DELETE TO authenticated USING (private.can_see_po(auth.uid(), po_id));

-- received_qty and status follow the goods received
CREATE OR REPLACE FUNCTION private.po_received_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE lid uuid; pid uuid;
BEGIN
  FOREACH lid IN ARRAY ARRAY[CASE WHEN TG_OP <> 'INSERT' THEN OLD.po_line_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.po_line_id END] LOOP
    CONTINUE WHEN lid IS NULL;
    UPDATE public.purchase_order_lines l
      SET received_qty = coalesce((SELECT sum(p.qty) FROM public.purchases p WHERE p.po_line_id = lid), 0)
      WHERE l.id = lid RETURNING l.po_id INTO pid;
    IF pid IS NOT NULL THEN
      UPDATE public.purchase_orders o SET status = CASE
          WHEN NOT EXISTS (SELECT 1 FROM public.purchase_order_lines x WHERE x.po_id = pid AND x.sku_id IS NOT NULL AND x.received_qty < x.qty)
            AND EXISTS (SELECT 1 FROM public.purchase_order_lines x WHERE x.po_id = pid AND x.sku_id IS NOT NULL)
          THEN 'received' ELSE 'ordered' END,
        updated_at = now()
      WHERE o.id = pid AND o.status IN ('ordered','received');
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.po_received_sync() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_po_received_sync ON public.purchases;
CREATE TRIGGER trg_po_received_sync AFTER INSERT OR UPDATE OF qty, po_line_id OR DELETE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION private.po_received_sync();

-- PO numbers ----------------------------------------------------------------------------
ALTER TABLE public.doc_counters DROP CONSTRAINT IF EXISTS doc_counters_kind_check;
ALTER TABLE public.doc_counters ADD CONSTRAINT doc_counters_kind_check CHECK (kind IN ('quote','job','po'));

-- CCSE 26-061 (Western year, as in PO-CH), ONE 69-093 (Buddhist year, as in PO-ONE); counts run through the year
CREATE OR REPLACE FUNCTION private.next_po_no(_company_id text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE y int := extract(year FROM (now() AT TIME ZONE 'Asia/Bangkok'))::int; yy text; no text;
BEGIN
  IF NOT private.has_any_role(auth.uid(), ARRAY['admin','stock']::app_role[]) THEN RAISE EXCEPTION 'ไม่มีสิทธิ์'; END IF;
  yy := lpad(((CASE WHEN _company_id = 'one' THEN y + 543 ELSE y END) % 100)::text, 2, '0');
  LOOP
    no := yy || '-' || lpad(private.next_doc_no('po', _company_id, y)::text, 3, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.purchase_orders WHERE company_id = _company_id AND po_no = no);
  END LOOP;
  RETURN no;
END $$;
REVOKE ALL ON FUNCTION private.next_po_no(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.next_po_no(text) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION public.next_po_no(_company_id text)
 RETURNS text LANGUAGE sql SET search_path TO 'public' AS $$ SELECT private.next_po_no(_company_id) $$;
REVOKE EXECUTE ON FUNCTION public.next_po_no(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_po_no(text) TO authenticated;
