import { test, expect } from "bun:test";
import { cutSize, layout, bestLayout, trackPieces, ledMeters, buildClipso, parseClipso, spacingFor } from "./clipso.ts";

const R = (w, l, qty = 1, extra = {}) => ({ shape: "rect", w, l, qty, ...extra });

test("cut 10 cm bigger on every side unless set shorter", () => {
  expect(cutSize(R(4.52, 5.63))).toEqual([4.72, 5.83]);
  expect(cutSize({ shape: "circle", w: 2.16, l: 0, qty: 1 })).toEqual([2.36, 2.36]);
  expect(cutSize(R(1.42, 7.76, 1, { allowW: 9 }))).toEqual([1.6, 7.96]);
});

test("pieces share the roll width; customer pays roll width × length", () => {
  // VN-01: 16 openings 1.42 wide → two side by side on 3.4
  const panels = [R(1.42, 9.42, 4), R(1.42, 7.9, 4), R(1.42, 7.76, 8)];
  const lay = layout(panels, 3.4, 50, 0.01);
  expect(lay.strips.length).toBe(8);
  expect(lay.usedWidth).toBe(3.24);
  expect(lay.length).toBe(67.28);
  expect(lay.area).toBe(228.75);
  expect(lay.rolls).toBe(2);
  // 4.72 x 5.83 doesn't fit 3.4 at all
  expect(layout([R(4.52, 5.63)], 3.4).problems.length).toBe(1);
  expect(layout([R(4.52, 5.63)], 5.1, 50, 0.1)).toMatchObject({ length: 5.9, usedWidth: 4.72 });
});

test("cheapest width wins", () => {
  const fabrics = [
    { skuId: "f34", width: 3.4, rollLength: 50 },
    { skuId: "f51", width: 5.1, rollLength: 50 },
  ];
  const prices = new Map([["f34", { unitPrice: 1000, maxDiscount: 10 }], ["f51", { unitPrice: 1000, maxDiscount: 10 }]]);
  // 3 x (1.5 x 2) cut 1.7 x 2.2: on 3.4 → 2 strips (2 + 1) = 4.4 m x 3.4 = 14.96 m²;
  // on 5.1 → 3 across in one strip = 2.2 m x 5.1 = 11.22 m²
  expect(bestLayout([R(1.5, 2, 3)], fabrics, prices, 0.1).pick.fabric.skuId).toBe("f51");
  expect(bestLayout([R(1.5, 2, 2)], fabrics, prices, 0.1).pick.fabric.skuId).toBe("f34");
  expect(bestLayout([R(1.5, 2, 3)], fabrics, prices, 0.1, "f34").pick.fabric.skuId).toBe("f34");
});

test("track by perimeter in 2 m lengths, offcut paid", () => {
  expect(trackPieces(R(4.86, 25))).toBe(30); // 59.72 m
  expect(trackPieces({ shape: "circle", w: 2.16, l: 0, qty: 1 })).toBe(4); // 6.79 m
});

test("LED spacing from cavity depth", () => {
  expect(spacingFor(20)).toBe(30);
  expect(ledMeters(R(1.6, 3.7), 30)).toEqual({ rows: 6, meters: 22.2 });
});

const base = {
  v: 1, blockId: "c1", code: "VN-01", fabricName: "308T",
  fabrics: [{ skuId: "f34", width: 3.4, rollLength: 50 }, { skuId: "f51", width: 5.1, rollLength: 50 }],
  forceFabricSkuId: null, track: "CW", trackSkuId: "cw", trackLength: 2,
  panels: [R(1.42, 9.42, 4), R(1.42, 7.9, 4), R(1.42, 7.76, 8)],
  combined: true, lengthStep: 0.1, light: null, rowIds: [],
};
const PRICES = new Map([
  ["f34", { unitPrice: 1500, maxDiscount: 10 }],
  ["f51", { unitPrice: 1700, maxDiscount: 10 }],
  ["cw", { unitPrice: 400, maxDiscount: 0 }],
  ["led", { unitPrice: 300, maxDiscount: 20 }],
  ["psu", { unitPrice: 1000, maxDiscount: 10 }],
]);
let n = 0;
const ids = () => `r${++n}`;

test("combined block = one SET line like VN-01", () => {
  const b = buildClipso(base, PRICES, ids);
  expect(b.rows.length).toBe(1);
  expect(b.rows[0].customer_text.split("\n")).toEqual([
    'VN-01 : CLIPSO FABRIC "308T"',
    "- OPENING SIZE : 1.42M x 9.42M x 4PCS.",
    "- OPENING SIZE : 1.42M x 7.90M x 4PCS.",
    "- OPENING SIZE : 1.42M x 7.76M x 8PCS.",
    "- CALCULATION SIZE : 3.24M x 67.60M",
    '- CEILING PROFILE "CW"',
  ]);
  // 3.4 x 67.6 = 229.84 m² x 1500 + track (4x11 + 4x10 + 8x10 = 164) x 400
  expect(b.rows[0].unit_price).toBe(229.84 * 1500 + 164 * 400);
  expect(b.rows[0].recipes.map((r) => [r.sku_id, r.qty])).toEqual([["f34", 229.84], ["cw", 164]]);
  expect(parseClipso(b.rows[0].recipes[0].note).panels.length).toBe(3);
});

test("separate sizes: one line per opening, price per set", () => {
  const b = buildClipso(
    { ...base, code: "", combined: false, panels: [{ shape: "circle", w: 2.16, l: 0, qty: 2 }] },
    PRICES,
    ids,
  );
  expect(b.rows.map((r) => r.customer_text.split("\n")[0])).toEqual(['CLIPSO FABRIC "308T"', "SIZE : DIA : 2.16M"]);
  const line = b.rows[1];
  expect(line.qty).toBe(2);
  expect(line.customer_text).toContain("- CALCULATION SIZE 2.36M x 2.40M");
  // per set: 3.4 x 2.4 = 8.16 m² x 1500 + 4 track x 400
  expect(line.unit_price).toBe(8.16 * 1500 + 1600);
  expect(line.recipes.map((r) => r.qty)).toEqual([16.32, 8]);
});

test("luminous ceiling adds the LED set", () => {
  const b = buildClipso(
    {
      ...base,
      code: "",
      fabricName: "",
      panels: [R(1.6, 3.7)],
      light: { depthCm: 20, spacingCm: 30, ledSkuId: "led", wattPerM: 4.8, cct: "2700K/3000K/4000K/6500K : TBD", dim: "NON-DIM", psuOptions: [{ skuId: "psu", watt: 150 }], loadFactor: 0.8, miscSkuId: null },
    },
    PRICES,
    ids,
  );
  expect(b.rows.map((r) => r.customer_text.split("\n")[0])).toEqual([
    "CLIPSO FABRIC w/ LUMINOUS CEILING",
    "CLIPSO FABRIC",
    "LED ABOVE THE FABRIC (ceiling to clipso 20cm.)",
  ]);
  const led = b.rows[2];
  expect(led.customer_text).toContain("- POWER SUPPLY NON-DIM x 1"); // 22.2 m x 4.8 W = 106.6 W ≤ 120
  expect(led.unit_price).toBe(22.2 * 300 + 1000);
});

import { ledModules, wattPerModuleOf } from "./clipso.ts";

test("LED modules: grid in both directions", () => {
  expect(ledModules(R(1.6, 3.7), 30)).toEqual({ cols: 6, rows: 13, count: 78 });
  // circle Ø 2.16 at 30 cm → 8 x 8 cells, those inside the circle
  const c = ledModules({ shape: "circle", w: 2.16, l: 0, qty: 1 }, 30);
  expect(c.cols).toBe(8);
  expect(c.count).toBeLessThan(64);
  expect(c.count).toBeGreaterThan(40);
  expect(wattPerModuleOf({ id: "m", code: "M", name: "LED module 1.2W 24V" })).toBe(1.2);
  expect(wattPerModuleOf({ id: "m", code: "M", name: "x", notes: "[W/ชิ้น: 0.72]" })).toBe(0.72);
});

test("luminous ceiling with modules", () => {
  const b = buildClipso(
    {
      ...base,
      code: "",
      fabricName: "",
      panels: [R(1.6, 3.7)],
      light: { kind: "module", depthCm: 20, spacingCm: 30, ledSkuId: "led", wattPerM: 1.2, cct: "TBD", dim: "NON-DIM", psuOptions: [{ skuId: "psu", watt: 150 }], loadFactor: 0.8, miscSkuId: null },
    },
    PRICES,
    ids,
  );
  const led = b.rows[2];
  expect(led.customer_text).toContain("- LED MODULE (TBD)");
  // 78 modules x 1.2 W = 93.6 W → one 150 W
  expect(led.recipes.map((r) => [r.sku_id, r.qty])).toEqual([["led", 78], ["psu", 1]]);
  expect(led.unit_price).toBe(78 * 300 + 1000);
});
