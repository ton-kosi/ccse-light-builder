import { describe, expect, it } from "bun:test";
import { formatCutSpec, formatCutSpecWos, parseCutSpec, runsFromPieces } from "./cutSpec.ts";

describe("length × sets notation", () => {
  it("reads the WOS style with M, SETS, ( ) and joined runs", () => {
    const r = parseCutSpec("L = (0.682M x 2SETS) + ([3.015M + 3.515M] x 2SETS)");
    expect(r.runs).toEqual([
      { pieces: [0.682], sets: 2 },
      { pieces: [3.015, 3.515], sets: 2 },
    ]);
    expect(r.pieces).toEqual([0.682, 0.682, 3.015, 3.515, 3.015, 3.515]);
    expect(r.total).toBe(14.424);
  });

  it("reads the short form and plain lists", () => {
    expect(parseCutSpec("0.682x2 + [3.015+3.515]x2").total).toBe(14.424);
    expect(parseCutSpec("1.5+2.25, 3").pieces).toEqual([1.5, 2.25, 3]);
    expect(parseCutSpec("3.182 × 3").pieces).toEqual([3.182, 3.182, 3.182]);
    expect(parseCutSpec("(1.348M x 11SETS)").total).toBe(14.828);
  });

  it("writes it back in short and WOS style", () => {
    const r = parseCutSpec("(0.682M x 2SETS) + ([3.015M + 3.515M] x 2SETS) + 2.348");
    expect(formatCutSpec(r.runs)).toBe("0.682x2 + [3.015+3.515]x2 + 2.348");
    expect(formatCutSpecWos(r.runs)).toBe("(0.682M x 2SETS) + ([3.015M + 3.515M] x 2SETS) + (2.348M x 1SET)");
  });

  it("folds repeated pieces of a plain list into sets", () => {
    expect(formatCutSpecWos(runsFromPieces([0.682, 0.682, 3.015, 3.515, 3.515]))).toBe(
      "(0.682M x 2SETS) + (3.015M x 1SET) + (3.515M x 2SETS)",
    );
    expect(runsFromPieces([])).toEqual([]);
  });

  it("explains what it cannot read", () => {
    expect(parseCutSpec("")).toHaveProperty("error");
    expect(parseCutSpec("2+abc")).toHaveProperty("error");
    expect(parseCutSpec("[2+-1]x2")).toHaveProperty("error");
    expect(parseCutSpec("2x0")).toHaveProperty("error");
  });
});
