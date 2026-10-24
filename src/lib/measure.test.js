import { describe, expect, it } from "bun:test";
import { compareLine, compareTotals, isLengthUnit, isMeasurable, measurementFromInput } from "./measure.ts";

describe("site measurement input", () => {
  it("only measures real work lines", () => {
    expect(isMeasurable("priced")).toBe(true);
    expect(isMeasurable("heading")).toBe(false);
    expect(isMeasurable("internal")).toBe(false);
    expect(isMeasurable("by_buyer")).toBe(false);
  });

  it("knows length units", () => {
    expect(isLengthUnit("ม.")).toBe(true);
    expect(isLengthUnit("เมตร")).toBe(true);
    expect(isLengthUnit("M")).toBe(true);
    expect(isLengthUnit("ชุด")).toBe(false);
  });

  it("sums cut lengths into the quantity for a length unit", () => {
    expect(measurementFromInput({ qty: "", cuts: "1.5+2.25, 3", unit: "ม." })).toEqual({
      measured_qty: 6.75,
      cut_lengths: [1.5, 2.25, 3],
      cut_spec: "1.5 + 2.25 + 3",
    });
  });

  it("expands length × sets and keeps the notation", () => {
    expect(
      measurementFromInput({ qty: "", cuts: "(0.682M x 2SETS) + ([3.015M + 3.515M] x 2SETS)", unit: "ม." }),
    ).toEqual({
      measured_qty: 14.424,
      cut_lengths: [0.682, 0.682, 3.015, 3.515, 3.015, 3.515],
      cut_spec: "0.682x2 + [3.015+3.515]x2",
    });
  });

  it("keeps a typed quantity over the sum and accepts commas in numbers", () => {
    expect(measurementFromInput({ qty: "1,200", cuts: "", unit: "ม." })).toEqual({
      measured_qty: 1200,
      cut_lengths: null,
      cut_spec: null,
    });
    expect(measurementFromInput({ qty: "7", cuts: "3+3", unit: "ม." })).toEqual({
      measured_qty: 7,
      cut_lengths: [3, 3],
      cut_spec: "3 + 3",
    });
  });

  it("does not invent a quantity from cut lengths for a non-length unit", () => {
    expect(measurementFromInput({ qty: "", cuts: "2+2", unit: "ชุด" })).toEqual({
      measured_qty: null,
      cut_lengths: [2, 2],
      cut_spec: "2 + 2",
    });
  });

  it("rejects bad input", () => {
    expect(measurementFromInput({ qty: "", cuts: "", unit: "ม." })).toHaveProperty("error");
    expect(measurementFromInput({ qty: "-1", cuts: "", unit: "ม." })).toHaveProperty("error");
    expect(measurementFromInput({ qty: "", cuts: "2+abc", unit: "ม." })).toHaveProperty("error");
  });
});

describe("contract vs measured", () => {
  it("prices the difference after the line discount", () => {
    expect(compareLine({ contractQty: 10, measuredQty: 12.5, unitPrice: 100, discountPercent: 10 })).toEqual({
      qtyDiff: 2.5,
      amountDiff: 225,
    });
    expect(compareLine({ contractQty: 10, measuredQty: 8, unitPrice: 100, discountPercent: 0 })).toEqual({
      qtyDiff: -2,
      amountDiff: -200,
    });
  });

  it("totals the money and counts changed lines", () => {
    expect(
      compareTotals([
        { contractQty: 10, measuredQty: 12, unitPrice: 100, discountPercent: 0 },
        { contractQty: 5, measuredQty: 5, unitPrice: 50, discountPercent: 0 },
        { contractQty: 3, measuredQty: 2, unitPrice: 30, discountPercent: 0 },
      ]),
    ).toEqual({ amountDiff: 170, changed: 2 });
  });
});
