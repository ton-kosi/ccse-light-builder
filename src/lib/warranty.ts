/**
 * Warranty per product type, counted from handover (quotation: "CLIPSO = 5 ปี, LED = 2 ปี,
 * POWER SUPPLY = 1 ปี"). Dates are yyyy-mm-dd. Pure functions, unit tested.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Same day n months later, clamped to the month end (31 Jan + 1 month → 28/29 Feb). */
export function addMonthsIso(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return iso(ny, nm, Math.min(d, last));
}

const dayBefore = (date: string) => {
  const t = new Date(date + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};

/** Last day covered: a 24-month warranty from 24 Oct 2026 runs to 23 Oct 2028. */
export function warrantyEnd(start: string, months: number): string {
  return dayBefore(addMonthsIso(start, months));
}

/**
 * Warranty starts when the work was handed over: the last installation handover, otherwise
 * the day the project first reached status 9 (ส่งมอบ). Null = not handed over yet.
 */
export function warrantyStart(installHandovers: string[], reachedHandover: string | null): string | null {
  const dates = installHandovers.filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1]! : reachedHandover ? reachedHandover.slice(0, 10) : null;
}

/** Months from the CCSE quotations; used while no rules are saved yet. */
export const DEFAULT_WARRANTY_RULES: { category: string; months: number; note: string }[] = [
  { category: "Clipso fabric", months: 60, note: "CLIPSO = 5 ปี" },
  { category: "Clipso track", months: 60, note: "CLIPSO = 5 ปี" },
  { category: "LED ribbon", months: 24, note: "LED = 2 ปี" },
  { category: "LED module", months: 24, note: "LED = 2 ปี" },
  { category: "Neon flex", months: 24, note: "LED = 2 ปี" },
  { category: "Power supply", months: 12, note: "POWER SUPPLY = 1 ปี" },
];

export type WarrantyItem = { category: string; months: number | null; endsOn: string | null; active: boolean };

/** One line per product type in the project, longest warranty first; null months = no rule. */
export function projectWarranty(
  categories: string[],
  rules: Map<string, number>,
  start: string | null,
  today: string,
): WarrantyItem[] {
  return [...new Set(categories)]
    .map((category) => {
      const months = rules.has(category) ? rules.get(category)! : null;
      const endsOn = start && months !== null ? warrantyEnd(start, months) : null;
      return { category, months, endsOn, active: !!endsOn && today <= endsOn };
    })
    .sort((a, b) => (b.months ?? -1) - (a.months ?? -1) || a.category.localeCompare(b.category));
}

/** Is a failed part still covered on the given day? */
export function coverage(
  item: WarrantyItem | undefined,
  start: string | null,
): { status: "in" | "out" | "not_started" | "no_rule"; endsOn: string | null } {
  if (!start) return { status: "not_started", endsOn: null };
  if (!item || item.months === null) return { status: "no_rule", endsOn: null };
  return { status: item.active ? "in" : "out", endsOn: item.endsOn };
}

export const COVERAGE_LABEL: Record<string, string> = {
  in: "อยู่ในประกัน",
  out: "หมดประกัน",
  not_started: "ยังไม่ส่งมอบงาน (ประกันยังไม่เริ่ม)",
  no_rule: "ยังไม่กำหนดระยะประกันของสินค้าประเภทนี้",
};
