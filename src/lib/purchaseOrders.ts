/**
 * Purchase orders (ใบสั่งซื้อ) and suppliers. Pure helpers; the tables come from migration
 * 0039_suppliers_purchase_orders. Prices on a PO are costs: shown to admin and the purchase team only.
 */
import { supabase } from "@/integrations/supabase/client";

export type Supplier = {
  id: string;
  code: string | null;
  name: string;
  contact_person: string | null;
  phone: string | null;
  fax: string | null;
  email: string | null;
  address: string | null;
  tax_id: string | null;
  branch: string | null;
  credit_days: number | null;
  notes: string | null;
};

export type PurchaseOrder = {
  id: string;
  company_id: string;
  po_no: string;
  rev: string;
  date: string;
  supplier_id: string | null;
  supplier_name: string;
  attn: string | null;
  phone: string | null;
  fax: string | null;
  project_id: string | null;
  run_label: string | null;
  delivery_text: string | null;
  ship_to: string | null;
  credit_text: string | null;
  vat_percent: number;
  status: "draft" | "ordered" | "received" | "cancelled" | "revised";
  note: string | null;
  created_at: string;
};

export type PoLine = {
  id: string;
  po_id: string;
  sort_order: number;
  sku_id: string | null;
  description: string;
  qty: number;
  unit: string | null;
  unit_price: number;
  discount_percent: number;
  purchase_request_id: string | null;
  received_qty: number;
};

export const PO_STATUS: Record<PurchaseOrder["status"], { label: string; cls: string }> = {
  draft: { label: "ร่าง", cls: "bg-muted text-muted-foreground" },
  ordered: { label: "สั่งแล้ว รอของ", cls: "bg-warning/20 text-warning" },
  received: { label: "รับของครบ", cls: "bg-success/15 text-success" },
  cancelled: { label: "ยกเลิก", cls: "bg-destructive/15 text-destructive" },
  revised: { label: "มีฉบับแก้ไขแล้ว", cls: "bg-muted text-muted-foreground" },
};

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Net price per unit after the line discount. */
export const netPrice = (l: Pick<PoLine, "unit_price" | "discount_percent">) =>
  r2(Number(l.unit_price) * (1 - Number(l.discount_percent || 0) / 100));
export const lineAmount = (l: Pick<PoLine, "qty" | "unit_price" | "discount_percent">) =>
  r2(Number(l.qty) * Number(l.unit_price) * (1 - Number(l.discount_percent || 0) / 100));

export function poTotals(lines: Pick<PoLine, "qty" | "unit_price" | "discount_percent">[], vatPercent: number) {
  const subtotal = r2(lines.reduce((s, l) => s + lineAmount(l), 0));
  const vat = r2((subtotal * Number(vatPercent || 0)) / 100);
  return { subtotal, vat, total: r2(subtotal + vat) };
}

/** "" → "R.1" → "R.2", as the PO workbooks name a changed order. */
export function nextPoRev(rev: string): string {
  const n = Number(rev.match(/(\d+)\s*$/)?.[1] ?? 0);
  return `R.${n + 1}`;
}
export const poLabel = (po: Pick<PurchaseOrder, "po_no" | "rev">) => (po.rev ? `${po.po_no} ${po.rev}` : po.po_no);

/** What still has to arrive on a line. */
export const remainingQty = (l: Pick<PoLine, "qty" | "received_qty">) =>
  Math.max(0, Math.round((Number(l.qty) - Number(l.received_qty || 0)) * 1000) / 1000);

/** Company name reduced to what tells suppliers apart: "บริษัท แสงงามกรุ๊ป (2535) จำกัด" = "แสงงามกรุ๊ป2535". */
export function companyKey(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/ํา/g, "ำ")
    .replace(/บริษัท|บจก\.?|บ\.|จำกัด|\(มหาชน\)|มหาชน|ห้างหุ้นส่วนจำกัด|หจก\.?|ห้างหุ้นส่วนสามัญ|สำนักงานใหญ่|ร้าน/g, "")
    .replace(/co\.?,?\s*ltd\.?|company limited|limited|ltd\.?|inc\.?|\(thailand\)|thailand|pte\.?|sdn\.?\s*bhd\.?/g, "")
    .replace(/[^0-9a-z฀-๿]/g, "");
}

/** Untyped access until Lovable regenerates the database types for the new tables. */
type Res<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = (table: "suppliers" | "purchase_orders" | "purchase_order_lines"): any =>
  (supabase.from as unknown as (t: string) => unknown)(table);
export type { Res };
export const tableMissing = (message: string | undefined) => /schema cache|does not exist|Could not find the table/i.test(message ?? "");
