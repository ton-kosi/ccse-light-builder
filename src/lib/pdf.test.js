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

test("clauses come from components and from the SKUs a line uses", async () => {
  const { neededClauseIds } = await import("./clauses.ts");
  const need = neededClauseIds({
    lines: [
      { id: "fo", component_id: null, option_name: "OPTION 1", kind: "priced" },
      { id: "fo2", component_id: null, option_name: "OPTION 2", kind: "priced" },
      { id: "led", component_id: "LEDCOMP", option_name: null, kind: "priced" },
      { id: "h", component_id: "HEAD", option_name: null, kind: "heading" },
    ],
    selectedOption: "OPTION 1",
    lineRecipes: [
      { quote_line_id: "fo", sku_id: "FO50W" },
      { quote_line_id: "fo2", sku_id: "FO100W" },
    ],
    recipes: [
      { component_id: "P-FO50W", sku_id: "FO50W" },
      { component_id: "P-FO100W", sku_id: "FO100W" },
      { component_id: "LEDCOMP", sku_id: "NICHIA" },
      { component_id: "LEDCOMP", sku_id: "ALU" },
      { component_id: "P-NICHIA", sku_id: "NICHIA" },
    ],
    componentClauses: [
      { component_id: "P-FO50W", clause_id: "fo-warranty" },
      { component_id: "P-FO100W", clause_id: "fo100-only" },
      { component_id: "P-NICHIA", clause_id: "nichia-2y" },
      { component_id: "LEDCOMP", clause_id: "led-note" },
      { component_id: "HEAD", clause_id: "heading-only" },
      { component_id: "P-FO50W", clause_id: "inactive" },
    ],
    clauses: [
      { id: "fo-warranty", active: true, always_include: false },
      { id: "fo100-only", active: true, always_include: false },
      { id: "nichia-2y", active: true, always_include: false },
      { id: "led-note", active: true, always_include: false },
      { id: "heading-only", active: true, always_include: false },
      { id: "inactive", active: false, always_include: false },
      { id: "always", active: true, always_include: true },
    ],
  });
  expect([...need].sort()).toEqual(["always", "fo-warranty", "led-note", "nichia-2y"]);
});
