import { test, expect } from "bun:test";
import { buildClipso } from "./clipso.ts";
import { buildLinear } from "./linear.ts";
import { findBlocks, healRowIds, panelFromSize, rebuildBlock, splitDiffs } from "./finalRev.ts";

let n = 0;
const newId = () => `id${++n}`;
const PRICES = new Map([
  ["fab", { unitPrice: 1000, maxDiscount: 0 }],
  ["cw", { unitPrice: 100, maxDiscount: 0 }],
  ["led", { unitPrice: 200, maxDiscount: 0 }],
  ["psu", { unitPrice: 500, maxDiscount: 0 }],
]);

/** Saved rows of a built block, as the database holds them. */
const save = (rows) => ({
  lines: rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    item_no: r.item_no ?? null,
    customer_text: r.customer_text,
    option_name: null,
    zone: null,
    qty: r.qty,
    unit: r.unit,
    unit_price: r.unit_price,
    discount_percent: 0,
  })),
  recipes: rows.flatMap((r) => r.recipes.map((x) => ({ ...x, quote_line_id: r.id }))),
});

const clipsoCfg = {
  v: 1,
  blockId: "b1",
  code: "",
  fabricName: "308T",
  fabrics: [{ skuId: "fab", width: 3.4, rollLength: 50 }],
  forceFabricSkuId: null,
  track: "CW",
  trackSkuId: "cw",
  trackLength: 2,
  panels: [{ shape: "rect", w: 2, l: 1.5, qty: 1 }],
  combined: true,
  lengthStep: 0.05,
  light: null,
  rowIds: [],
};

const ctx = (recipes, measures, extra = {}) => ({
  recipesOf: (id) => recipes.filter((r) => r.quote_line_id === id),
  measureOf: (id) => measures.get(id),
  billedOf: (_id, m) => Number(m.measured_qty ?? 0),
  prices: PRICES,
  skuOf: () => undefined,
  newId,
  ...extra,
});

test("Clipso: a bigger opening recalculates fabric metres, profile and money", () => {
  const b = buildClipso(clipsoCfg, PRICES, newId);
  const { lines, recipes } = save(b.rows);
  const [block] = findBlocks(lines, recipes);
  expect(block.type).toBe("clipso");
  const measures = new Map([[lines[0].id, { measured_qty: null, cut_lengths: null, cut_spec: "OPEN 2.00M x 3.00M", note: null, measured_at: "x" }]]);
  const out = rebuildBlock(block.type, block.config, block.rows, ctx(recipes, measures));
  // 2 x 3 opening: cut 2.2 x 3.2 → 2.2 m of the 3.4 m roll; perimeter 10 m → 5 lengths
  expect(out.rows[0].recipes.map((r) => [r.sku_id, r.qty])).toEqual([["fab", 2.2], ["cw", 5]]);
  expect(out.rows[0].customer_text).toContain("- OPENING SIZE : 2.00M x 3.00M");
  expect(out.materials).toEqual([
    { skuId: "fab", oldQty: 1.7, newQty: 2.2 },
    { skuId: "cw", oldQty: 4, newQty: 5 },
  ]);
  // contract 3.4 x 1.7 x 1000 + 4 x 100 = 6,180 → 3.4 x 2.2 x 1000 + 5 x 100 = 7,980
  expect(out.amountDiff).toBe(1800);
  expect(out.carry[0].measuredQty).toBeNull();
});

test("Clipso: nothing measured = nothing to rebuild", () => {
  const { lines, recipes } = save(buildClipso(clipsoCfg, PRICES, newId).rows);
  const [block] = findBlocks(lines, recipes);
  expect(rebuildBlock(block.type, block.config, block.rows, ctx(recipes, new Map()))).toBeNull();
});

test("a special contract price keeps its level when the size changes", () => {
  const { lines, recipes } = save(buildClipso(clipsoCfg, PRICES, newId).rows);
  lines[0].unit_price = 3090; // half the calculated 6,180
  const [block] = findBlocks(lines, recipes);
  const measures = new Map([[lines[0].id, { measured_qty: null, cut_lengths: null, cut_spec: "OPEN 2.00M x 3.00M", note: null, measured_at: "x" }]]);
  const out = rebuildBlock(block.type, block.config, block.rows, ctx(recipes, measures));
  expect(out.rows[0].unit_price).toBe(3990); // half of 7,980
});

test("no price today: the contract price stays instead of dropping to 0", () => {
  const { lines, recipes } = save(buildClipso(clipsoCfg, PRICES, newId).rows);
  const [block] = findBlocks(lines, recipes);
  const measures = new Map([[lines[0].id, { measured_qty: null, cut_lengths: null, cut_spec: "OPEN 2.00M x 3.00M", note: null, measured_at: "x" }]]);
  const out = rebuildBlock(block.type, block.config, block.rows, ctx(recipes, measures, { prices: new Map() }));
  expect(out.rows[0].unit_price).toBe(6180);
});

const linearCfg = {
  v: 1,
  blockId: "l1",
  withProfile: false,
  typeCode: "",
  ledSkuId: "led",
  ledName: "LED",
  wattPerM: 14.4,
  ip: "IP54",
  dim: "NON-DIM",
  heatsinkSkuId: null,
  singleJacketSkuId: null,
  doubleJacketSkuId: null,
  profileSkuId: null,
  profileName: "",
  profileModel: null,
  mount: "CLIP",
  trim: false,
  diffuser: "JEDI",
  jediPct: null,
  chip: "",
  pcbMm: 10,
  ezClip: false,
  show: {},
  extras: [],
  psuOptions: [{ skuId: "psu", watt: 100 }],
  loadFactor: 0.8,
  circuits: [{ ckt: "", lengths: [2, 2] }],
  rowIds: [],
};

test("LED: measured lengths drive the metres, the power supply and the printed length; the billed length wins", () => {
  const b = buildLinear(linearCfg, PRICES, newId);
  const { lines, recipes } = save(b.rows);
  const [block] = findBlocks(lines, recipes);
  expect(block.type).toBe("linear");
  const led = lines.find((l) => l.customer_text?.startsWith("- L ="));
  const measures = new Map([[led.id, { measured_qty: 18, cut_lengths: [9, 9], cut_spec: "9x2", note: null, measured_at: "x" }]]);
  const out = rebuildBlock(block.type, block.config, block.rows, ctx(recipes, measures, { billedOf: () => 17.5 }));
  const row = out.rows.find((r) => r.customer_text.startsWith("- L ="));
  expect(row.customer_text).toBe("- L = (9.00M x 2SETS)");
  expect(row.qty).toBe(17.5);
  expect(row.recipes[0].qty).toBe(17.5);
  // 17.5 m x 14.4 W = 252 W at 80 % needs 4 x 100 W instead of 1
  const psu = out.materials.find((m) => m.skuId === "psu");
  expect(psu.newQty).toBeGreaterThan(psu.oldQty);
  expect(out.carry.find((c) => c.rowId === row.id).measure.cut_spec).toBe("9x2");
  expect(out.amountDiff).toBeGreaterThan(0);
});

test("rows of a block are found again in a new Rev, where the saved ids are the old Rev's", () => {
  // service track of the block above (no materials), then a block: heading, fabric, light, service track, a note
  const kinds = { svc0: "priced", h: "heading", a: "priced", b: "priced", svc: "priced", note: "internal", next: "heading" };
  const lineIds = Object.keys(kinds);
  const kindOf = (id) => kinds[id];
  const withMaterials = new Set(["a", "b"]);
  expect(healRowIds(["a", "b"], lineIds, [], withMaterials, kindOf)).toEqual(["a", "b"]); // ids still valid
  expect(healRowIds(["o1", "o2", "o3", "o4"], lineIds, ["a", "b"], withMaterials, kindOf)).toEqual(["h", "a", "b", "svc"]);
  expect(healRowIds(["o1"], lineIds, [], withMaterials, kindOf)).toEqual([]);
});

test("reading a measured opening; additions and reductions add up", () => {
  const base = { shape: "rect", w: 1, l: 1, qty: 2, allowW: 5 };
  expect(panelFromSize("1.88M x 1.85M x 3PCS.", base)).toEqual({ shape: "rect", w: 1.88, l: 1.85, qty: 3, allowW: 5 });
  expect(panelFromSize("1.88M x 1.85M", base).qty).toBe(2);
  expect(panelFromSize("DIA : 2.16M", base).shape).toBe("circle");
  expect(panelFromSize("what", base)).toBeNull();
  expect(splitDiffs([100, -30.5, -20, 0])).toEqual({ add: 100, cut: -50.5, net: 49.5 });
});
