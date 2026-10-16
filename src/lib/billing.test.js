import { test, expect } from "bun:test";
import { billMoney, longDate, summaryOfPayment } from "./billing.ts";

const doc = (id, created_at, o = {}) => ({
  id, created_at, cancelled_at: null, description: `PAYMENT ${id}`, term_seq: 1,
  amount: 42500, request_amount: 42500, deduct_amount: 0, vat_percent: 7, vat_amount: 2975, grand_total: 45475,
  wht_percent: 0, wht_amount: 0, net_payment: 45475, ...o,
});

test("ONE BANGKOK payment 2: earlier bills listed, deduct of deposit, accumulated total", () => {
  const p1 = doc("1", "2026-08-01T00:00:00Z");
  const p2 = doc("2", "2026-08-31T00:00:00Z", { request_amount: 85000, deduct_amount: 42500 });
  const cancelled = doc("x", "2026-08-10T00:00:00Z", { cancelled_at: "2026-08-11" });
  const later = doc("3", "2026-09-30T00:00:00Z");
  const s = summaryOfPayment(p2, [later, p2, cancelled, p1]);
  expect(s.lines.map((l) => [l.item, l.request, l.deduct, l.payable, l.current])).toEqual([
    [1, 42500, 0, 42500, false],
    [2, 85000, 42500, 42500, true],
  ]);
  expect(s.accumulated).toBe(85000);
  expect(billMoney(p2).pay).toBe(45475);
});

test("ANANTARA deposit with withholding tax 3%", () => {
  const d = doc("1", "2026-07-16T00:00:00Z", {
    amount: 118500, request_amount: 118500, vat_amount: 8295, grand_total: 126795, wht_percent: 3, wht_amount: 3555, net_payment: 123240,
  });
  expect(billMoney(d)).toEqual({ total: 118500, vatPercent: 7, vat: 8295, grand: 126795, whtPercent: 3, wht: 3555, pay: 123240 });
});

test("bills issued before the new columns still print", () => {
  const old = doc("1", "2026-07-01T00:00:00Z", { request_amount: null, deduct_amount: null, wht_percent: null, wht_amount: null, net_payment: null });
  expect(summaryOfPayment(old, [old]).lines[0].request).toBe(42500);
  expect(billMoney(old).pay).toBe(45475);
  expect(longDate("2026-07-16")).toBe("16 July 2026");
});
