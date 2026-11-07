import { test, expect } from "bun:test";
import {
  buildLinear,
  parseLinear,
  pickPsu,
  typeHeading,
  linearSkuGroups,
  parseLengths,
  wattPerMOf,
  psuDimOf,
  wattOfPsu,
  psuReport,
  psu24Report,
  psuKindReport,
  psuVoltOf,
  nominalWatt,
  roundUpStep,
  circuitQty,
  nearFitPsu,
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

test("profile is its own choice: IP44 with profile, IP54 / IP65 bare strip with EZ clip", () => {
  const ip44 = buildLinear({ ...base, ip: "IP44", withProfile: true }, PRICES, ids).rows.map((r) => r.customer_text);
  expect(ip44).toContain("- ALUMINIUM V2.13 PROFILE & ACRYLIC DIFFUSER w/ MOUNTING");
  expect(ip44).toContain("- ALUMINIUM HEAT DISSIPATION & SINGLE JACKET");
  const bare = buildLinear({ ...base, ip: "IP65", withProfile: false }, PRICES, ids).rows.map((r) => r.customer_text);
  expect(bare.some((t) => /PROFILE|PAINTING/.test(t))).toBe(false);
  expect(bare).toContain("- ALUMINIUM HEAT DISSIPATION & DOUBLE JACKET w/ EZ-CLIP");
  const noClip = buildLinear({ ...base, withProfile: false, noEzClip: true }, PRICES, ids).rows.map((r) => r.customer_text);
  expect(noClip).toContain("- ALUMINIUM HEAT DISSIPATION & SINGLE JACKET");
});

test("1-10V: non-dim 24V power supply + mini dimmer per circuit", () => {
  const prices = new Map([...PRICES, ["mini", { unitPrice: 900, maxDiscount: 0 }]]);
  const { rows } = buildLinear(
    { ...base, dim: "1-10V", dimmerSkuId: "mini", circuits: [{ ckt: "WA-N1", lengths: [0.5] }] },
    prices,
    ids,
  );
  const t = rows.map((r) => r.customer_text);
  expect(t[0]).toContain("IP54 1-10V DIM");
  expect(t).toContain("- SWITCHING POWER SUPPLY 24V 75W");
  const mini = rows.find((r) => r.customer_text === "- MINI DIMMER FOR 1-10V");
  expect([mini.qty, mini.unit, mini.unit_price]).toEqual([1, "SET", 900]);
  expect(mini.recipes.map((x) => x.sku_id)).toEqual(["mini"]);
});

test("power supply: only 24V offered, sold-as watts, picked by hand or shared", () => {
  const p = (code, name, watt) => ({ id: code, code, name, notes: watt ? `[วัตต์: ${watt}]` : null });
  const psus = [
    p("ACC-PS-MW-CV-N-12-75", "SWP 12V 75W"),
    p("ACC-PS-MW-CV-N-15-100", "SWP 15V 100W"),
    p("ACC-PS-MW-CC-F-700-100-IP", "ELG-100-700A, (350mA-700mA), IP65"),
    p("ACC-PS-MW-CV-N-24-3.2", "SWP 24V 3.2A", 76.8),
    p("ACC-PS-MW-CV-N-24-150-IP", "ELG-150-24, Non-Dim, IP67"),
  ];
  const r = psu24Report(psus, "NON-DIM");
  expect(r.options.map((o) => o.skuId)).toEqual(["ACC-PS-MW-CV-N-24-3.2", "ACC-PS-MW-CV-N-24-150-IP"]);
  expect(r.skipped.map((x) => x.reason)).toEqual([
    "เป็น 12V ไม่ใช่ 24V",
    "เป็น 15V ไม่ใช่ 24V",
    "เป็น constant current ไม่ใช่ 24V",
  ]);
  expect(psuVoltOf(p("PSUDIM0-10V", "Power supply 24V 60W"))).toBe(24);
  expect(psuVoltOf(p("X", "Driver 0-10V 60W"))).toBeNull();
  expect([26.4, 52.8, 76.8, 108, 156, 211.2, 75, 200, 36].map(nominalWatt)).toEqual([25, 50, 75, 100, 150, 200, 75, 200, 36]);

  const t = buildLinear(
    {
      ...base,
      circuits: [
        { ckt: "A", lengths: [1], psuSkuId: "psu150" },
        { ckt: "B", lengths: [1], sharedWith: "ITEM 8.1" },
      ],
    },
    PRICES,
    ids,
  ).rows.map((r) => r.customer_text);
  expect(t).toContain("- POWER SUPPLY 24V 150W DALI-DIM");
  expect(t).toContain("- POWER SUPPLY 24V DALI-DIM (SHARED w/ ITEM 8.1)");
  expect(t.filter((x) => x.includes("POWER SUPPLY"))).toHaveLength(2);
});

test("quantity: each piece rounded up to the cut step, typed length stays in the text", () => {
  expect(roundUpStep("60", 10)).toBe(10);
  expect(roundUpStep("120", 5)).toBe(5);
  expect(roundUpStep("COB", 5)).toBe(5);
  expect(roundUpStep("180", 3.33)).toBeNull();
  expect(roundUpStep("60", null)).toBeNull();
  const six = { ckt: "BRC-06", lengths: [1.35, 1.35, 1.35, 1.35, 1.35, 1.35] };
  expect(circuitQty(six, { cutStepCm: 10 })).toBe(8.4); // not 8.1 rounded as a whole
  expect(circuitQty({ ckt: "", lengths: [2.75, 2.82] }, { cutStepCm: 10 })).toBe(5.7);
  expect(circuitQty({ ckt: "", lengths: [0.3] }, { cutStepCm: 10 })).toBe(0.3); // already on the step
  expect(circuitQty({ ckt: "", lengths: [0.76] }, { cutStepCm: 5 })).toBe(0.8);
  expect(circuitQty({ ckt: "", lengths: [0.34] }, { cutStepCm: 16.67 })).toBe(0.5); // 16.67 = 50/3 exactly
  expect(circuitQty({ ckt: "", lengths: [1.23] }, {})).toBe(1.23);
  const { rows } = buildLinear({ ...base, cutStepCm: 10, circuits: [six] }, PRICES, ids);
  const led = rows.find((r) => r.customer_text.startsWith("- L ="));
  expect(led.customer_text).toContain("1.35M");
  expect(led.qty).toBe(8.4);
  expect(led.recipes[0].qty).toBe(8.4);
  expect(rows.find((r) => r.customer_text.includes("HEAT")).qty).toBe(8.4);
});

test("SWP first; waterproof only when no SWP is big enough; near-fit hint up to 90%", () => {
  const opts = [
    { skuId: "elg150", watt: 150, waterproof: true },
    { skuId: "swp156", watt: 156 },
    { skuId: "swp76", watt: 75 },
  ];
  expect(pickPsu(120, opts).skuId).toBe("swp156");
  expect(pickPsu(160, [...opts, { skuId: "elg300", watt: 300, waterproof: true }]).skuId).toBe("elg300");
  expect(pickPsu(400, opts)).toMatchObject({ skuId: "swp156", count: 4 });
  expect(nearFitPsu(61.2, opts).skuId).toBe("swp76"); // 82 %
  expect(nearFitPsu(151, opts)).toBeNull(); // 97 % of 156
  expect(nearFitPsu(50, opts)).toBeNull(); // already fits
});

test("mini dimmer 1:1 with the power supply", () => {
  const prices = new Map([...PRICES, ["mini", { unitPrice: 900, maxDiscount: 0 }]]);
  const { rows } = buildLinear(
    { ...base, dim: "1-10V", dimmerSkuId: "mini", circuits: [{ ckt: "A", lengths: [20] }] },
    prices,
    ids,
  );
  expect(rows.find((r) => r.customer_text.includes("SWITCHING")).qty).toBe(3);
  const mini = rows.find((r) => r.customer_text.includes("MINI DIMMER"));
  expect(mini.qty).toBe(3);
  expect(mini.recipes[0].qty).toBe(3);
});

test("power supply of the LED's own kind: 12V, constant current", () => {
  const p = (code, name) => ({ id: code, code, name });
  const psus = [p("A", "SWP 12V 75W"), p("B", "SWP 24V 100W"), p("C", "ELG-100-700A, (350mA-700mA), IP65")];
  expect(wattOfPsu(psus[2])).toBe(100);
  const g = linearSkuGroups(psus.map((s) => ({ ...s, notes: "[หมวด: Power supply]" })));
  const ids = (led) => g.psuForLed(led, "NON-DIM").map((o) => o.skuId);
  expect(ids(p("Aristo-CC-2.1", "Penta Wide IV CC, 2.1W, 700mA, 4000K"))).toEqual(["C"]);
  expect(ids(p("Aristo-CV-2.5", "Penta Wide Twin CV, 2.5W, 12Vdc, 3000K"))).toEqual(["A"]);
  expect(ids(p("LED-Top-12", "12W/m, 24Vdc, COB, 4000K"))).toEqual(["B"]);
  expect(ids(p("LED-X", "strip"))).toEqual(["B"]); // doesn't say: 24V
  expect(psuKindReport(psus, "NON-DIM", "CC").skipped.map((x) => x.reason)).toEqual([
    "เป็น 12V ไม่ใช่ constant current",
    "เป็น 24V ไม่ใช่ constant current",
  ]);
});

test("lengths keep the millimetres typed", () => {
  const { rows } = buildLinear({ ...base, circuits: [{ ckt: "A", lengths: [2.848, 3.2] }] }, PRICES, ids);
  expect(rows.find((r) => r.customer_text.startsWith("- L =")).customer_text).toBe("- L = 2.848M + 3.20M");
});

test("item number: heading + circuits, survives without circuit numbers", () => {
  const { rows } = buildLinear({ ...base, itemNo: "3" }, PRICES, ids);
  expect(rows.filter((r) => r.item_no).map((r) => r.item_no)).toEqual(["3", "3.1", "3.2"]);
});

test("older blocks keep the old rule: IP44 has no profile/painting; IP65 uses double jacket", () => {
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

test("PSU names CCSE actually uses are recognised", () => {
  const p = (code, name) => ({ id: code, code, name });
  expect(psuDimOf(p("PSU-100", "Power supply 24V 100W non dim"))).toBe("NON-DIM");
  expect(psuDimOf(p("PSU-100", "Power supply 24V 100W Non-Dim"))).toBe("NON-DIM");
  expect(psuDimOf(p("PSU-100", "หม้อแปลง 24V 100W ไม่ดิม"))).toBe("NON-DIM");
  expect(psuDimOf(p("PSU-100", "Power supply 24V 100W"))).toBe("NON-DIM");
  expect(psuDimOf(p("PSU-DALI", "Power supply 24V 100W DALI dim"))).toBe("DALI");
  expect(psuDimOf(p("PSUDIM0-10V", "Power supply 24V 60W"))).toBe("0-10V");
  expect(psuDimOf(p("PSU-D", "Dimmable driver 24V 60W"))).toBeNull();
  expect(psuDimOf(p("MONO", "Mono dimming PSU 60W DMX"))).toBe("DMX");
  expect(wattOfPsu(p("PSU100W24V", "Power supply"))).toBe(100);
  expect(wattOfPsu(p("X", "หม้อแปลง 24V 150 วัตต์"))).toBe(150);
  expect(wattOfPsu(p("LPV-100-24", "Mean Well"))).toBe(100);
  expect(wattOfPsu(p("HLG-150H-24A", "Mean Well"))).toBe(150);
  expect(wattOfPsu(p("X", "PSU 24V"))).toBeNull();
  const r = psuReport(
    [
      p("A", "Power supply 24V 100W non dim"),
      p("B", "Power supply 24V DALI 75W"),
      p("C", "Power supply 24V non dim"),
    ],
    "NON-DIM",
  );
  expect(r.options).toEqual([{ skuId: "A", watt: 100 }]);
  expect(r.skipped.map((x) => x.id)).toEqual(["B", "C"]);
});

test("no circuit number = no CKT. NO. line", () => {
  const { rows } = buildLinear(
    { ...base, circuits: [{ ckt: "", lengths: [2] }, { ckt: " ", lengths: [1] }] },
    PRICES,
    ids,
  );
  expect(rows.some((r) => r.customer_text.startsWith("CKT"))).toBe(false);
  expect(rows.filter((r) => r.customer_text.startsWith("- L =")).length).toBe(2);
});
