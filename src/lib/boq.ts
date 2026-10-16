import type { Tables } from "@/integrations/supabase/types";

export type QuoteLine = Tables<"quote_lines">;
export type LineKind =
  "heading" | "priced" | "display" | "foc" | "by_buyer" | "existing" | "internal";

export const LINE_KINDS: { value: LineKind; label: string }[] = [
  { value: "heading", label: "หัวข้อ" },
  { value: "priced", label: "คิดราคา" },
  { value: "display", label: "แสดงเท่านั้น" },
  { value: "foc", label: "FOC (แถม)" },
  { value: "by_buyer", label: "ลูกค้าจัดหา" },
  { value: "existing", label: "ของเดิม" },
  { value: "internal", label: "โน้ตหลังบ้าน (ใบ Work เท่านั้น)" },
];

/** Lines the customer sees (internal notes only go to the work sheet). */
export const isCustomerLine = (l: Pick<QuoteLine, "kind">) => l.kind !== "internal";

type AmountLine = Pick<QuoteLine, "kind" | "qty" | "unit_price" | "discount_percent">;

/** Amount only for 'priced' lines: qty × price × (1 − disc%). */
export function lineAmount(l: AmountLine): number {
  if (l.kind !== "priced") return 0;
  const gross = Number(l.qty ?? 0) * Number(l.unit_price ?? 0);
  return gross * (1 - Number(l.discount_percent ?? 0) / 100);
}

export function optionNames(lines: Pick<QuoteLine, "option_name">[]): string[] {
  return Array.from(
    new Set(lines.map((l) => l.option_name?.trim() ?? "").filter((x) => x !== "")),
  ).sort();
}

export function optKey(l: Pick<QuoteLine, "option_name">): string {
  return l.option_name?.trim() ?? "";
}

/* ------------------------------------------------------------ totals */

/** How VAT appears on the printed quotation (the money always includes vat_percent). */
export type VatMode = "show" | "excluded" | "none";
export const VAT_MODES: { value: VatMode; label: string }[] = [
  { value: "show", label: "แสดง VAT และยอดรวม VAT" },
  { value: "excluded", label: "ไม่แสดง VAT — เขียน (EXCLUDING VAT x%)" },
  { value: "none", label: "ไม่แสดงเรื่อง VAT เลย" },
];
export const vatModeOf = (v: unknown): VatMode => (v === "excluded" || v === "none" ? v : "show");

/**
 * Contract-style lines between the item total and VAT, e.g. COORDINATION WORK & EXPENSES 3%,
 * OVERHEAD & PROFIT 12%, UNFORESEEN 8% — each percent is on the running total (compounding),
 * an amount adds a fixed sum, a note only prints its text (e.g. ELECTRIC FEE BY BUYER).
 */
export type Adjustment = {
  label: string;
  type: "percent" | "amount" | "note";
  value: number;
  text?: string;
};
export const ADJUSTMENT_PRESETS = [
  "COORDINATION WORK & EXPENSES",
  "OVERHEAD & PROFIT",
  "UNFORESEEN",
  "INSURANCE",
];

export function adjustmentsOf(v: unknown): Adjustment[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a) => ({
      label: String(a["label"] ?? ""),
      type: a["type"] === "amount" || a["type"] === "note" ? a["type"] : "percent",
      value: Number(a["value"] ?? 0) || 0,
      ...(a["text"] ? { text: String(a["text"]) } : {}),
    }));
}

export type QuoteSettings = {
  discount: number;
  vatPercent: number;
  vatMode?: VatMode;
  adjustments?: Adjustment[];
};

/** Grand total = lines without option + lines of the chosen option. */
export function computeTotals(
  lines: (AmountLine & Pick<QuoteLine, "option_name">)[],
  discount: number,
  vatPercent: number,
  option: string | null,
  adjustments: Adjustment[] = [],
) {
  const base = lines.filter((l) => optKey(l) === "").reduce((s, l) => s + lineAmount(l), 0);
  const perOption: Record<string, number> = {};
  for (const l of lines) {
    const k = optKey(l);
    if (k) perOption[k] = (perOption[k] ?? 0) + lineAmount(l);
  }
  const subtotal = base + (option ? (perOption[option] ?? 0) : 0);
  return { base, perOption, ...chain(subtotal, discount, vatPercent, adjustments) };
}

/** Subtotal → special discount → adjustments → VAT. Nothing is rounded on the way (like the Excel BOQs). */
export function chain(
  subtotal: number,
  discount: number,
  vatPercent: number,
  adjustments: Adjustment[] = [],
) {
  const afterDiscount = subtotal - discount;
  let running = afterDiscount;
  const adjusted = adjustments.map((a) => {
    const amount =
      a.type === "percent" ? (running * a.value) / 100 : a.type === "amount" ? a.value : null;
    running += amount ?? 0;
    return { ...a, amount };
  });
  const beforeVat = running;
  const vat = (beforeVat * vatPercent) / 100;
  return { subtotal, afterDiscount, adjusted, beforeVat, vat, net: beforeVat + vat };
}

export type SummaryRow = {
  label: string;
  value: number | string;
  bold?: boolean;
  italic?: boolean;
};

/** The summary lines printed under the items, following the VAT display mode. */
export function summaryRows(subtotal: number, s: QuoteSettings): SummaryRow[] {
  const mode = s.vatMode ?? "show";
  const adj = s.adjustments ?? [];
  const t = chain(subtotal, s.discount, s.vatPercent, adj);
  const rows: SummaryRow[] = [];
  const vatText = `${Number(s.vatPercent)}%`;
  if (adj.length) {
    if (s.discount)
      rows.push(
        { label: "SUB TOTAL", value: t.subtotal },
        { label: "SPECIAL DISCOUNT", value: -s.discount },
      );
    rows.push({ label: "TOTAL I", value: t.afterDiscount });
    for (const a of t.adjusted)
      rows.push({ label: a.label, value: a.amount ?? a.text ?? "", italic: a.amount === null });
    if (mode === "show") rows.push({ label: "TOTAL II", value: t.beforeVat });
  } else if (mode === "show" || s.discount) {
    rows.push({ label: "SUB TOTAL", value: t.subtotal });
    if (s.discount) rows.push({ label: "SPECIAL DISCOUNT", value: -s.discount });
  }
  if (mode === "show") {
    rows.push(
      { label: `VAT ${vatText}`, value: t.vat },
      { label: "GRAND TOTAL (THB)", value: t.net, bold: true },
    );
  } else {
    rows.push({ label: "GRAND TOTAL (THB)", value: t.beforeVat, bold: true });
    if (mode === "excluded")
      rows.push({ label: `(EXCLUDING VAT ${vatText})`, value: "", italic: true });
  }
  return rows;
}

/** "1.50+1.50+1.40" → [1.5, 1.5, 1.4]; empty → null; invalid → undefined */
export function parseCutLengths(text: string): number[] | null | undefined {
  const t = text.trim();
  if (!t) return null;
  const parts = t
    .split(/[+,\s]+/)
    .filter(Boolean)
    .map((x) => Number(x));
  if (parts.some((n) => Number.isNaN(n) || n <= 0)) return undefined;
  return parts;
}

export function formatCutLengths(arr: number[] | null | undefined): string {
  return arr && arr.length ? arr.map((n) => Number(n).toFixed(2)).join("+") : "";
}

export function sumCut(arr: number[] | null | undefined): number {
  return Math.round((arr ?? []).reduce((s, n) => s + Number(n), 0) * 1000) / 1000;
}

/** Initial quotations use A internally; only subsequent revisions have a visible suffix. */
export function quotationRevisionSuffix(rev: string): string {
  return !rev || rev === "A" ? "" : ` Rev ${rev}`;
}
