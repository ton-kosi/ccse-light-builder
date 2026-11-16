import { test, expect } from "bun:test";
import { receiptMath, retentionFor } from "./receipts.ts";

test("CCSE receipt 69-11001: 116,384.50 + VAT 8,146.92 = 124,531.42, retention 5 % 5,819.23 → 118,712.19", () => {
  const retention = retentionFor(118712.19, 5, 7);
  expect(retention).toBe(5819.23);
  const m = receiptMath({ amount: 118712.19, wht: 0, retention, vatPercent: 7 });
  expect(m).toEqual({ exVat: 116384.5, vat: 8146.92, total: 124531.42, retention: 5819.23, afterRetention: 118712.19, wht: 0, received: 118712.19 });
});

test("ONE 69-11003: total 1,348,949.86 with 3 % WHT 37,821.02 → 1,311,128.84 received", () => {
  const m = receiptMath({ amount: 1311128.84, wht: 37821.02, retention: 0, vatPercent: 7 });
  expect(m.total).toBe(1348949.86);
  expect(m.exVat).toBe(1260700.8);
  expect(m.vat).toBe(88249.06);
});

test("no VAT, no retention", () => {
  expect(receiptMath({ amount: 1000, wht: 0, retention: 0, vatPercent: 0 })).toMatchObject({ exVat: 1000, vat: 0, total: 1000 });
  expect(retentionFor(1000, 0, 7)).toBe(0);
});

test("register totals and CSV", async () => {
  const { registerTotals, receiptsCsv } = await import("./receipts.ts");
  const row = { id: "1", receiptNo: "69-11001", date: "2026-11-05", company: "CCSE", taxInvoiceNo: "69-11004", termSeq: 2, qc: "QC26-11-05-001", projectId: null, projectCode: "69-001", projectName: "บ้าน, ชั้น 2", customer: "ลูกค้า", exVat: 100, vat: 7, total: 107, retention: 5.35, wht: 3, received: 98.65, whtCertOn: null, whtCertNo: "" };
  expect(registerTotals([row, row])).toEqual({ exVat: 200, vat: 14, total: 214, retention: 10.7, wht: 6, received: 197.3 });
  const csv = receiptsCsv([row]);
  expect(csv.startsWith("\uFEFFเลขที่,")).toBe(true);
  expect(csv).toContain('69-11001,2026-11-05,CCSE,69-11004,2,QC26-11-05-001,69-001,"บ้าน, ชั้น 2"');
});
