import { describe, expect, it } from "bun:test";
import { materialSummary, nextRound } from "./materials.ts";

const skus = new Map([
  ["led", { id: "led", code: "LED-72", name: "LED 7.2W 30 Nic 2700K", unit: "ม." }],
  ["psu", { id: "psu", code: "PSU-1", name: "SWP 24V 6.5A", unit: "ตัว" }],
  ["clip", { id: "clip", code: "CLP", name: "Clip", unit: "ชิ้น" }],
]);

describe("material issue summary", () => {
  it("matches the Wynn ใบเบิกของ: WOS 88 m, site 143.17 m, issued 147, returned 3.83", () => {
    const { rows, roundCount } = materialSummary({
      skus,
      demand: [{ sku_id: "led", qty: 88 }],
      firstIssue: [{ sku_id: "led", qty: 88 }],
      moves: [
        { kind: "issue", round_no: 2, sku_id: "led", qty: 59 },
        { kind: "return", round_no: null, sku_id: "led", qty: 3.83 },
      ],
      site: new Map([["led", 143.17]]),
    });
    expect(roundCount).toBe(2);
    expect(rows).toEqual([
      {
        sku: skus.get("led"),
        wos: 88,
        site: 143.17,
        rounds: [88, 59],
        issued: 147,
        returned: 3.83,
        used: 143.17,
        overWos: 55.17,
      },
    ]);
  });

  it("adds SKUs issued outside the WOS and sorts by code", () => {
    const { rows, roundCount } = materialSummary({
      skus,
      demand: [{ sku_id: "psu", qty: 2 }],
      firstIssue: [{ sku_id: "psu", qty: 2 }],
      moves: [{ kind: "issue", round_no: 3, sku_id: "clip", qty: 50 }],
    });
    expect(roundCount).toBe(3);
    expect(rows.map((r) => [r.sku.code, r.wos, r.rounds, r.used, r.site])).toEqual([
      ["CLP", 0, [0, 0, 50], 50, null],
      ["PSU-1", 2, [2, 0, 0], 2, null],
    ]);
  });

  it("numbers the next extra round after the highest one", () => {
    expect(nextRound([])).toBe(2);
    expect(nextRound([{ kind: "issue", round_no: 2, sku_id: "x", qty: 1 }])).toBe(3);
    expect(nextRound([{ kind: "return", round_no: null, sku_id: "x", qty: 1 }])).toBe(2);
  });
});
