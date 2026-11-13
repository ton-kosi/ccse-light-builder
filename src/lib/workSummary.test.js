import { test, expect } from "bun:test";
import { jobsCsv, statusTotals, summarizeJobs } from "./workSummary.ts";

const term = (p, seq, trigger, amount, outstanding, extra = {}) => ({
  project_id: p,
  project_code: p,
  project_name: `Project ${p}`,
  project_status: 6,
  quotation_id: `q${p}`,
  ref_no: `QC26-${p}`,
  rev: "A",
  seq,
  name: `งวด ${seq}`,
  trigger,
  net_total: 1000,
  amount,
  outstanding,
  received_total: amount - outstanding,
  last_received_date: outstanding < amount ? `2026-0${seq}-10` : null,
  due_status: outstanding === 0 ? "paid" : "not_yet",
  due_date: null,
  bill_date: null,
  bill_no: null,
  ...extra,
});

test("a job's paid, remaining, money status and next payment", () => {
  const jobs = summarizeJobs([
    term("69-001", 1, "deposit", 500, 0),
    term("69-001", 2, "material_on_site", 300, 300, { due_status: "billed", bill_date: "2026-11-01" }),
    term("69-001", 3, "substantial_completion", 200, 200),
    term("69-002", 1, "deposit", 500, 500),
    term("69-002", 2, "substantial_completion", 500, 500),
    term("69-003", 1, "deposit", 1000, 0),
  ]);
  const [a, b, c] = ["69-001", "69-002", "69-003"].map((code) => jobs.find((j) => j.code === code));
  expect([a.total, a.paid, a.remaining, a.jobStatus]).toEqual([1000, 500, 500, "deposit_paid"]);
  expect(a.payments).toEqual([{ seq: 1, name: "งวด 1", date: "2026-01-10", amount: 500 }]);
  expect(a.next).toEqual({ seq: 2, name: "งวด 2", dueStatus: "billed", date: "2026-11-01", amount: 300 });
  expect(b.jobStatus).toBe("waiting_deposit");
  expect(c.jobStatus).toBe("paid");
  expect(c.next).toBeNull();
  expect(statusTotals(jobs)).toEqual({
    paid: { jobs: 1, total: 1000 },
    deposit_paid: { jobs: 1, remaining: 500 },
    waiting_deposit: { jobs: 1, remaining: 1000 },
  });
});

test("no money in the quotation yet is not \"paid\"", () => {
  const [j] = summarizeJobs([term("69-005", 1, "deposit", 0, 0)]);
  expect(j.jobStatus).toBe("no_amount");
  expect(statusTotals([j]).paid.jobs).toBe(0);
});

test("part of a payment received counts as paid so far", () => {
  const [j] = summarizeJobs([term("69-004", 1, "deposit", 500, 200), term("69-004", 2, "progress", 500, 500)]);
  expect([j.paid, j.remaining, j.jobStatus]).toEqual([300, 700, "waiting_deposit"]);
  expect(j.payments[0].amount).toBe(300);
});

test("CSV opens in Excel with Thai and a column per payment", () => {
  const jobs = summarizeJobs([term("69-001", 1, "deposit", 500, 0), term("69-001", 2, "progress", 500, 0)]).map((j) => ({
    ...j,
    client: 'บริษัท "ก" จำกัด',
    company: "CCSE",
    designer: "",
  }));
  const csv = jobsCsv(jobs);
  expect(csv.startsWith("﻿")).toBe(true);
  const [head, row] = csv.slice(1).split("\r\n");
  expect(head).toContain("Date2,Payment 2");
  expect(row).toContain('"บริษัท ""ก"" จำกัด"');
  expect(row).toContain("จ่ายครบ 100%");
});
