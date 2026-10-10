import { test, expect } from "bun:test";
import {
  buildLinear,
  parseLinear,
  pickPsu,
  typeHeading,
  linearSkuGroups,
  parseLengths,
  wattPerMOf,
} from "./linear.ts";

const PRICES = new Map([
  ["led18", { unitPrice: 900, maxDiscount: 20 }],
  ["alu", { unitPrice: 150, maxDiscount: 10 }],
  ["jk1", { unitPrice: 100, maxDiscount: 10 }],
  ["jk2", { unitPrice: 180, maxDiscount: 10 }],
  ["prf", { unitPrice: 400, maxDiscount: 10 }],
  ["dif", { unitPrice: 120, maxDiscount: 10 }],
  ["paint", { unitPrice: 250, maxDiscount: 0 }],
  ["psu75", { unitPrice: 2500, maxDiscount: 10 }],
  ["psu150", { unitPrice: 3800, maxDiscount: 10 }],
]);

const base = {
  v: 1,
  blockId: "b1",
  typeCode: "LTJ2",
  ledSkuId: "led18",
  ledName: 'LED "JEDI 100%" V2.13 18W/M 24V TUNABLE WHITE (2000K-6500K)',
  wattPerM: 18,
  ip: "IP54",
  dim: "DALI",
  heatsinkSkuId: "alu",
  singleJacketSkuId: "jk1",
  doubleJacketSkuId: "jk2",
  profileSkuId: "prf",
  profileName: "ALUMINIUM V2.13 PROFILE & ACRYLIC DIFFUSER w/ MOUNTING",
  profileExtras: [{ skuId: "dif", perM: 1 }],
  color: "BLACK",
  paintSkuId: "paint",
  psuOptions: [
    { skuId: "psu75", watt: 75 },
    { skuId: "psu150", watt: 150 },
  ],
  loadFactor: 0.8,
  show: { heatsink: true, profile: true, paint: true, psu: true },
  circuits: [
    { ckt: "BRA-01", lengths: [3.2] },
    { ckt: "BRA-07", lengths: [0.7, 0.7] },
  ],
  rowIds: [],
};
let n = 0;
const ids = () => `r${++n}`;

test("PSU sized per circuit at 80% load", () => {
  const opts = base.psuOptions;
  expect(pickPsu(3.2 * 18, opts)).toMatchObject({ skuId: "psu75", count: 1 }); // 57.6 W ≤ 60
  expect(pickPsu(3.4 * 18, opts)).toMatchObject({ skuId: "psu150", count: 1 }); // 61.2 W > 60
  expect(pickPsu(20 * 18, opts)).toMatchObject({ skuId: "psu150", count: 3 }); // 360 W / 120
  expect(pickPsu(0, opts)).toBeNull();
});

test("rows follow THE PANO layout", () => {
  const { rows } = buildLinear(base, PRICES, ids);
  expect(rows.map((r) => r.customer_text)).toEqual([
    'LTJ2 : LED "JEDI 100%" V2.13 18W/M 24V TUNABLE WHITE (2000K-6500K) IP54 DALI-DIM',
    "CKT. NO. BRA-01",
    "- L = 3.20M",
    "- ALUMINIUM HEAT DISSIPATION & SINGLE JACKET",
    "- ALUMINIUM V2.13 PROFILE & ACRYLIC DIFFUSER w/ MOUNTING",
    "- INDUSTRIAL SPRAY PAINTING (BLACK)",
    "- POWER SUPPLY 24V 75W DALI-DIM",
    "CKT. NO. BRA-07",
    "- L = 0.70M + 0.70M",
    "- ALUMINIUM HEAT DISSIPATION & SINGLE JACKET",
    "- ALUMINIUM V2.13 PROFILE & ACRYLIC DIFFUSER w/ MOUNTING",
    "- INDUSTRIAL SPRAY PAINTING (BLACK)",
    "- POWER SUPPLY 24V 75W DALI-DIM",
  ]);
  const led = rows[2];
  expect([led.qty, led.unit, led.unit_price]).toEqual([3.2, "M.", 900]);
  expect(rows[3].unit_price).toBe(250); // 150 alu + 100 single jacket per m
  expect(rows[4].unit_price).toBe(520); // profile 400 + diffuser 120
  expect([rows[6].qty, rows[6].unit, rows[6].unit_price]).toEqual([1, "EA.", 2500]);
});

test("IP44 has no profile/painting; IP65 uses double jacket", () => {
  const ip44 = buildLinear({ ...base, ip: "IP44" }, PRICES, ids).rows.map((r) => r.customer_text);
  expect(ip44.some((t) => /PROFILE|PAINTING/.test(t))).toBe(false);
  expect(ip44[0]).toContain("IP44");
  const ip65 = buildLinear({ ...base, ip: "IP65" }, PRICES, ids).rows;
  expect(ip65[3].customer_text).toBe("- ALUMINIUM HEAT DISSIPATION & DOUBLE JACKET");
  expect(ip65[3].recipes.map((x) => x.sku_id)).toEqual(["alu", "jk2"]);
});

test("price hidden: item still listed by name, price folded into the LED row", () => {
  const all = buildLinear(base, PRICES, ids);
  const hidden = buildLinear(
    { ...base, show: { heatsink: false, profile: false, paint: false, psu: false } },
    PRICES,
    ids,
  );
  // same lines as before (names stay), PSU shows its count in the text
  expect(hidden.rows.map((r) => r.customer_text)).toEqual(
    all.rows.map((r) =>
      r.customer_text.startsWith("- POWER SUPPLY") ? r.customer_text + " x 1" : r.customer_text,
    ),
  );
  const ckt1 = hidden.rows.slice(2, 7);
  expect(ckt1.map((r) => r.kind)).toEqual(["priced", "display", "display", "display", "display"]);
  // name-only lines carry no qty/price
  expect(ckt1.slice(1).every((r) => r.qty === null && r.unit_price === null)).toBe(true);
  // ...but keep their own stock (display lines count in stock demand); painting is a service
  expect(ckt1.map((r) => r.recipes.map((x) => x.sku_id))).toEqual([
    ["led18"],
    ["alu", "jk1"],
    ["prf", "dif"],
    [],
    ["psu75"],
  ]);
  // 3.2 × (900+250+520+250) + 2500 = 8644 → per m 2701.25
  expect(ckt1[0].unit_price).toBe(2701.25);
  // same customer total either way (within rounding)
  expect(Math.abs(hidden.list - all.list)).toBeLessThan(0.05);
});

test("list total, weighted discount limit, missing prices", () => {
  const r = buildLinear({ ...base, circuits: [{ ckt: "A", lengths: [1] }] }, PRICES, ids);
  // 900 + 250 + 520 + 250 + 2500 = 4420
  expect(r.list).toBe(4420);
  // allowed: 180 + 25 + 52 + 0 + 250 = 507 → 11.47 → 11.4
  expect(r.maxDiscount).toBe(11.4);
  expect(buildLinear({ ...base, paintSkuId: "nopaint" }, PRICES, ids).missing).toEqual(["nopaint"]);
});

test("block can be reopened for editing", () => {
  const r = buildLinear(base, PRICES, ids);
  const note = r.rows.flatMap((x) => x.recipes).find((x) => x.note.includes("{")).note;
  const back = parseLinear(note);
  expect({ ...back, rowIds: [] }).toEqual(base);
  expect(back.rowIds).toEqual(r.rows.map((x) => x.id));
  expect(parseLinear("FO HARNESS")).toBeNull();
});

test("helpers", () => {
  expect(parseLengths("0.70+0.70")).toEqual([0.7, 0.7]);
  expect(parseLengths("1.5 1.5, 1.4")).toEqual([1.5, 1.5, 1.4]);
  expect(typeHeading({ typeCode: "", ledName: "LED STRIP 4.8W", ip: "IP44", dim: "NON-DIM" })).toBe(
    "LED STRIP 4.8W IP44 NON-DIM",
  );
  expect(
    wattPerMOf({ id: "x", code: "Strip4.8W60d2700K", name: "LED Strip 4.5W/m 24V 2700K" }),
  ).toBe(4.5);
  const g = linearSkuGroups([
    { id: "a", code: "PSU-75-DALI", name: "PSU 24V 75W DALI" },
    { id: "b", code: "PSU-SW-200", name: "PSU switching 24V 200W" },
    { id: "c", code: "cover4h", name: "jacket" },
    { id: "d", code: "JK-DOUBLE", name: "Double jacket" },
  ]);
  expect(g.psuFor("DALI")).toEqual([{ skuId: "a", watt: 75 }]);
  expect(g.psuFor("NON-DIM")).toEqual([{ skuId: "b", watt: 200 }]);
  expect(g.singleJackets.map((s) => s.id)).toEqual(["c"]);
  expect(g.doubleJackets.map((s) => s.id)).toEqual(["d"]);
});
