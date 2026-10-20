/** Stock count (ตรวจนับ): turn counted quantities into the adjustments that bring on-hand to the count. */

export const STOCK_COUNT_NOTE = "ตรวจนับสต็อก (นำเข้า CSV)";

/** Counted qty from a CSV cell: blank = not counted, otherwise a number ≥ 0 (commas allowed). */
export function parseCount(value: string | undefined): number | null | "invalid" {
  const v = (value ?? "").trim().replace(/,/g, "");
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : "invalid";
}

/**
 * One adjustment per SKU whose count differs from what is on hand.
 * Later rows for the same SKU win, so a file can be corrected by appending a row.
 */
export function countAdjustments(
  counts: { skuId: string; qty: number }[],
  onHand: Map<string, number>,
): { sku_id: string; qty: number }[] {
  const latest = new Map<string, number>();
  for (const c of counts) latest.set(c.skuId, c.qty);
  const out: { sku_id: string; qty: number }[] = [];
  for (const [skuId, qty] of latest) {
    // round away float noise so 0.1 + 0.2 style differences don't create tiny movements
    const diff = Math.round((qty - (onHand.get(skuId) ?? 0)) * 1e6) / 1e6;
    if (diff !== 0) out.push({ sku_id: skuId, qty: diff });
  }
  return out;
}
