import { test, expect } from "bun:test";
import { unitCost, latestBySku, priceChange, skuSummary, isMissingTable } from "./purchases.ts";

const P = (sku_id, date, unit_price, qty = 1, extra_cost = 0, created_at = date + "T00:00") => ({
  sku_id, date, created_at, qty, unit_price, extra_cost,
});

test("cost per unit spreads extra cost over the qty", () => {
  expect(unitCost({ qty: 100, unit_price: 50, extra_cost: 1000 })).toBe(60);
  expect(unitCost({ qty: 3, unit_price: 10, extra_cost: 0 })).toBe(10);
});

test("latest purchase wins (by date, then by entry time)", () => {
  const list = [
    P("a", "2026-09-01", 100),
    P("a", "2026-10-01", 120),
    P("a", "2026-10-01", 125, 1, 0, "2026-10-01T09:00"),
    P("b", "2026-08-01", 7),
  ];
  const m = latestBySku(list);
  expect(m.get("a").unit_price).toBe(125);
  expect(m.get("b").unit_price).toBe(7);
});

test("price change and summary", () => {
  expect(priceChange(100, 105)).toBe(5);
  expect(priceChange(null, 105)).toBeNull();
  const s = skuSummary([P("a", "2026-01-01", 100, 10), P("a", "2026-02-01", 110, 30)]);
  expect(s).toMatchObject({ count: 2, last: 110, previous: 100, change: 10, min: 100, max: 110, qty: 40 });
  expect(s.average).toBe(107.5);
  expect(skuSummary([])).toBeNull();
});

test("detects a not-yet-created table", () => {
  expect(isMissingTable('relation "public.purchases" does not exist')).toBe(true);
  expect(isMissingTable("Could not find the table 'public.purchases' in the schema cache")).toBe(true);
  expect(isMissingTable("permission denied")).toBe(false);
});
