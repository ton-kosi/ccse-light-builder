import { test, expect } from "bun:test";
import { cleanScan, findByScan, parseBarcodeList, withBarcode } from "./barcode.ts";

const skus = [
  { id: "a", code: "LED-4.8W-60", barcodes: ["8851234567890"] },
  { id: "b", code: "PSU-100W", barcodes: ["PSU-OLD", "4710000000001"] },
  { id: "c", code: "PSU-150W", barcodes: ["4710000000001"] },
];

test("scanner noise is removed", () => {
  expect(cleanScan(" LED-4.8W-60\r\n")).toBe("LED-4.8W-60");
  expect(cleanScan("\u001d885123\t")).toBe("885123");
});

test("SKU code wins, case does not matter", () => {
  expect(findByScan(skus, "led-4.8w-60").match?.id).toBe("a");
});

test("supplier barcode and old code scan to the SKU", () => {
  expect(findByScan(skus, "8851234567890").match?.id).toBe("a");
  expect(findByScan(skus, "psu-old").match?.id).toBe("b");
});

test("a barcode on two SKUs asks to pick", () => {
  const r = findByScan(skus, "4710000000001");
  expect(r.match).toBeNull();
  expect(r.candidates.map((k) => k.id)).toEqual(["b", "c"]);
});

test("unknown scan", () => {
  expect(findByScan(skus, "nope")).toEqual({ match: null, candidates: [] });
  expect(findByScan(skus, "  ")).toEqual({ match: null, candidates: [] });
});

test("barcode list parsing and adding", () => {
  expect(parseBarcodeList("885, 886\n885 ; 887|")).toEqual(["885", "886", "887"]);
  expect(withBarcode(["885"], "886", "SKU-1")).toEqual(["885", "886"]);
  expect(withBarcode(["885"], "885", "SKU-1")).toEqual(["885"]);
  expect(withBarcode([], "sku-1", "SKU-1")).toEqual([]);
});
