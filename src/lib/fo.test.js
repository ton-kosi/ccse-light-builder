import { test, expect } from "bun:test";
import {
  buildFoRecipes,
  buildFoText,
  parseFo,
  foSkuGroups,
  matchByWatt,
  illuminatorDisplayName,
} from "./fo.ts";

// SKU list as entered in CCSE's system
const SKUS = [
  { id: "ill50", code: "FO50W", name: "FO illuminator 50W Halogen" },
  { id: "c05", code: "FOcable0.5", name: "FO cable 0.5mm" },
  { id: "c075", code: "FOcable0.75", name: "FO cable 0.75mm" },
  { id: "c1", code: "Focable1", name: "FO cable 1.00mm" },
  { id: "wp50", code: "FOWP50W", name: "WP box for FO 50W" },
  { id: "port", code: "FOopticalport", name: "FO standard Optical Port" },
  { id: "har", code: "FOharness", name: "FO Harness" },
  { id: "end", code: "FOendfinishing", name: "FO End Finishing" },
  { id: "led", code: "Strip4.8W60d2700K", name: "LED Strip 4.5W/m 24V 2700K" },
];

// ALIEN Option 1: 2 machines, S 1,500 / M 280 / L 100 points
const alien = {
  title: "OPTION 1 :",
  illuminatorSkuId: "ill50",
  illuminatorName: "220Vac HALOGEN 100W STARRY MONO COLOR",
  locatedNote: "(LOCATED AS ATTACHED)",
  machines: 2,
  lengthPerPoint: 4,
  sizes: [
    { label: "S", skuId: "c05", points: 1500 },
    { label: "M", skuId: "c075", points: 280 },
    { label: "L", skuId: "c1", points: 100 },
  ],
  endSkuId: "end",
  harnessSkuId: "har",
  portSkuId: "port",
  wpSkuId: "wp50",
  showWp: false,
};

test("materials use real quantities", () => {
  const q = Object.fromEntries(buildFoRecipes(alien).map((r) => [r.sku_id, r.qty]));
  expect(q).toEqual({
    ill50: 2,
    c05: 6000,
    c075: 1120,
    c1: 400,
    end: 1880,
    har: 2,
    port: 2,
    wp50: 2,
  });
});

test("customer text matches the ALIEN quotation and hides meters", () => {
  const t = buildFoText(alien);
  expect(t).toBe(
    [
      "OPTION 1 :",
      "- ILLUMINATOR 220Vac HALOGEN 100W STARRY MONO COLOR x 2 (LOCATED AS ATTACHED)",
      "- FIBER OPTICS CABLES WITH 3 MIXED DIAMETER",
      "  + SIZE S x 1,500 POINTS",
      "  + SIZE M x 280 POINTS",
      "  + SIZE L x 100 POINTS",
      "- END FINISHING (1,880 POINTS)",
      "- HARNESS x 2",
      "- OPTICAL PORT x 2",
    ].join("\n"),
  );
  expect(t).not.toMatch(/6000|6,000|1120|ม\.|\bmeters?\b/i);
});

test("WP box is optional and only printed when ticked", () => {
  const none = buildFoRecipes({ ...alien, wpSkuId: null });
  expect(none.some((r) => r.sku_id === "wp50")).toBe(false);
  expect(buildFoText({ ...alien, showWp: true })).toContain("- WP BOX x 2");
});

test("sizes with zero points are skipped; single size wording", () => {
  const one = {
    ...alien,
    sizes: [
      { label: "S", skuId: "c05", points: 500 },
      { label: "M", skuId: "c075", points: 0 },
    ],
  };
  expect(buildFoText(one)).toContain("- FIBER OPTICS CABLES\n  + SIZE S x 500 POINTS");
  expect(buildFoRecipes(one).find((r) => r.sku_id === "c075")).toBeUndefined();
  expect(buildFoRecipes(one).find((r) => r.sku_id === "end").qty).toBe(500);
});

test("saved set can be opened again for editing", () => {
  const back = parseFo(buildFoRecipes(alien), buildFoText(alien));
  expect(back).toEqual(alien);
  const noWp = { ...alien, wpSkuId: null, locatedNote: "" };
  expect(parseFo(buildFoRecipes(noWp), buildFoText(noWp))).toEqual(noWp);
});

test("normal lines are not FO sets", () => {
  expect(parseFo([{ sku_id: "led", qty: 3, note: null }], "LED")).toBeNull();
});

test("defaults picked from CCSE SKU names", () => {
  const g = foSkuGroups(SKUS);
  expect(g.illuminators.map((s) => s.id)).toEqual(["ill50"]);
  expect(g.cables.map((s) => s.id)).toEqual(["c05", "c075", "c1"]);
  expect(g.ends.map((s) => s.id)).toEqual(["end"]);
  expect(g.harnesses.map((s) => s.id)).toEqual(["har"]);
  expect(g.ports.map((s) => s.id)).toEqual(["port"]);
  expect(g.wps.map((s) => s.id)).toEqual(["wp50"]);
  const ill = SKUS[0];
  expect(matchByWatt([{ id: "wp100", code: "FOWP100W", name: "WP box 100W" }, ...g.wps], ill)).toBe(
    "wp50",
  );
  expect(illuminatorDisplayName(ill)).toBe("220Vac HALOGEN 50W STARRY MONO COLOR");
});
