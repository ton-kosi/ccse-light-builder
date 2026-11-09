import { test, expect } from "bun:test";
import { attachNotes, blockConfigs, decodeOpenings, encodeOpenings, explodeLine, formatOpeningInput, markOpenings, openingInputOf, openingLines, roleOf } from "./wos.ts";

const SKUS = new Map(
  [
    ["led", "Aristo-CC", "Penta Wide IV CC, 2.1W, 700mA, 4000K", "ea"],
    ["psu", "ELG-100", "ELG-100-700A", "ea"],
    ["fab", "Clipso-308T", "Clipso 308T", "m"],
    ["cw", "Clipso-CW", "Clipso profile CW", "ea"],
    ["ill", "FO-90", "FO illuminator", "ea"],
    ["s", "FO-050", "FO cable 0.50mm", "m"],
    ["end", "FO-END", "FO end finishing", "ea"],
    ["strip", "LED-14", "14.4W/m, 24Vdc, 60dots", "m"],
    ["bar", "BAR-4", "Aluminium flat bar 4/8 inch", "m"],
    ["sw", "SWP-18.8", "SWP 24V 18.8A", "ea"],
    ["wp", "WP-18.8", "WP box", "ea"],
  ].map(([id, code, name, unit]) => [id, { id, code, name, unit }]),
);
const skuOf = (id) => SKUS.get(id);

test("roles read from any builder's note", () => {
  expect(roleOf('CLP ab12 FABRIC {"v":1}')).toBe("FABRIC");
  expect(roleOf("CNO ab12 HOUSING L")).toBe("HOUSING L");
  expect(roleOf("FO SIZE S: 100 จุด x 16 ม.")).toBe("SIZE S");
  expect(roleOf("FO ILLUMINATOR: LED 90W | (ATTACHED)")).toBe("ILLUMINATOR");
});

test("Clipso lighting: real model, modules and grid, like TARA", () => {
  const cfg = { v: 1, trackLength: 2, fabrics: [{ skuId: "fab", width: 3.4, rollLength: 50 }], panels: [{ shape: "rect", w: 2, l: 1.5, qty: 1 }], light: { kind: "module", spacingCm: 30, wattPerM: 2.1 } };
  const fabric = [
    { sku_id: "fab", qty: 1.7, note: `CLP b1 FABRIC ${JSON.stringify(cfg)}` },
    { sku_id: "cw", qty: 4, note: "CLP b1 TRACK" },
  ];
  const light = [
    { sku_id: "led", qty: 35, note: "CLP b1 LED" },
    { sku_id: "psu", qty: 1, note: "CLP b1 PSU" },
  ];
  const c = blockConfigs([...fabric, ...light]);
  const f = explodeLine('CLIPSO FABRIC\n- OPENING SIZE : 2.00M x 1.50M\n- CALCULATION SIZE : 3.40M x 1.70M\n- CEILING PROFILE "CW"', fabric, skuOf, c);
  expect(f.lineQty).toBe(false);
  expect(f.intro).toBe("CLIPSO FABRIC\n- OPENING SIZE : 2.00M x 1.50M");
  expect(f.parts.map((p) => [p.text, p.qty, p.unit])).toEqual([
    ["- CALCULATION SIZE : 3.40M x 1.70M", 1.7, "M."],
    ['- CEILING PROFILE "CW"', 8, "M."],
  ]);
  expect(f.parts[0].remark).toBe("ตัดจากม้วน 3.40M · Clipso-308T");
  const l = explodeLine("LED ABOVE THE FABRIC (ceiling to clipso 20cm.)\n- LED MODULE (4000K)\n- POWER SUPPLY 700mA NON-DIM\n- TOUCH PANEL x 1", light, skuOf, c);
  expect(l.parts.map((p) => [p.text, p.qty, p.unit, p.remark])).toEqual([
    ["- Penta Wide IV CC, 2.1W, 700mA, 4000K", 35, "ea", "7 × 5 = 35 ชิ้น"],
    ["- POWER SUPPLY 700mA NON-DIM", 1, "ea", "ELG-100-700A"],
    ["- TOUCH PANEL", 1, null, null],
  ]);
});

test("FO: metres and points per size, like FAIRMONT", () => {
  const rec = [
    { sku_id: "ill", qty: 1, note: "FO ILLUMINATOR: LED 90W" },
    { sku_id: "s", qty: 1600, note: "FO SIZE S: 100 จุด x 16 ม." },
    { sku_id: "end", qty: 100, note: "FO END FINISHING" },
  ];
  const r = explodeLine("AREA 1\n- ILLUMINATOR LED 90W x 1\n- FIBER OPTICS CABLES\n  + SIZE S x 100 POINTS\n- END FINISHING (100 POINTS)", rec, skuOf, blockConfigs(rec));
  expect(r.intro).toBe("AREA 1");
  expect(r.lineQty).toBe(false);
  expect(r.parts.map((p) => [p.text.trim(), p.qty, p.unit])).toEqual([
    ["- ILLUMINATOR LED 90W x 1", 1, "ea"],
    ["- FIBER OPTICS CABLES", null, null],
    ["+ SIZE S x 100 POINTS", 1600, "m"],
    ["- END FINISHING (100 POINTS)", 100, "ea"],
  ]);
});

test("stainless Canoe: one customer line becomes separate lines; retrofit stays as it is", () => {
  const cfg = { v: 1, blockId: "c1", housingType: "ss", rowIds: [] };
  const rec = [
    { sku_id: "strip", qty: 65.5, note: `CNO c1 LED ${JSON.stringify(cfg)}` },
    { sku_id: "bar", qty: 65.5, note: "CNO c1 RAIL" },
    { sku_id: "sw", qty: 3, note: "CNO c1 PSU" },
    { sku_id: "wp", qty: 3, note: "CNO c1 WP BOX" },
  ];
  const r = explodeLine("CANOE SS316L WSS.3150\n- INCLUDING POWER SUPPLY", rec, skuOf, blockConfigs(rec));
  expect(r.lineQty).toBe(true);
  expect(r.intro).toBe("CANOE SS316L WSS.3150");
  expect(r.parts.map((p) => [p.text, p.qty])).toEqual([
    ["- 14.4W/m, 24Vdc, 60dots", 65.5],
    ["- ALUMINIUM HEAT DISSIPATION (ราง 4/8 ในตัว Canoe)", 65.5],
    ["- SWITCHING POWER SUPPLY 24V", 3],
    ["- กล่องกันน้ำ", 3],
  ]);
  const retro = [{ sku_id: "strip", qty: 29.4, note: `CNO r1 LED ${JSON.stringify({ v: 1, housingType: "retrofit" })}` }];
  const x = explodeLine("- SWX-1 : L = 29.50M", retro, skuOf, blockConfigs(retro));
  expect(x.parts).toEqual([]);
  expect(x.remark).toBe("14.4W/m, 24Vdc, 60dots");
});

test("LED linear keeps its line, remark shows the model; no materials = unchanged", () => {
  const rec = [{ sku_id: "sw", qty: 1, note: "LIN b PSU" }];
  expect(explodeLine("- SWITCHING POWER SUPPLY 24V 75W", rec, skuOf, blockConfigs(rec))).toMatchObject({ parts: [], lineQty: true, remark: "SWP 24V 18.8A" });
  expect(explodeLine("INSTALLATION", [], skuOf, blockConfigs([])).parts).toEqual([]);
});

test("internal notes join the line above; first one stays its own row", () => {
  const L = (id, kind, t) => ({ id, kind, heading_text: t, component_name: null });
  const { rows, notes } = attachNotes([
    L("a", "internal", "** ลูกค้าจัดหม้อแปลงเอง"),
    L("b", "heading", "FLOOR 1"),
    L("c", "internal", "6/10/69 : วัดหลุมจริง"),
    L("d", "priced", "- LED"),
    L("e", "internal", "สั่งแล้ว"),
    L("f", "internal", "ถึง 20/3"),
  ]);
  expect(rows.map((r) => r.id)).toEqual(["a", "b", "d"]);
  expect(notes.get("b")).toEqual(["6/10/69 : วัดหลุมจริง"]);
  expect(notes.get("d")).toEqual(["สั่งแล้ว", "ถึง 20/3"]);
});

test("Clipso: measured opening sits beside the contract size it replaces, like TARA", () => {
  const text = "CLIPSO FABRIC\n- OPENING SIZE : 2.15M x 5.30M\n- OPENING SIZE : 0.90M x 1.80M x 18PCS.\n- CALCULATION SIZE : 3.40M x 5.90M";
  expect(openingLines(text)).toEqual(["2.15M x 5.30M", "0.90M x 1.80M x 18PCS."]);
  expect(openingLines("SIZE : DIA : 2.16M\n- CALCULATION SIZE 3.40M x 2.40M")).toEqual(["DIA : 2.16M"]);
  expect(formatOpeningInput("1.88x1.85x3")).toBe("1.88M x 1.85M x 3PCS.");
  expect(formatOpeningInput("1.96 x 1.6")).toBe("1.96M x 1.60M");
  expect(formatOpeningInput("2.16")).toBe("DIA : 2.16M");
  expect(formatOpeningInput("abc").error).toBeTruthy();
  expect(openingInputOf("1.88M x 1.85M x 3PCS.")).toBe("1.88x1.85x3");
  const spec = encodeOpenings(["1.88M x 1.85M x 3PCS.", ""]);
  expect(decodeOpenings(spec)).toEqual(["1.88M x 1.85M x 3PCS.", ""]);
  expect(decodeOpenings("0.682x2")).toBeNull();
  const m = markOpenings(text, spec);
  expect(m[1]).toEqual({ text: "- OPENING SIZE : ", old: "2.15M x 5.30M", next: "1.88M x 1.85M x 3PCS." });
  expect(m[2].next).toBeNull(); // not measured: unchanged
  expect(m[2].text).toBe("- OPENING SIZE : 0.90M x 1.80M x 18PCS.");
  expect(markOpenings(text, "0.682x2").every((l) => !l.old)).toBe(true);
});
