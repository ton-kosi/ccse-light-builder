import { test, expect } from "bun:test";
import {
  busbarText,
  buildFilm,
  parseFilm,
  sizeProblem,
  transformersFor,
  transformerWatt,
} from "./film.ts";

const prices = new Map([
  ["film", { unitPrice: 18000, maxDiscount: 10 }],
  ["tr", { unitPrice: 3000, maxDiscount: 5 }],
]);
const P = (w, h, qty, busbar = "2W") => ({ w, h, qty, busbar });
const base = {
  v: 1,
  blockId: "f1",
  code: "",
  title: "PRIVACY FILM",
  filmSkuId: "film",
  maxW: 1.5,
  maxH: 3,
  wattPerM2: 10,
  showBusbar: true,
  locations: [
    { name: "RECEPTION (K.KHALID'S ROOM)", pieces: [P(0.8, 2.25, 1, "1H"), P(1.25, 2.25, 3)] },
  ],
  transformer: { mode: "priced", skuId: "tr", watt: 100, text: "TRANSFORMER", loadFactor: 0.8 },
  wiring: "by_buyer",
  install: { mode: "included", price: 0, text: "INSTALLATION FEE" },
  rowIds: [],
};
let n = 0;
const ids = () => `r${++n}`;

test("cutting size only, priced per m², busbar on width/height side", () => {
  const b = buildFilm(base, prices, ids);
  expect(b.rows.map((r) => [r.customer_text, r.qty, r.unit_price])).toEqual([
    ["RECEPTION (K.KHALID'S ROOM)", null, null],
    ["- CUTTING SIZE W: 0.80M x H: 2.25M (SINGLE BUSBAR ON HEIGHT SIDE)", 1, 32400],
    ["- CUTTING SIZE W: 1.25M x H: 2.25M (DOUBLE BUSBAR ON WIDTH SIDES)", 3, 50625],
    ["TRANSFORMER", 2, 3000], // 10.24 m² x 10 W = 102 W ÷ 80 W
    ["220V WIRING & ON/OFF SWITCH", 1, null],
    ["INSTALLATION FEE (INCLUDED)", null, null],
  ]);
  expect(b.rows[4].kind).toBe("by_buyer");
  expect(b.list).toBe(32400 + 151875 + 6000);
  expect(parseFilm(b.rows[1].recipes[0].note).locations.length).toBe(1);
  expect(b.problems).toEqual([]);
});

test("busbar hidden → same sizes merge into one line (GL 01)", () => {
  const b = buildFilm(
    {
      ...base,
      code: "GL 01",
      showBusbar: false,
      locations: [{ name: "", pieces: [P(1.15, 2.4, 3), P(1.15, 2.4, 1, "1W")] }],
      transformer: { ...base.transformer, mode: "existing" },
      wiring: "none",
      install: { mode: "priced", price: 16000, text: "INSTALLATION" },
    },
    new Map([["film", { unitPrice: 16000, maxDiscount: 0 }]]),
    ids,
  );
  expect(b.rows.map((r) => r.customer_text)).toEqual([
    "GL 01 : PRIVACY FILM",
    "- CUTTING SIZE W: 1.15M x H: 2.40M",
    "TRANSFORMER",
    "INSTALLATION",
  ]);
  expect([b.rows[1].qty, b.rows[1].unit_price]).toEqual([4, 44160]);
  expect([b.rows[2].kind, b.rows[2].qty]).toEqual(["existing", 2]); // 11.04 m² → 110 W
});

test("busbar required (unknown values count as missing)", () => {
  const b = buildFilm(
    { ...base, locations: [{ name: "A", pieces: [P(1, 2, 1, ""), P(1, 2, 1, "LEFT")] }] },
    prices,
    ids,
  );
  expect(b.problems.filter((p) => p.includes("busbar")).length).toBe(1);
  expect(busbarText("LEFT")).toBe("");
  expect(busbarText("2H")).toBe("DOUBLE BUSBAR ON HEIGHT SIDES");
});

test("max sheet 1.5 x 3 either way round", () => {
  expect(sizeProblem(P(1.5, 3, 1), 1.5, 3)).toBeNull();
  expect(sizeProblem(P(2.9, 1.4, 1), 1.5, 3)).toBeNull();
  expect(sizeProblem(P(1.6, 2, 1), 1.5, 3)).toContain("ใหญ่เกิน");
  expect(transformersFor({ name: "", pieces: [P(0.8, 2.3, 2)] }, base)).toBe(1);
  expect(transformerWatt({ id: "t", code: "T", name: "Transformer 65Vac 100W" })).toBe(100);
});

test("older saved sets: edge busbars become width/height sides, calculation size dropped", () => {
  const old = {
    ...base,
    locations: [
      {
        name: "",
        pieces: [{ w: 2, h: 1.5, qty: 1, busbar: "LEFT & RIGHT", calcW: 2.2, calcH: null }],
      },
    ],
  };
  const c = parseFilm(`PVF f1 FILM ${JSON.stringify(old)}`);
  expect(c.locations[0].pieces[0]).toEqual({ w: 2, h: 1.5, qty: 1, busbar: "2H" });
});
