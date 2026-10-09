import { formatQty, formatTHB } from "@/lib/format";

export type ClauseSection = "remark" | "warranty" | "note_th" | "warning";

/** Printed in this order, with these headings, as on CCSE's real quotations. */
export const CLAUSE_SECTIONS: { value: ClauseSection; label: string; heading: string }[] = [
  { value: "remark", label: "REMARK", heading: "REMARK :" },
  { value: "warranty", label: "WARRANTY", heading: "WARRANTY :" },
  { value: "note_th", label: "หมายเหตุ", heading: "หมายเหตุ :" },
  { value: "warning", label: "WARNING", heading: "WARNING :" },
];

export function sectionLabel(s: string): string {
  return CLAUSE_SECTIONS.find((x) => x.value === s)?.label ?? s;
}

/** Groups rows by section in print order; sections without rows are omitted. */
export function groupBySection<T extends { section: string; sort_order: number }>(rows: T[]) {
  return CLAUSE_SECTIONS.map((s) => ({
    ...s,
    rows: rows.filter((r) => r.section === s.value).sort((a, b) => a.sort_order - b.sort_order),
  })).filter((g) => g.rows.length > 0);
}

const TRIGGER_PRINT: Record<string, string> = {
  deposit: "DEPOSIT",
  before_delivery: "BEFORE DELIVERY",
  material_on_site: "MATERIAL ON SITE",
  after_delivery: "AFTER DELIVERY",
  substantial_completion: "AFTER SUBSTANTIAL COMPLETION",
  progress: "PROGRESS PAYMENT",
};

/** Default TERM OF PAYMENT line, e.g. "50% DEPOSIT" or "120,000.00 BAHT AFTER DELIVERY". */
export function defaultPrintLabel(t: {
  percent: number | string | null;
  fixed_amount: number | string | null;
  trigger: string | null;
}): string {
  const what = TRIGGER_PRINT[t.trigger ?? ""] ?? "";
  const fixed = t.fixed_amount === null || t.fixed_amount === "" ? null : Number(t.fixed_amount);
  const amount =
    fixed !== null ? `${formatTHB(fixed)} BAHT` : `${formatQty(Number(t.percent ?? 0))}%`;
  return `${amount} ${what}`.trim();
}

/** The label actually printed: the saved one, or the default when empty. */
export function termPrintLabel(t: {
  print_label: string | null;
  percent: number | string | null;
  fixed_amount: number | string | null;
  trigger: string | null;
}): string {
  return t.print_label?.trim() || defaultPrintLabel(t);
}
