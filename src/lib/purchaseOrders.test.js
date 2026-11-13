import { test, expect } from "bun:test";
import { companyKey, lineAmount, netPrice, nextPoRev, poLabel, poTotals, remainingQty } from "./purchaseOrders.ts";

test("PO money like PO-CH 26-060: 5 x 990 = 4,950 + VAT 346.50 = 5,296.50", () => {
  const lines = [{ qty: 5, unit_price: 990, discount_percent: 0 }];
  expect(poTotals(lines, 7)).toEqual({ subtotal: 4950, vat: 346.5, total: 5296.5 });
  expect(lineAmount({ qty: 3, unit_price: 100, discount_percent: 10 })).toBe(270);
  expect(netPrice({ unit_price: 100, discount_percent: 12.5 })).toBe(87.5);
  expect(poTotals([], 7)).toEqual({ subtotal: 0, vat: 0, total: 0 });
});

test("revisions and labels: 26-039 → 26-039 R.1 → R.2", () => {
  expect(nextPoRev("")).toBe("R.1");
  expect(nextPoRev("R.1")).toBe("R.2");
  expect(poLabel({ po_no: "26-039", rev: "R.1" })).toBe("26-039 R.1");
  expect(poLabel({ po_no: "26-040", rev: "" })).toBe("26-040");
});

test("what is still to come on a line", () => {
  expect(remainingQty({ qty: 10, received_qty: 4 })).toBe(6);
  expect(remainingQty({ qty: 10, received_qty: 12 })).toBe(0);
});

test("the same supplier written different ways matches", () => {
  expect(companyKey("บริษัท แสงงามกรุ๊ป (2535) จำกัด")).toBe(companyKey("บจก. แสงงามกรุ๊ป(2535)"));
  expect(companyKey("NEONEON (THAILAND) CO.,LTD.")).toBe(companyKey("Neoneon Co., Ltd"));
  expect(companyKey("หจก. อมรเคหะภัณฑ์")).toBe(companyKey("ห้างหุ้นส่วนจำกัด อมรเคหะภัณฑ์"));
  expect(companyKey("บริษัท ทรู อินโนเวชั่น เทค จำกัด")).not.toBe(companyKey("บริษัท ทรู คอร์ปอเรชั่น จำกัด"));
});
