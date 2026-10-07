import { describe, expect, it } from "bun:test";
import { parseCutLengths, sumCut } from "./boq.ts";

describe("quotation cut-length totals", () => {
  it("totals 1.50+1.40 as 2.90 meters independently of sale quantity", () => {
    expect(sumCut(parseCutLengths("1.50+1.40"))).toBe(2.9);
  });
  it("totals repeated pieces individually", () => {
    expect(sumCut(parseCutLengths("1.50+1.50+1.40+1.40"))).toBe(5.8);
  });
});