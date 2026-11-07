import { test, expect } from "bun:test";
import { buildCanoe, canoeLengths, dotsOfLed, fitRun, parseCanoe, planCanoe, wpBoxFor } from "./canoe.ts";

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

test("production: LED cut per piece (outer = single piece, inner = 5 mm shorter for Double)", async () => {
  const { pieceCuts, runsFromSpec } = await import("./canoe.ts");
  expect(pieceCuts(led14, false)[0]).toEqual({ size: "L", housingM: 0.5, outerCm: 50, innerCm: null });
  const d = pieceCuts({ code: "LED-Top-9.6-120-3000", name: "9.6W/m, 120dots" }, true);
  expect(d[0]).toEqual({ size: "L", housingM: 0.51, outerCm: 50.5, innerCm: 50 });
  expect(pieceCuts(led72, false).map((c) => c.size)).toEqual(["L", "S", "SS"]);
  // L-shape / pool steps: each side of [1.2+1.3] is its own straight Canoe
  expect(runsFromSpec([{ pieces: [1.2, 1.3], sets: 2 }, { pieces: [4.18], sets: 1 }])).toEqual([
    { length: 1.2, sets: 2, label: "1.1" },
    { length: 1.3, sets: 2, label: "1.2" },
    { length: 4.18, sets: 1 },
  ]);
});

test("a joined run is not fitted as one long piece row", async () => {
  const { runsFromSpec, planCanoe } = await import("./canoe.ts");
  // 1.0 + 1.0 as one 2.0 m run would be 4 L; as two sides it is 2 L each = still 4, but 0.7 + 0.7
  // needs its own short pieces on each side (1 L + 1 SS each), not 3 L across the corner
  const plan = planCanoe({ double: false, runs: runsFromSpec([{ pieces: [0.7, 0.7], sets: 1 }]) }, led14);
  expect(plan.runs.map((r) => r.fit.counts)).toEqual([
    { L: 1, M: 0, S: 0, SS: 1 },
    { L: 1, M: 0, S: 0, SS: 1 },
  ]);
  expect(plan.runM).toBe(1.4);
});

test("4/8 rail inside every Canoe: metres = LED metres, in the price per metre", () => {
  const prices = new Map([
    ["led", { unitPrice: 1000, maxDiscount: 0 }],
    ["rail", { unitPrice: 100, maxDiscount: 0 }],
    ["pl", { unitPrice: 500, maxDiscount: 0 }],
    ["ssh", { unitPrice: 2000, maxDiscount: 0 }],
    ["cov", { unitPrice: 300, maxDiscount: 0 }],
  ]);
  const c = { v: 1, blockId: "a", code: "", title: "", ledSkuId: "led", railSkuId: "rail", double: false, housing: { L: "pl" }, runs: [{ length: 2.49, sets: 1 }], rowIds: [] };
  let n = 0;
  const id = () => `x${++n}`;
  const acrylic = buildCanoe(c, led14, prices, id);
  const rail = (b) => b.rows[1].recipes.find((r) => r.sku_id === "rail");
  expect(rail(acrylic).qty).toBe(2.5); // 5 L
  expect(acrylic.list).toBeCloseTo(2500 + 250 + 2500, 0);
  // double: one rail per strip
  expect(rail(buildCanoe({ ...c, double: true, housing: { L: "pl", M: "pl", S: "pl", SS: "pl" } }, led14, prices, id)).qty).toBe(acrylic.plan.ledM * 2);
  // stainless housing: the rail is still inside
  const ss = buildCanoe({ ...c, housingType: "ss", ss: { model: "3150", customW: 0, customH: 0, grade: "SS304", diffuser: "Opal", housingSkuId: "ssh", coverSkuId: "cov", surcharge: 0 } }, led14, prices, id);
  expect(rail(ss).qty).toBe(2.5);
  expect(ss.problems).toEqual([]);
  // older sets without a rail keep their parts until reopened
  expect(buildCanoe({ ...c, railSkuId: null }, led14, prices, id).rows[1].recipes.some((r) => r.sku_id === "rail")).toBe(false);
});

test("FAIRMONT stainless: jacket, acrylic per piece, power supply and WP box; customer keeps one line", () => {
  const prices = new Map(["led", "rail", "jk", "kit", "ssh", "cov", "sw", "wp"].map((k) => [k, { unitPrice: 100, maxDiscount: 0 }]));
  const c = {
    v: 1, blockId: "s", code: "UW500", title: "LED CANOE", ledSkuId: "led", railSkuId: "rail", jacketSkuId: "jk", kitSkuId: "kit", double: false, housing: {},
    housingType: "ss", ss: { model: "3150", customW: 0, customH: 0, grade: "SS316L", diffuser: "Jedi", housingSkuId: "ssh", coverSkuId: "cov", surcharge: 0 },
    psuOptions: [{ skuId: "sw", watt: 451.2 }], wpSkuId: "wp", runs: [{ length: 65.8, sets: 1 }], rowIds: [],
  };
  const b = buildCanoe(c, led14, prices, () => crypto.randomUUID(), () => "m");
  expect(b.rows.length).toBe(2);
  expect(b.rows[1].customer_text).toContain("- INCLUDING POWER SUPPLY w/ WP BOX");
  const q = Object.fromEntries(b.rows[1].recipes.map((r) => [r.sku_id, r.qty]));
  expect([q.led, q.rail, q.jk, q.kit, q.sw, q.wp]).toEqual([65.5, 65.5, 65.5, 131, 3, 3]);
  // no power supply chosen: the line stays as before
  expect(buildCanoe({ ...c, psuOptions: [] }, led14, prices, () => "z", () => "m").rows[1].customer_text).not.toContain("POWER SUPPLY");
  expect(wpBoxFor({ code: "ACC-PS-MW-CV-N-24-14.6" }, [{ code: "ACC-WPbox-PS-18.8", name: "" }, { code: "ACC-WPbox-PS-8.8,14.6", name: "" }])?.code).toBe("ACC-WPbox-PS-8.8,14.6");
  expect(wpBoxFor({ code: "ACC-PS-MW-CV-N-24-150-IP" }, [{ code: "ACC-WPbox-PS-18.8", name: "" }])).toBeNull();
});

test("retrofit in an existing housing, like SALA BANG PAIN: 2 mm joints, 59 pieces, 59 sets", () => {
  const prices = new Map([
    ["led", { unitPrice: 1000, maxDiscount: 10 }],
    ["alu", { unitPrice: 100, maxDiscount: 0 }],
    ["jk", { unitPrice: 50, maxDiscount: 0 }],
    ["kit", { unitPrice: 800, maxDiscount: 0 }],
  ]);
  const c = {
    v: 1, blockId: "r1", itemNo: "1", code: "LE3", title: "LED JEDI CANOE IP68", ledSkuId: "led", double: false, housing: {},
    housingType: "retrofit", runs: [{ length: 29.5, sets: 1 }], rowIds: [],
    retro: { runName: "SWX-1 (STRAIGHT)", jacket: "DOUBLE", diffuser: "Jedi", heatsinkSkuId: "alu", jacketSkuId: "jk", kitSkuId: "kit", housingText: "EXISTING SS 316L HOUSING (t = 1 mm)", existingPsu: true },
  };
  let n = 0;
  const b = buildCanoe(c, led14, prices, () => `x${++n}`);
  // with 2 mm per joint 59 L is 11.8 cm too long, so automatic takes 58 L + 1 M = 29.518 m
  expect(b.plan.totals).toEqual({ L: 58, M: 1, S: 0, SS: 0 });
  expect(b.plan.runs[0].fit.totalM).toBe(29.518);
  expect(b.rows.map((r) => [r.kind, r.customer_text, r.qty, r.unit])).toEqual([
    ["heading", "LE3 : LED JEDI CANOE IP68", null, null],
    ["priced", "- SWX-1 (STRAIGHT) : L = 29.50M", 29.5, "M."],
    ["priced", "- ALUMINIUM HEAT DISSIPATION & DOUBLE JACKET", 29.5, "M."],
    ["priced", "- WATERPROOF ENGRAVED ACRYLIC & JEDI ACRYLIC DIFFUSER w/ IP68 CABLE", 59, "SET"],
    ["existing", "- EXISTING SS 316L HOUSING (t = 1 mm)", null, null],
    ["existing", "- EXISTING POWER SUPPLY 24V", null, null],
    ["display", "NOTE : STANDARD LENGTH = 500 MM/PC., OPTION LENGTH 300 MM, 400 MM.", null, null],
  ]);
  expect(b.rows[0].item_no).toBe("1");
  expect(b.rows[1].unit_price).toBe(Math.round(((29.4 * 1000) / 29.5) * 100) / 100); // LED 29.4 m over 29.5 m of run
  expect(b.rows[2].unit_price).toBe(Math.round(((29.4 * 150) / 29.5) * 100) / 100); // rail + jacket follow the LED metres
  expect(b.rows[3].unit_price).toBe(800);
  expect(b.problems).toEqual([]);
  expect(parseCanoe(b.rows[1].recipes[0].note).housingType).toBe("retrofit");
  expect(b.rows.flatMap((r) => r.recipes).map((r) => [r.sku_id, r.qty])).toEqual([["led", 29.4], ["alu", 29.4], ["jk", 29.4], ["kit", 59]]);
  // no 20 cm piece: 0.70 m = 40 + 30, never 50 + 20
  expect(planCanoe({ double: false, housingType: "retrofit", runs: [{ length: 0.7, sets: 1 }] }, led14).totals).toEqual({ L: 0, M: 1, S: 1, SS: 0 });
  // a person decides: 59 × 50 cm, over the limit but allowed, LED follows
  const hand = buildCanoe({ ...c, manualFits: { "29.5": { L: 59, M: 0, S: 0, SS: 0 } } }, led14, prices, () => `h${++n}`);
  expect(hand.plan.runs[0].fit).toMatchObject({ manual: true, ok: true, pieces: 59, totalM: 29.618 });
  expect(hand.plan.ledM).toBe(29.5);
  expect(hand.problems).toEqual([]);
  // a different measured length goes back to automatic
  expect(planCanoe({ double: false, housingType: "retrofit", manualFits: { "29.5": { L: 59, M: 0, S: 0, SS: 0 } }, runs: [{ length: 10, sets: 1 }] }, led14).runs[0].fit.manual).toBeUndefined();
  // no kit SKU chosen: refused
  expect(buildCanoe({ ...c, retro: { ...c.retro, kitSkuId: "" } }, led14, prices, () => "y").problems.join()).toContain("อะคริลิก");
});

test("stainless Canoe: 2.4 m bars + acrylic covers per run, custom section surcharge", async () => {
  const { buildCanoe, barsFor, ssSectionText, defaultSs } = await import("./canoe.ts");
  expect(barsFor(2.4)).toBe(1);
  expect(barsFor(2.41)).toBe(2);
  expect(barsFor(7.92)).toBe(4);
  const prices = new Map([
    ["led", { unitPrice: 1000, maxDiscount: 0 }],
    ["ss", { unitPrice: 2000, maxDiscount: 0 }],
    ["cov", { unitPrice: 500, maxDiscount: 0 }],
  ]);
  const ss = { ...defaultSs(), housingSkuId: "ss", coverSkuId: "cov" };
  const cfg = { v: 1, blockId: "s1", code: "", title: "POOL", ledSkuId: "led", double: false, housing: {}, housingType: "ss", ss, runs: [{ length: 2.49, sets: 1 }, { length: 7.92, sets: 1 }], rowIds: [] };
  let n = 0;
  // housing SKU in metres (bars × 2.4), cover in pieces
  const b = buildCanoe(cfg, led14, prices, () => `r${n++}`, (id) => (id === "ss" ? "m" : "ea"));
  expect(b.plan.ssBars).toBe(6); // 2 + 4
  expect(b.rows[1].recipes.map((r) => [r.sku_id, r.qty])).toEqual([["led", 10.4], ["ss", 14.4], ["cov", 6]]);
  expect(b.rows[1].customer_text).toContain("SS304 WSS.3150 (31 x 50 MM.), OPAL DIFFUSER");
  expect(b.problems).toEqual([]);
  // custom section: needs a size, adds the surcharge to the set
  const custom = buildCanoe({ ...cfg, ss: { ...ss, model: "custom", customW: 40, customH: 60, surcharge: 5000 } }, led14, prices, () => `c${n++}`, (id) => (id === "ss" ? "m" : "ea"));
  expect(custom.list).toBeCloseTo(b.list + 5000, 0);
  expect(ssSectionText({ ...ss, model: "custom", customW: 40, customH: 60 })).toBe("CUSTOM SECTION 40 x 60 MM.");
  expect(buildCanoe({ ...cfg, ss: { ...ss, model: "custom" } }, led14, prices, () => `d${n++}`).problems).toContain("ใส่ขนาดหน้าตัดพิเศษ (กว้าง × สูง มม.)");
  expect(buildCanoe({ ...cfg, ss: { ...ss, coverSkuId: "" } }, led14, prices, () => `e${n++}`).problems).toContain("เลือก SKU ฝาครอบอะคริลิก");
});
