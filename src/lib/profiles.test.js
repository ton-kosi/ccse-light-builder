import { test, expect } from "bun:test";
import {
  profileModel,
  jediPercent,
  fitProblem,
  railNeeded,
  railOf,
  pcbOf,
  chipOf,
  usesEzClip,
  profileSize,
  profileText,
  matchProfileSku,
} from "./profiles.ts";
import { buildLinear, typeHeading } from "./linear.ts";

const W1313 = profileModel("W13.13");
const W2225 = profileModel("W22.25");
const R45 = profileModel("45R");

test("Jedi % per LED and profile (from the sheets)", () => {
  expect(jediPercent(W1313, 4.5, "STANDARD")).toBe(50);
  expect(jediPercent(profileModel("W22.13"), 4.5, "STANDARD")).toBe(50);
  expect(jediPercent(profileModel("W13.20"), 7, "NICHIA")).toBe(45);
  expect(jediPercent(W2225, 13.8, "NICHIA")).toBe(100);
  expect(jediPercent(R45, 13.8, "NICHIA")).toBe(85);
  expect(jediPercent(R45, 13.8, "STANDARD")).toBe(100);
  expect(jediPercent(W1313, 14.4, "STANDARD")).toBeNull(); // not on the sheet
});

test("overall size follows mounting and trim", () => {
  const p = (model, mount, trim = false) => profileSize({ model, mount, trim, diffuser: "JEDI" });
  expect(p(W1313, "CLIP")).toEqual([13.4, 18.4]);
  expect(p(W1313, "SILICONE")).toEqual([13.4, 12.8]);
  expect(p(W1313, "CLIP", true)).toEqual([22.6, 18.3]);
  expect(p(W2225, "SNAP", true)).toEqual([31.2, 29.2]);
  expect(p(R45, "SCREW")).toEqual([26.1, 17]);
  expect(p(R45, "SILICONE", true)).toEqual([18.9, 15]); // 45 Reverse has no trim
  expect(profileText({ model: W1313, mount: "SILICONE", trim: true, diffuser: "SATIN" })).toBe(
    "ALUMINIUM PROFILE JEDI V2 W13.13 w/ TRIM, SATIN DIFFUSER & SILICONE MOUNTING (SIZE 22.60 x 12.80 MM)",
  );
});

test("PCB width and rail rules", () => {
  expect(fitProblem(W1313, 12)).toContain("เกิน 10");
  expect(fitProblem(R45, 12)).not.toBeNull();
  expect(fitProblem(W2225, 12)).toBeNull();
  expect(fitProblem(W1313, 10)).toBeNull();
  expect(fitProblem(W1313, null)).toBeNull();
  expect(railNeeded(W1313, false)).toBe("3/8");
  expect(railNeeded(R45, false)).toBe("3/8");
  expect(railNeeded(W2225, false)).toBe("4/8");
  expect(railNeeded(W1313, true)).toBe("4/8");
  expect(railNeeded(null, false)).toBeNull();
  expect(railOf({ id: "a", code: "ALU38", name: 'Aluminium rail 3/8"' })).toBe("3/8");
  expect(railOf({ id: "a", code: "ALU48", name: "Aluminium rail 4/8" })).toBe("4/8");
  const led = (name) => ({ id: "x", code: "S", name });
  expect(pcbOf(led("LED strip RGBW 24V 19.2W/m"))).toBe(12);
  expect(pcbOf(led("LED strip 8mm 24V"))).toBe(8);
  expect(pcbOf(led("LED strip 24V 18W/m"))).toBeNull();
  expect(chipOf(led("LED 13.8W/m Nichia"))).toBe("NICHIA");
  expect(usesEzClip(led("LED strip EZ-clip 14.4W"))).toBe(true);
});

test("stock SKU matched by model, trim and mounting", () => {
  const skus = [
    { id: "a", code: "PRF-W1313", name: "Jedi V2 W13.13 profile" },
    { id: "b", code: "PRF-W1313-T", name: "Jedi V2 W13.13 profile trim" },
    { id: "c", code: "PRF-W1313-S", name: "Jedi V2 W13.13 silicone" },
    { id: "d", code: "PRF-W2213", name: "Jedi V2 W22.13 profile" },
    { id: "e", code: "45R-SCR", name: "45 Reverse screw" },
  ];
  const m = (model, mount, trim) => matchProfileSku(skus, { model, mount, trim, diffuser: "JEDI" })?.id;
  expect(m(W1313, "CLIP", false)).toBe("a");
  expect(m(W1313, "CLIP", true)).toBe("b");
  expect(m(W1313, "SILICONE", false)).toBe("c");
  expect(m(profileModel("W22.13"), "CLIP", false)).toBe("d");
  expect(m(R45, "SCREW", false)).toBe("e");
  expect(m(W2225, "CLIP", false)).toBeUndefined();
});

test("Jedi % goes after the LED name in the heading", () => {
  expect(typeHeading({ typeCode: "LT1", ledName: "LED 18W/M 3000K", ip: "IP54", dim: "DALI" }, 90)).toBe(
    "LT1 : LED 18W/M 3000K (JEDI 90%) IP54 DALI-DIM",
  );
  const cfg = {
    v: 1, blockId: "b", typeCode: "", ledSkuId: "l", ledName: "LED 4.5W/M", wattPerM: 4.5, ip: "IP54",
    dim: "NON-DIM", heatsinkSkuId: null, singleJacketSkuId: null, doubleJacketSkuId: null,
    profileSkuId: "p", profileName: "P", profileExtras: [], color: "", paintSkuId: null, psuOptions: [],
    loadFactor: 0.8, show: { heatsink: false, profile: false, paint: false, psu: false },
    circuits: [{ ckt: "", lengths: [1] }], rowIds: [], profileModel: "W13.20", mount: "CLIP",
    diffuser: "JEDI", chip: "STANDARD",
  };
  let i = 0;
  const head = (c) => buildLinear(c, new Map(), () => `r${++i}`).rows[0].customer_text;
  expect(head(cfg)).toBe("LED 4.5W/M (JEDI 80%) IP54 NON-DIM");
  expect(head({ ...cfg, diffuser: "SATIN" })).toBe("LED 4.5W/M IP54 NON-DIM");
  expect(head({ ...cfg, ip: "IP44" })).toBe("LED 4.5W/M IP44 NON-DIM");
  expect(head({ ...cfg, jediPct: 70 })).toBe("LED 4.5W/M (JEDI 70%) IP54 NON-DIM");
});
