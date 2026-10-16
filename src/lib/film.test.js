import { test, expect } from "bun:test";
import { buildFilm, parseFilm, sizeProblem, transformersFor, transformerWatt } from "./film.ts";

const prices = new Map([
  ["film", { unitPrice: 18000, maxDiscount: 10 }],
  ["tr", { unitPrice: 3000, maxDiscount: 5 }],
]);
const P = (w, h, qty, busbar = "LEFT & RIGHT", calcW = null, calcH = null) => ({ w, h, qty, busbar, calcW, calcH });
const base = {
  v: 1, blockId: "f1", code: "", title: "PRIVACY FILM", filmSkuId: "film", maxW: 1.5, maxH: 3, wattPerM2: 10,
  showBusbar: false,
  locations: [{ name: "RECEPTION (K.KHALID'S ROOM)", pieces: [P(0.8, 2.25, 1, "LEFT", 0.98), P(1.25, 2.25, 3, "LEFT", 1.5)] }],
  transformer: { mode: "priced", skuId: "tr", watt: 100, text: "TRANSFORMER", loadFactor: 0.8 },
  wiring: "by_buyer", install: { mode: "included", price: 0, text: "INSTALLATION FEE" }, rowIds: [],
};
let n = 0;
const ids = () => `r${++n}`;

test("Cathay House item 1: cutting vs calculation sizes, priced per m²", () => {
  const b = buildFilm(base, prices, ids);
  expect(b.rows.map((r) => [r.customer_text, r.qty, r.unit_price])).toEqual([
    ["RECEPTION (K.KHALID'S ROOM)", null, null],
    ["- CUTTING SIZE W: 0.80M x H: 2.25M x 1PC.", null, null],
    ["- CUTTING SIZE W: 1.25M x H: 2.25M x 3PCS.", null, null],
    ["- CALCULATION SIZE W: 0.98M x H: 2.25M", 1, 39690],
    ["- CALCULATION SIZE W: 1.50M x H: 2.25M", 3, 60750],
    ["TRANSFORMER", 2, 3000], // 12.33 m² x 10 W = 123 W ÷ 80 W
    ["220V WIRING & ON/OFF SWITCH", 1, null],
    ["INSTALLATION FEE (INCLUDED)", null, null],
  ]);
  expect(b.rows[6].kind).toBe("by_buyer");
  expect(b.list).toBe(39690 + 182250 + 6000);
  expect(parseFilm(b.rows[3].recipes[0].note).locations.length).toBe(1);
  expect(b.problems).toEqual([]);
});

test("same cut and calc size, no busbar shown → only the calculation line (GL 01)", () => {
  const b = buildFilm(
    { ...base, code: "GL 01", locations: [{ name: "", pieces: [P(1.15, 2.4, 4)] }], transformer: { ...base.transformer, mode: "existing" }, wiring: "none", install: { mode: "priced", price: 16000, text: "INSTALLATION" } },
    new Map([["film", { unitPrice: 16000, maxDiscount: 0 }]]),
    ids,
  );
  expect(b.rows.map((r) => r.customer_text)).toEqual([
    "GL 01 : PRIVACY FILM",
    "- CALCULATION SIZE W: 1.15M x H: 2.40M",
    "TRANSFORMER",
    "INSTALLATION",
  ]);
  expect(b.rows[1].unit_price).toBe(44160);
  expect([b.rows[2].kind, b.rows[2].qty]).toEqual(["existing", 2]); // 11.04 m² → 110 W
});

test("busbar shown on cutting lines and required", () => {
  const b = buildFilm({ ...base, showBusbar: true, locations: [{ name: "A", pieces: [P(1, 2, 1, "TOP & BOTTOM"), P(1, 2, 1, "")] }] }, prices, ids);
  expect(b.rows[1].customer_text).toBe("- CUTTING SIZE W: 1.00M x H: 2.00M x 1PC. (BUSBAR: TOP & BOTTOM)");
  expect(b.problems.some((p) => p.includes("busbar"))).toBe(true);
});

test("max sheet 1.5 x 3 either way round", () => {
  expect(sizeProblem(P(1.5, 3, 1), 1.5, 3)).toBeNull();
  expect(sizeProblem(P(2.9, 1.4, 1), 1.5, 3)).toBeNull();
  expect(sizeProblem(P(1.6, 2, 1), 1.5, 3)).toContain("ใหญ่เกิน");
  expect(transformersFor({ name: "", pieces: [P(0.8, 2.3, 2, "LEFT", 0.98)] }, base)).toBe(1);
  expect(transformerWatt({ id: "t", code: "T", name: "Transformer 65Vac 100W" })).toBe(100);
});
