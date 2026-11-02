import { test, expect } from "bun:test";
import { assembleNeeds, explodeDemand, maxAssemble, parseBomCsv } from "./kits.ts";

const snapParts = [
  { component_sku_id: "housing", qty: 1 },
  { component_sku_id: "magnet", qty: 2 },
];

test("assemble 50 snap mounts: parts needed and shortages", () => {
  const onHand = new Map([["housing", 60], ["magnet", 80]]);
  const rows = assembleNeeds(snapParts, 50, onHand);
  expect(rows).toEqual([
    { component_sku_id: "housing", perKit: 1, need: 50, onHand: 60, short: 0 },
    { component_sku_id: "magnet", perKit: 2, need: 100, onHand: 80, short: 20 },
  ]);
  expect(maxAssemble(snapParts, onHand)).toBe(40);
  expect(maxAssemble(snapParts, new Map())).toBe(0);
  expect(maxAssemble([], onHand)).toBe(0);
});

test("phantom dimmer is replaced by its parts; stock kits and normal SKUs stay", () => {
  const modes = { dimmer: "phantom", snap: "stock", empty: "phantom" };
  const parts = {
    dimmer: [
      { component_sku_id: "board", qty: 1 },
      { component_sku_id: "wpbox", qty: 1 },
      { component_sku_id: "terminal", qty: 4 },
    ],
    snap: snapParts,
  };
  const out = explodeDemand(
    [
      { sku_id: "dimmer", qty: 2 },
      { sku_id: "snap", qty: 30 },
      { sku_id: "wpbox", qty: 1 },
      { sku_id: "empty", qty: 1 },
    ],
    (id) => modes[id] ?? "none",
    (id) => parts[id] ?? [],
  );
  expect(Object.fromEntries(out)).toEqual({ board: 2, wpbox: 3, terminal: 8, snap: 30, empty: 1 });
});

test("BOM CSV: parts grouped per kit, modes and errors with row numbers", () => {
  const ids = new Map([
    ["ACC-Mounting-V2-Snap", "snap"],
    ["ACC-Magnet-N52-150702", "magnet"],
    ["ACC-Acrylic-Housing", "housing"],
    ["ACC-DM-PD-DMX-4CH", "dimmer"],
  ]);
  const { kits, errors } = parseBomCsv(
    [
      { kit_code: "ACC-Mounting-V2-Snap", component_code: "ACC-Acrylic-Housing", qty: "1", kit_mode: "stock" },
      { kit_code: "ACC-Mounting-V2-Snap", component_code: "ACC-Magnet-N52-150702", qty: "1" },
      { kit_code: "ACC-Mounting-V2-Snap", component_code: "ACC-Magnet-N52-150702", qty: "1" },
      { kit_code: "ACC-DM-PD-DMX-4CH", component_code: "NOPE", qty: "1", kit_mode: "phantom" },
      { kit_code: "ACC-DM-PD-DMX-4CH", component_code: "ACC-DM-PD-DMX-4CH", qty: "1" },
      { kit_code: "", component_code: "", qty: "" },
    ],
    ids,
  );
  expect(kits.get("snap")).toEqual({
    mode: "stock",
    parts: [
      { component_sku_id: "housing", qty: 1 },
      { component_sku_id: "magnet", qty: 2 },
    ],
  });
  expect(errors).toEqual(["แถว 5: ไม่พบชิ้นส่วน NOPE", "แถว 6: ACC-DM-PD-DMX-4CH ใช้ตัวเองเป็นชิ้นส่วนไม่ได้"]);
});
