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

/**
 * Which clause ids a quotation needs: "always" clauses, clauses linked to the sales components
 * on its lines, and clauses linked to the SKUs those lines actually use (via line recipes or the
 * component's standard recipe). A SKU is linked through its one-SKU component (see skuPrices.ts).
 * Pure so it can be tested.
 */
export function neededClauseIds(input: {
  lines: { id: string; component_id: string | null; option_name: string | null; kind: string }[];
  selectedOption: string | null;
  lineRecipes: { quote_line_id: string; sku_id: string }[];
  recipes: { component_id: string; sku_id: string }[];
  componentClauses: { component_id: string; clause_id: string }[];
  clauses: { id: string; active: boolean; always_include: boolean }[];
}): Set<string> {
  const opt = input.selectedOption?.trim() ?? "";
  const included = input.lines.filter(
    (l) =>
      l.kind !== "heading" &&
      (!(l.option_name ?? "").trim() || (l.option_name ?? "").trim() === opt),
  );
  const ids = new Set(included.map((l) => l.id));
  const comps = new Set(included.map((l) => l.component_id).filter(Boolean) as string[]);

  const skus = new Set(
    input.lineRecipes.filter((r) => ids.has(r.quote_line_id)).map((r) => r.sku_id),
  );
  for (const r of input.recipes) if (comps.has(r.component_id)) skus.add(r.sku_id);

  const rowsPerComp = new Map<string, number>();
  for (const r of input.recipes)
    rowsPerComp.set(r.component_id, (rowsPerComp.get(r.component_id) ?? 0) + 1);
  for (const r of input.recipes)
    if (rowsPerComp.get(r.component_id) === 1 && skus.has(r.sku_id)) comps.add(r.component_id);

  const active = new Map(input.clauses.map((c) => [c.id, c]));
  const need = new Set<string>();
  for (const c of input.clauses) if (c.active && c.always_include) need.add(c.id);
  for (const cc of input.componentClauses)
    if (comps.has(cc.component_id) && active.get(cc.clause_id)?.active) need.add(cc.clause_id);
  return need;
}
