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
