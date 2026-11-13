/**
 * Work summary (Work_Request summary.xlsm "Sum CCSE / Sum ONE"): one row per job with the contract
 * total, what has been paid, what is left, the job's money status, every payment and the next one.
 * Built from the payment schedule the app already keeps (current quotation of each project).
 */
export type ScheduleRow = {
  project_id: string;
  project_code: string;
  project_name: string;
  project_status: number;
  quotation_id: string;
  ref_no: string;
  rev: string;
  seq: number;
  name: string;
  trigger: string | null;
  net_total: number | string;
  amount: number | string;
  outstanding: number | string;
  received_total: number | string;
  last_received_date: string | null;
  due_status: string;
  due_date: string | null;
  bill_date: string | null;
  bill_no: string | null;
};

export type JobStatus = "paid" | "deposit_paid" | "waiting_deposit" | "no_amount";
export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  paid: "จ่ายครบ 100%",
  deposit_paid: "มัดจำแล้ว",
  waiting_deposit: "รอมัดจำ",
  no_amount: "ยังไม่มียอด",
};

export type JobSummary = {
  projectId: string;
  code: string;
  name: string;
  status: number;
  quotationId: string;
  ref: string;
  rev: string;
  total: number;
  paid: number;
  remaining: number;
  jobStatus: JobStatus;
  payments: { seq: number; name: string; date: string | null; amount: number }[];
  next: { seq: number; name: string; dueStatus: string; date: string | null; amount: number } | null;
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const num = (x: number | string | null | undefined) => Number(x ?? 0) || 0;

export function summarizeJobs(rows: ScheduleRow[]): JobSummary[] {
  const byProject = new Map<string, ScheduleRow[]>();
  for (const r of rows) byProject.set(r.project_id, [...(byProject.get(r.project_id) ?? []), r]);
  const out: JobSummary[] = [];
  for (const [projectId, terms] of byProject) {
    const t = [...terms].sort((a, b) => a.seq - b.seq);
    const first = t[0]!;
    const amount = t.reduce((s, x) => s + num(x.amount), 0);
    const remaining = r2(t.reduce((s, x) => s + num(x.outstanding), 0));
    const paidOf = (x: ScheduleRow) => r2(num(x.amount) - num(x.outstanding));
    const deposits = t.filter((x) => x.trigger === "deposit");
    const depositTerms = deposits.length ? deposits : [first];
    // a quotation with no money in it yet (prices not set) is not "paid"
    const jobStatus: JobStatus =
      amount <= 0.005
        ? "no_amount"
        : remaining <= 0.005 ? "paid" : depositTerms.every((x) => num(x.outstanding) <= 0.005) ? "deposit_paid" : "waiting_deposit";
    const open = t.find((x) => num(x.outstanding) > 0.005) ?? null;
    out.push({
      projectId,
      code: first.project_code,
      name: first.project_name,
      status: first.project_status,
      quotationId: first.quotation_id,
      ref: first.ref_no,
      rev: first.rev,
      total: r2(num(first.net_total) || amount),
      paid: r2(amount - remaining),
      remaining,
      jobStatus,
      payments: t.filter((x) => paidOf(x) > 0.005).map((x) => ({ seq: x.seq, name: x.name, date: x.last_received_date, amount: paidOf(x) })),
      next: open
        ? { seq: open.seq, name: open.name, dueStatus: open.due_status, date: open.due_date ?? open.bill_date, amount: r2(num(open.outstanding)) }
        : null,
    });
  }
  return out.sort((a, b) => b.code.localeCompare(a.code));
}

/** Totals per money status, like the header of the Excel summary. */
export function statusTotals(jobs: JobSummary[]) {
  const t = { paid: { jobs: 0, total: 0 }, deposit_paid: { jobs: 0, remaining: 0 }, waiting_deposit: { jobs: 0, remaining: 0 } };
  for (const j of jobs) {
    if (j.jobStatus === "paid") {
      t.paid.jobs++;
      t.paid.total = r2(t.paid.total + j.total);
    } else if (j.jobStatus !== "no_amount") {
      t[j.jobStatus].jobs++;
      t[j.jobStatus].remaining = r2(t[j.jobStatus].remaining + j.remaining);
    }
  }
  return t;
}

/** CSV for Excel (UTF-8 with BOM so Thai opens correctly). */
export function jobsCsv(jobs: (JobSummary & { client: string; company: string; designer: string })[]) {
  const maxPay = Math.max(0, ...jobs.map((j) => j.payments.length));
  const head = ["Run no.", "QC/QO", "Project", "Client", "Company", "Total (before VAT)", "Paid", "Remaining", "Status"];
  for (let i = 1; i <= maxPay; i++) head.push(`Date${i}`, `Payment ${i}`);
  head.push("Next payment", "Next date", "Designer");
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = jobs.map((j) => {
    const cells: (string | number | null)[] = [
      j.code,
      `${j.ref}${j.rev && j.rev !== "A" ? ` ${j.rev}` : ""}`,
      j.name,
      j.client,
      j.company,
      j.total,
      j.paid,
      j.remaining,
      JOB_STATUS_LABEL[j.jobStatus],
    ];
    for (let i = 0; i < maxPay; i++) cells.push(j.payments[i]?.date ?? "", j.payments[i]?.amount ?? "");
    cells.push(j.next ? `${j.next.seq}. ${j.next.name}` : "", j.next?.date ?? "", j.designer);
    return cells.map(esc).join(",");
  });
  return "﻿" + [head.map(esc).join(","), ...lines].join("\r\n");
}
