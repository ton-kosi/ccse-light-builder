import { test, expect } from "bun:test";
import {
  savedCategory,
  noteText,
  withCategory,
  guessCategory,
  categoryOf,
  inCategory,
  categoryOptions,
} from "./skuCategory.ts";
import { foSkuGroups } from "./fo.ts";
import { linearSkuGroups } from "./linear.ts";

test("category tag lives at the start of notes and is hidden from the note", () => {
  const n = withCategory("ซื้อจากจีน", "LED ribbon");
  expect(n).toBe("[หมวด: LED ribbon] ซื้อจากจีน");
  expect(savedCategory(n)).toBe("LED ribbon");
  expect(noteText(n)).toBe("ซื้อจากจีน");
  // changing category replaces the tag, never stacks it
  expect(withCategory(n, "Power supply")).toBe("[หมวด: Power supply] ซื้อจากจีน");
  expect(withCategory(n, null)).toBe("ซื้อจากจีน");
  expect(withCategory("", null)).toBeNull();
  expect(savedCategory("plain note")).toBeNull();
});

test("guesses from CCSE SKU names", () => {
  const g = (code, name) => guessCategory({ code, name });
  expect(g("FO50W", "FO illuminator 50W Halogen")).toBe("FO illuminator");
  expect(g("FOcable0.75", "FO cable 0.75mm")).toBe("FO cable");
  expect(g("FOWP50W", "WP box for FO 50W")).toBe("FO accessory");
  expect(g("FOharness", "FO Harness")).toBe("FO accessory");
  expect(g("FOendfinishing", "FO End Finishing")).toBe("FO accessory");
  expect(g("PSU-75-DALI", "PSU 24V 75W DALI")).toBe("Power supply");
  expect(g("cover4h", "jacket")).toBe("LED jacket");
  expect(g("ALU-FB", "Aluminium flat bar")).toBe("LED heat sink");
  expect(g("PRF-V213", "Aluminium V2.13 profile")).toBe("LED profile");
  expect(g("PAINT", "Industrial spray painting")).toBe("Service");
  expect(g("Strip4.8W60d2700K", "LED Strip 4.5W/m 24V 2700K")).toBe("LED ribbon");
});

test("saved category wins over the guess, and pickers follow it", () => {
  const skus = [
    { id: "a", code: "X1", name: "LED Strip 10W/m", notes: null },
    { id: "b", code: "X2", name: "LED Strip 14W/m", notes: "[หมวด: อื่นๆ]" },
    { id: "c", code: "X3", name: "Something", notes: "[หมวด: LED ribbon] note" },
    { id: "d", code: "X4", name: "Gadget", notes: "[หมวด: Custom stuff]" },
  ];
  expect(categoryOf(skus[1])).toBe("อื่นๆ");
  expect(inCategory(skus, "LED ribbon").map((s) => s.id)).toEqual(["a", "c"]);
  expect(linearSkuGroups(skus).leds.map((s) => s.id)).toEqual(["a", "c"]);
  expect(categoryOptions(skus).at(-1)).toBe("Custom stuff");
});

test("FO accessory dropdowns narrow by name, fall back to the whole category", () => {
  const skus = [
    { id: "h", code: "FOharness", name: "FO Harness" },
    { id: "x", code: "ACC9", name: "Mystery part", notes: "[หมวด: FO accessory]" },
    { id: "led", code: "S1", name: "LED Strip" },
  ];
  const g = foSkuGroups(skus);
  expect(g.options.harnesses.map((s) => s.id)).toEqual(["h"]);
  expect(g.options.ports.map((s) => s.id)).toEqual(["h", "x"]);
  expect(g.ports).toEqual([]);
});

import { readTags, writeTags } from "./skuCategory.ts";
import { guessAttrs, attrSummary } from "./skuAttrs.ts";
import { chipOf, pcbOf, usesEzClip, railOf, profileModelOfSku } from "./profiles.ts";
import { psuDimOf, wattOfPsu, wattPerMOf } from "./linear.ts";

test("several tags; changing the category keeps the others", () => {
  const n = writeTags("ซื้อจากจีน", { ชิป: "NICHIA", ปริ้น: 10, หมวด: "LED ribbon", "EZ clip": false });
  expect(n).toBe("[หมวด: LED ribbon] [ชิป: NICHIA] [ปริ้น: 10] ซื้อจากจีน");
  expect(readTags(n)).toEqual({ หมวด: "LED ribbon", ชิป: "NICHIA", ปริ้น: "10" });
  expect(noteText(n)).toBe("ซื้อจากจีน");
  expect(readTags(withCategory(n, "Neon flex"))).toEqual({ หมวด: "Neon flex", ชิป: "NICHIA", ปริ้น: "10" });
});

test("builders read SKU fields first, the name only as fallback", () => {
  const s = (name, notes = null) => ({ id: "x", code: "X", name, notes });
  const led = s("LED strip", "[หมวด: LED ribbon] [W/m: 13.8] [ชิป: NICHIA] [ปริ้น: 12] [EZ clip: ไม่]");
  expect([wattPerMOf(led), chipOf(led), pcbOf(led), usesEzClip(led)]).toEqual([13.8, "NICHIA", 12, false]);
  expect(usesEzClip(s("strip EZ clip", "[EZ clip: ไม่]"))).toBe(false);
  expect(railOf(s("flat bar", "[ราง: 4/8]"))).toBe("4/8");
  expect(profileModelOfSku(s("my profile", "[รุ่น: W22.20]")).key).toBe("W22.20");
  expect(profileModelOfSku(s("Jedi V2 W13.25 profile")).key).toBe("W13.25");
  expect(profileModelOfSku(s("some profile"))).toBeNull();
  const p = s("driver", "[วัตต์: 100] [ดิม: DALI]");
  expect([wattOfPsu(p), psuDimOf(p)]).toEqual([100, "DALI"]);
  // guesses fill what the name says, saved fields win
  expect(guessAttrs(s("drivernondim25W"), "Power supply")).toEqual({ วัตต์: "25", ดิม: "NON-DIM" });
  expect(guessAttrs(s("LED Strip 4.8W/m", "[ชิป: NICHIA]"), "LED ribbon")).toEqual({ "W/m": "4.8", ชิป: "NICHIA" });
  expect(attrSummary("LED ribbon", { "W/m": "18", ชิป: "NICHIA", ปริ้น: "10", "EZ clip": "ไม่" })).toBe(
    "18 W/m · NICHIA · ปริ้น 10 มม.",
  );
});
