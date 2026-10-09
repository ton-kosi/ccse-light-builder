import { test, expect } from "bun:test";
import { pageBreaks } from "./pdf.ts";
import { defaultPrintLabel, termPrintLabel, groupBySection } from "./clauses.ts";

test("no keep blocks: fixed page slices", () => {
  expect(pageBreaks(2500, 1000, [])).toEqual([1000, 2000, 2500]);
});

test("a row crossing the page end moves to the next page", () => {
  expect(pageBreaks(2000, 1000, [{ top: 950, bottom: 1050 }])).toEqual([950, 1950, 2000]);
});

test("sign-off block is kept whole when it fits on a page", () => {
  // footer 700px tall starting at 800 would be cut at 1000 -> page ends at 800 instead
  expect(pageBreaks(1500, 1000, [{ top: 800, bottom: 1500 }])).toEqual([800, 1500]);
});

test("nested blocks: break before the outer block", () => {
  const keeps = [
    { top: 700, bottom: 1300 }, // footer block
    { top: 900, bottom: 1100 }, // row inside it
  ];
  expect(pageBreaks(1300, 1000, keeps)[0]).toBe(700);
});

test("block taller than a page is allowed to split", () => {
  expect(pageBreaks(2500, 1000, [{ top: 100, bottom: 1400 }])).toEqual([1000, 2000, 2500]);
});

test("never leaves a nearly empty page", () => {
  // moving the break to 100 would leave page 1 with only 10% content
  expect(pageBreaks(1500, 1000, [{ top: 100, bottom: 1050 }])[0]).toBe(1000);
});

test("term of payment labels match CCSE quotations", () => {
  expect(defaultPrintLabel({ percent: 50, fixed_amount: null, trigger: "deposit" })).toBe(
    "50% DEPOSIT",
  );
  expect(defaultPrintLabel({ percent: 30, fixed_amount: null, trigger: "material_on_site" })).toBe(
    "30% MATERIAL ON SITE",
  );
  expect(
    defaultPrintLabel({ percent: 20, fixed_amount: null, trigger: "substantial_completion" }),
  ).toBe("20% AFTER SUBSTANTIAL COMPLETION");
  expect(defaultPrintLabel({ percent: 0, fixed_amount: 240750, trigger: "after_delivery" })).toBe(
    "240,750.00 BAHT AFTER DELIVERY",
  );
  expect(
    termPrintLabel({
      print_label: "50% DEPOSIT 1 WEEK BY T/T",
      percent: 50,
      fixed_amount: null,
      trigger: "deposit",
    }),
  ).toBe("50% DEPOSIT 1 WEEK BY T/T");
  expect(
    termPrintLabel({ print_label: "  ", percent: 50, fixed_amount: null, trigger: "deposit" }),
  ).toBe("50% DEPOSIT");
});

test("clauses print in REMARK, WARRANTY, หมายเหตุ, WARNING order", () => {
  const g = groupBySection([
    { section: "warning", sort_order: 1 },
    { section: "warranty", sort_order: 2 },
    { section: "warranty", sort_order: 1 },
    { section: "remark", sort_order: 5 },
  ]);
  expect(g.map((x) => x.value)).toEqual(["remark", "warranty", "warning"]);
  expect(g[1].rows.map((r) => r.sort_order)).toEqual([1, 2]);
});
