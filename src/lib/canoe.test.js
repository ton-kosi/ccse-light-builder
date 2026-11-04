import { test, expect } from "bun:test";
import { buildCanoe, canoeLengths, dotsOfLed, fitRun, parseCanoe, planCanoe } from "./canoe.ts";

const led14 = { code: "LED-Top-14.4-60-3000N", name: "14.4W/m, 24Vdc, 60dots, 3000K, CRI90 Nichia" };
const led96 = { code: "LED-Top-9.6-120-3000", name: "9.6W/m, 24Vdc, 120dots, 3000K, CRI90" };
const cob = { code: "LED-Top-12-COB-3000", name: "12W/m, 24Vdc, COB, 3000K, CRI90" };
const led72 = { code: "LED-Top-7.2-30-3000N", name: "7.2W/m, 24Vdc, 30dots, 3000K, CRI90 Nichia" };
const led128 = { code: "LED-Top-4.8-128-3000", name: "4.8W/m, 24Vdc, 128dots, 3000K, CRI90" };

test("piece lengths per LED (workbook table), double = +5 mm", () => {
  expect(canoeLengths(led14, false)).toEqual({ L: 0.5, M: 0.4, S: 0.3, SS: 0.2 });
  expect(canoeLengths(led96, false)?.L).toBeCloseTo(0.505, 6);
  expect(canoeLengths(cob, false)?.SS).toBeCloseTo(0.215, 6);
  expect(canoeLengths(cob, true)?.L).toBeCloseTo(0.52, 6);
  expect(canoeLengths(led72, false)).toEqual({ L: 0.5, S: 0.34, SS: 0.24 }); // no M
  expect(canoeLengths(led128, false)).toBeNull(); // not made as Canoe
  expect(dotsOfLed(cob)).toBe("COB");
});

const L14 = canoeLengths(led14, false);

test("FAIRMONT runs: fewest pieces within +5 / -10 cm", () => {
  // 2.49 m → 5 L = 2.51 (2 cm over)
  expect(fitRun(2.49, L14)).toMatchObject({ counts: { L: 5, M: 0, S: 0, SS: 0 }, totalM: 2.51, ok: true });
  // 7.92 m → 15 L + 1 M = 7.932, as in the workbook
  expect(fitRun(7.92, L14)?.counts).toEqual({ L: 15, M: 1, S: 0, SS: 0 });
  // 4.44 m → 8 L + 1 M = 4.418 (2.2 cm short), as in the workbook
  expect(fitRun(4.44, L14)).toMatchObject({ counts: { L: 8, M: 1, S: 0, SS: 0 }, totalM: 4.418 });
  // 4.18 m → 9 pieces either way; the closer one: 8 L + 1 SS = 4.218 (3.8 cm over)
  expect(fitRun(4.18, L14)).toMatchObject({ counts: { L: 8, M: 0, S: 0, SS: 1 }, pieces: 9 });
  // 9.6W 120: 5.19 m → 10 L × 0.507 = 5.07 (12 cm short) is out; 10 L + 1 SS = 5.277? (8.7 over) out
  const f = fitRun(5.19, canoeLengths(led96, false));
  expect(f?.ok).toBe(true);
  expect(Math.abs(f.diffM) <= 0.1).toBe(true);
});

test("a run too short for any piece is reported, not hidden", () => {
  const f = fitRun(0.08, L14);
  expect(f?.ok).toBe(false);
  expect(f?.counts.SS).toBe(1);
});

test("7.2W Nichia never uses M", () => {
  for (const len of [0.9, 1.3, 2.75, 4.2]) expect(fitRun(len, canoeLengths(led72, false))?.counts.M).toBe(0);
});

test("plan: LED metres (double = 2 ×) and run metres", () => {
  const single = planCanoe({ double: false, runs: [{ length: 2.49, sets: 2 }] }, led14);
  expect(single.totals.L).toBe(10);
  expect(single.ledM).toBe(5);
  expect(single.runM).toBe(4.98);
  const dbl = planCanoe({ double: true, runs: [{ length: 2.49, sets: 1 }] }, led14);
  expect(dbl.ledM).toBe(dbl.totals.L * 0.5 * 2 + dbl.totals.SS * 0.2 * 2 + dbl.totals.S * 0.3 * 2 + dbl.totals.M * 0.4 * 2);
});

test("BOQ rows: price per metre from parts, housing required, config round-trips", () => {
  const prices = new Map([
    ["led", { unitPrice: 1000, maxDiscount: 10 }],
    ["hL", { unitPrice: 200, maxDiscount: 0 }],
  ]);
  let n = 0;
  const cfg = { v: 1, blockId: "b1", code: "CN 01", title: "CANOE", ledSkuId: "led", double: false, housing: { L: "hL" }, runs: [{ length: 2.49, sets: 1 }], rowIds: [] };
  const b = buildCanoe(cfg, led14, prices, () => `r${n++}`);
  // 5 L: LED 2.5 m × 1000 + 5 × 200 = 3,500 over 2.49 m
  expect(b.rows[1]).toMatchObject({ kind: "priced", qty: 2.49, unit: "M.", unit_price: 1405.62, cut_lengths: [2.49] });
  expect(b.rows[1].recipes.map((r) => [r.sku_id, r.qty])).toEqual([["led", 2.5], ["hL", 5]]);
  expect(b.problems).toEqual([]);
  expect(b.maxDiscount).toBe(7.1);
  expect(parseCanoe(b.rows[1].recipes[0].note)?.rowIds).toEqual(["r0", "r1"]);
  const noHousing = buildCanoe({ ...cfg, housing: {} }, led14, prices, () => `x${n++}`);
  expect(noHousing.problems).toContain("เลือก SKU ตัวเรือน Canoe ขนาด L");
});
