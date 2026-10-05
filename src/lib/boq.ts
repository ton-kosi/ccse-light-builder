import type { Tables } from "@/integrations/supabase/types";

export type QuoteLine = Tables<"quote_lines">;
export type LineKind = "heading" | "priced" | "display" | "foc" | "by_buyer" | "existing";

export const LINE_KINDS: { value: LineKind; label: string }[] = [
  { value: "heading", label: "หัวข้อ" },
  { value: "priced", label: "คิดราคา" },
  { value: "display", label: "แสดงเท่านั้น" },
  { value: "foc", label: "FOC (แถม)" },
  { value: "by_buyer", label: "ลูกค้าจัดหา" },
  { value: "existing", label: "ของเดิม" },
];

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

/** Grand total = lines without option + lines of the chosen option. */
export function computeTotals(
  lines: (AmountLine & Pick<QuoteLine, "option_name">)[],
  discount: number,
  vatPercent: number,
  option: string | null,
) {
  const base = lines.filter((l) => optKey(l) === "").reduce((s, l) => s + lineAmount(l), 0);
  const perOption: Record<string, number> = {};
  for (const l of lines) {
    const k = optKey(l);
    if (k) perOption[k] = (perOption[k] ?? 0) + lineAmount(l);
  }
  const subtotal = base + (option ? (perOption[option] ?? 0) : 0);
  const afterDiscount = subtotal - discount;
  const vat = (afterDiscount * vatPercent) / 100;
  return { base, perOption, subtotal, afterDiscount, vat, net: afterDiscount + vat };
}

/** "1.50+1.50+1.40" → [1.5, 1.5, 1.4]; empty → null; invalid → undefined */
export function parseCutLengths(text: string): number[] | null | undefined {
  const t = text.trim();
  if (!t) return null;
  const parts = t.split(/[+,\s]+/).filter(Boolean).map((x) => Number(x));
  if (parts.some((n) => Number.isNaN(n) || n <= 0)) return undefined;
  return parts;
}

export function formatCutLengths(arr: number[] | null | undefined): string {
  return arr && arr.length ? arr.map((n) => Number(n).toFixed(2)).join("+") : "";
}

export function sumCut(arr: number[] | null | undefined): number {
  return Math.round((arr ?? []).reduce((s, n) => s + Number(n), 0) * 1000) / 1000;
}
