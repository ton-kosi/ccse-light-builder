import { test, expect } from "bun:test";
import { cutPieces, packRolls, familyPrice, configItems, buildNeon, parseNeon, neonFamilies, defaultNeonName } from "./neon.ts";

test("pieces rounded up to the cut step, long runs split into roll lengths", () => {
  expect(cutPieces([1.52, 0.7], 5, 10)).toEqual([1.55, 0.7]);
  expect(cutPieces([1.0], 3.33, 10)).toEqual([1.03]);
  expect(cutPieces([23], 5, 10)).toEqual([10, 10, 3]);
});

const R5 = { skuId: "r5", length: 5, price: 3000 };
const R10 = { skuId: "r10", length: 10, price: 5500 };

test("rolls: no joining offcuts, cheapest mix of 5 m / 10 m", () => {
  // 4 + 3 + 2.5 + 2 = 11.5 m → 10 m roll (4+3+2.5... first fit) + 5 m roll
  const rolls = packRolls([4, 3, 2.5, 2], [R5, R10]);
  expect(rolls.map((r) => r.length).sort()).toEqual([10, 5].sort());
  expect(rolls.every((r) => r.used <= r.length)).toBe(true);
  // one 4.5 m piece → a 5 m roll
  expect(packRolls([4.5], [R5, R10]).map((r) => r.length)).toEqual([5]);
  // 3 + 3 = 6 m: one 10 m (5,500) vs two 5 m (6,000) → 10 m
  expect(packRolls([3, 3], [R5, R10]).map((r) => r.length)).toEqual([10]);
  // when two 5 m are cheaper, split
  expect(packRolls([3, 3], [{ ...R5, price: 2000 }, R10]).map((r) => r.length)).toEqual([5, 5]);
  // a 6 m piece can never come from 5 m rolls
  expect(packRolls([6], [{ ...R5, price: 1 }, R10]).map((r) => r.length)).toEqual([10]);
});

const fam = { family: "JF0410-3000K", rolls: [R5, R10], stepCm: 5, maxPieceM: 10, wattPerM: 10, model: null, componentId: "rf", sample: "" };
const prices = new Map([
  ["r5", { unitPrice: 3000, maxDiscount: 10 }],
  ["r10", { unitPrice: 5500, maxDiscount: 10 }],
  ["cap", { unitPrice: 100, maxDiscount: 0 }],
  ["psu", { unitPrice: 1200, maxDiscount: 10 }],
]);
const block = (id, lengths, extra = {}) => ({
  v: 1, blockId: id, typeCode: "NF1", family: "JF0410-3000K", name: "JEDI FLEX 0410 SIDE BEND 10W/M 24V IP67",
  wattPerM: 10, dim: "NON-DIM", psuOptions: [{ skuId: "psu", watt: 100 }], loadFactor: 0.8,
  endCapSkuId: "cap", mountSkuId: null, mountPerM: 0, runs: [{ ckt: "", lengths }], rowIds: [], ...extra,
});

test("same model in one quotation → same price per metre", () => {
  const a = block("a", [4, 3]);
  const b = block("b", [2.5, 2]);
  const fp = familyPrice(fam, [...configItems(a, fam), ...configItems(b, fam)], prices);
  // pieces 4,3,2.5,2 → 10 m + 5 m = 8,500; end caps 4 x 100 = 400; 11.5 m
  expect(fp.cost).toBe(8900);
  expect(fp.meters).toBe(11.5);
  expect(fp.perM).toBe(773.91);
  // block a alone would be dearer per metre: 10 m roll + 2 caps over 7 m
  expect(familyPrice(fam, configItems(a, fam), prices).perM).toBe(814.29);
});

test("rows: run lines carry cut lengths and the roll component; PSU per run", () => {
  let n = 0;
  const { rows, config } = buildNeon(block("a", [4, 3]), fam, 773.91, prices, () => `r${++n}`);
  expect(rows.map((r) => r.customer_text)).toEqual([
    "NF1 : JEDI FLEX 0410 SIDE BEND 10W/M 24V IP67 NON-DIM",
    "- L = 7.00M",
    "- POWER SUPPLY 24V 100W NON-DIM",
  ]);
  const run = rows[1];
  expect([run.qty, run.unit, run.unit_price, run.component_id]).toEqual([7, "M.", 773.91, "rf"]);
  expect(run.cut_lengths).toEqual([4, 3]);
  expect(rows[2]).toMatchObject({ qty: 1, unit_price: 1200 }); // 70 W ≤ 80
  const back = parseNeon(run.recipes[0].note);
  expect(back.rowIds).toEqual(config.rowIds);
});

test("families from roll SKUs", () => {
  const skus = [
    { id: "r5", code: "JF0410-30-5", name: "Jedi flex 0410 3000K 5m", notes: "[หมวด: Neon flex] [รุ่น: 0410]", is_roll: true, roll_family: "JF0410-3000K", roll_length_m: 5, cut_step_cm: 5 },
    { id: "r10", code: "JF0410-30-10", name: "Jedi flex 0410 3000K 10m", notes: "[หมวด: Neon flex] [รุ่น: 0410]", is_roll: true, roll_family: "JF0410-3000K", roll_length_m: 10, cut_step_cm: 5 },
  ];
  const [f] = neonFamilies(skus, [{ id: "rf", roll_family: "JF0410-3000K", is_roll_product: true }]);
  expect(f.rolls.map((r) => r.length)).toEqual([5, 10]);
  expect([f.stepCm, f.maxPieceM, f.wattPerM, f.componentId]).toEqual([5, 10, 10, "rf"]);
  expect(defaultNeonName(f)).toBe("JEDI FLEX 0410 SIDE BEND 10W/M 24V IP67");
});
