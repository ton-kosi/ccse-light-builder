/** Purchase history helpers: cost per unit, latest price per SKU and price change. */

export type PurchaseLite = {
  sku_id: string;
  date: string;
  created_at: string;
  qty: number;
  unit_price: number;
  extra_cost: number;
};

/** Cost per unit = price + extra cost (shipping, import duty…) spread over the qty. */
export function unitCost(p: Pick<PurchaseLite, "qty" | "unit_price" | "extra_cost">): number {
  const q = Number(p.qty);
  return Number(p.unit_price) + (q > 0 ? Number(p.extra_cost ?? 0) / q : 0);
}

/** Newest first: by purchase date, then by when it was recorded. */
export function newestFirst<T extends Pick<PurchaseLite, "date" | "created_at">>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at),
  );
}

/** Latest purchase per SKU (the one the stock cost follows). */
export function latestBySku<T extends PurchaseLite>(list: T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const p of newestFirst(list)) if (!out.has(p.sku_id)) out.set(p.sku_id, p);
  return out;
}

/** % change from one cost to the next, 1 decimal; null when there is nothing to compare. */
export function priceChange(before: number | null | undefined, after: number): number | null {
  if (before == null || !(before > 0)) return null;
  return Math.round(((after - before) / before) * 1000) / 10;
}

/** Summary of one SKU's purchases: last, previous, min, max and qty-weighted average cost. */
export function skuSummary<T extends PurchaseLite>(list: T[]) {
  const rows = newestFirst(list);
  if (!rows.length) return null;
  const costs = rows.map(unitCost);
  const qty = rows.reduce((s, p) => s + Number(p.qty), 0);
  const spend = rows.reduce((s, p) => s + unitCost(p) * Number(p.qty), 0);
  return {
    count: rows.length,
    last: costs[0]!,
    previous: costs[1] ?? null,
    change: priceChange(costs[1], costs[0]!),
    min: Math.min(...costs),
    max: Math.max(...costs),
    average: qty > 0 ? spend / qty : 0,
    qty,
  };
}

/** True when the error means the purchases table hasn't been created yet. */
export const isMissingTable = (msg: string | undefined) =>
  !!msg && /purchases/.test(msg) && /does not exist|schema cache|not find/i.test(msg);
