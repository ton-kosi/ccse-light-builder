import { describe, expect, it } from "bun:test";
import { addMonthsIso, coverage, projectWarranty, warrantyEnd, warrantyStart } from "./warranty.ts";

describe("warranty dates", () => {
  it("adds months and clamps to the month end", () => {
    expect(addMonthsIso("2026-10-24", 24)).toBe("2028-10-24");
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2027-12-15", 1)).toBe("2028-01-15");
  });

  it("ends the day before the anniversary", () => {
    expect(warrantyEnd("2026-10-24", 24)).toBe("2028-10-23"); // LED 2 ปี
    expect(warrantyEnd("2026-10-24", 60)).toBe("2031-10-23"); // CLIPSO 5 ปี
    expect(warrantyEnd("2026-03-01", 12)).toBe("2027-02-28"); // PSU 1 ปี
  });

  it("starts at the last installation handover, else when the project reached ส่งมอบ", () => {
    expect(warrantyStart(["2026-10-20", "2026-11-02"], "2026-10-21T08:00:00Z")).toBe("2026-11-02");
    expect(warrantyStart([], "2026-10-21T08:00:00Z")).toBe("2026-10-21");
    expect(warrantyStart([], null)).toBe(null);
  });
});

describe("project warranty (TARA: Clipso + LED + PSU)", () => {
  const rules = new Map([
    ["Clipso fabric", 60],
    ["LED module", 24],
    ["Power supply", 12],
  ]);
  const items = projectWarranty(["LED module", "Clipso fabric", "Power supply", "อื่นๆ", "LED module"], rules, "2026-10-24", "2028-01-10");

  it("lists each product type once, longest first, with end dates", () => {
    expect(items).toEqual([
      { category: "Clipso fabric", months: 60, endsOn: "2031-10-23", active: true },
      { category: "LED module", months: 24, endsOn: "2028-10-23", active: true },
      { category: "Power supply", months: 12, endsOn: "2027-10-23", active: false },
      { category: "อื่นๆ", months: null, endsOn: null, active: false },
    ]);
  });

  it("tells whether a failed part is covered", () => {
    const by = new Map(items.map((i) => [i.category, i]));
    expect(coverage(by.get("LED module"), "2026-10-24")).toEqual({ status: "in", endsOn: "2028-10-23" });
    expect(coverage(by.get("Power supply"), "2026-10-24")).toEqual({ status: "out", endsOn: "2027-10-23" });
    expect(coverage(by.get("อื่นๆ"), "2026-10-24").status).toBe("no_rule");
    expect(coverage(by.get("LED module"), null).status).toBe("not_started");
  });
});
