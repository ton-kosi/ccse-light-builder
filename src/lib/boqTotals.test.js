import { test, expect } from "bun:test";
import { adjustmentsOf, chain, computeTotals, summaryRows, vatModeOf } from "./boq.ts";

const kansi = [
  { label: "COORDINATION WORK & EXPENSES", type: "percent", value: 3 },
  { label: "OVERHEAD & PROFIT 12%", type: "percent", value: 12 },
  { label: "UNFORSEEN 8%", type: "percent", value: 8 },
];
const r2 = (x) => Math.round(x * 100) / 100;

test("KANSI electrical: percentages compound on the running total", () => {
  const t = chain(6066226, 0, 7, kansi);
  expect(t.adjusted.map((a) => r2(a.amount))).toEqual([181986.78, 749785.53, 559839.87]);
  expect(r2(t.beforeVat)).toBe(7557838.18);
  expect(r2(t.vat)).toBe(529048.67);
  expect(r2(t.net)).toBe(8086886.85);
  const rows = summaryRows(6066226, {
    discount: 0,
    vatPercent: 7,
    vatMode: "show",
    adjustments: kansi,
  });
  expect(rows.map((r) => r.label)).toEqual([
    "TOTAL I",
    "COORDINATION WORK & EXPENSES",
    "OVERHEAD & PROFIT 12%",
    "UNFORSEEN 8%",
    "TOTAL II",
    "VAT 7%",
    "GRAND TOTAL (THB)",
  ]);
});

test("note lines and fixed amounts", () => {
  const t = chain(1000, 100, 7, [
    { label: "COORDINATION", type: "note", value: 0, text: "ELECTRIC FEE BY BUYER" },
    { label: "INSURANCE", type: "amount", value: 100 },
  ]);
  expect(t.adjusted.map((a) => a.amount)).toEqual([null, 100]);
  expect(t.beforeVat).toBe(1000);
});

test("KANSI material: total excluding VAT, no VAT lines", () => {
  const rows = summaryRows(11711136, { discount: 0, vatPercent: 7, vatMode: "excluded" });
  expect(rows).toEqual([
    { label: "GRAND TOTAL (THB)", value: 11711136, bold: true },
    { label: "(EXCLUDING VAT 7%)", value: "", italic: true },
  ]);
  expect(
    summaryRows(500, { discount: 0, vatPercent: 7, vatMode: "none" }).map((r) => r.label),
  ).toEqual(["GRAND TOTAL (THB)"]);
  // money for payments still includes VAT
  expect(
    computeTotals(
      [{ kind: "priced", qty: 1, unit_price: 100, discount_percent: 0, option_name: null }],
      0,
      7,
      null,
    ).net,
  ).toBeCloseTo(107);
});

test("parsing stored settings", () => {
  expect(vatModeOf(undefined)).toBe("show");
  expect(adjustmentsOf([{ label: "OH", type: "x", value: "12" }])).toEqual([
    { label: "OH", type: "percent", value: 12 },
  ]);
  expect(adjustmentsOf(null)).toEqual([]);
});
