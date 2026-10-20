import { describe, expect, it } from "bun:test";
import { countAdjustments, parseCount } from "./stockCount.ts";

describe("stock count import", () => {
  it("reads blank as not counted and rejects negatives or text", () => {
    expect(parseCount("")).toBe(null);
    expect(parseCount(undefined)).toBe(null);
    expect(parseCount("1,250.5")).toBe(1250.5);
    expect(parseCount("0")).toBe(0);
    expect(parseCount("-3")).toBe("invalid");
    expect(parseCount("abc")).toBe("invalid");
  });

  it("adjusts by the difference from on-hand and skips unchanged SKUs", () => {
    const onHand = new Map([
      ["a", 10],
      ["b", 5],
    ]);
    expect(
      countAdjustments(
        [
          { skuId: "a", qty: 12 },
          { skuId: "b", qty: 5 },
          { skuId: "c", qty: 3 },
        ],
        onHand,
      ),
    ).toEqual([
      { sku_id: "a", qty: 2 },
      { sku_id: "c", qty: 3 },
    ]);
  });

  it("brings stock down to zero and lets the last row for a SKU win", () => {
    expect(
      countAdjustments(
        [
          { skuId: "a", qty: 4 },
          { skuId: "a", qty: 0 },
        ],
        new Map([["a", 7]]),
      ),
    ).toEqual([{ sku_id: "a", qty: -7 }]);
  });

  it("ignores floating-point noise", () => {
    expect(countAdjustments([{ skuId: "a", qty: 0.3 }], new Map([["a", 0.1 + 0.2]]))).toEqual([]);
  });
});
