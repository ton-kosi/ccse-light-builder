import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DueBadge } from "@/components/payments/PaymentTermsSection";
import { Td, Th } from "@/routes/_authenticated/customers";
import { useCustomerNames } from "@/hooks/useCustomerNames";
import { useMe } from "@/hooks/useMe";
import { fetchAll, matchesSearch } from "@/lib/fetchAll";
import { formatDate, formatTHB } from "@/lib/format";
import { JOB_STATUS_LABEL, jobsCsv, statusTotals, summarizeJobs, type JobStatus, type ScheduleRow } from "@/lib/workSummary";

export const Route = createFileRoute("/_authenticated/work-summary")({
  head: () => ({
    meta: [
      { title: "สรุปงาน | CCSE ERP" },
      { name: "description", content: "สรุปทุกงาน: ยอดสัญญา จ่ายแล้ว คงเหลือ สถานะ และงวดถัดไป" },
      { property: "og:title", content: "สรุปงาน | CCSE ERP" },
      { property: "og:description", content: "สรุปทุกงานของ CCSE และ One Engineering" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WorkSummaryPage,
});

const STATUS_CLS: Record<JobStatus, string> = {
  paid: "bg-success/15 text-success",
  deposit_paid: "bg-primary/10 text-primary",
  waiting_deposit: "bg-warning/20 text-warning",
  no_amount: "bg-muted text-muted-foreground",
};

function WorkSummaryPage() {
  const { canViewPayments } = useMe();
  const custName = useCustomerNames();
  const [company, setCompany] = useState<"all" | "ccse" | "one">("all");
  const [status, setStatus] = useState<"open" | "all" | JobStatus>("open");
  const [search, setSearch] = useState("");

  const { data: schedule, isLoading } = useQuery({
    queryKey: ["payment_schedule", "all", "work-summary"],
    enabled: canViewPayments,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("payment_schedule", {});
      if (error) throw error;
      return (data ?? []) as unknown as ScheduleRow[];
    },
  });
  const jobs = useMemo(() => summarizeJobs(schedule ?? []), [schedule]);
  const projectIds = jobs.map((j) => j.projectId);
  const quotationIds = jobs.map((j) => j.quotationId);
  const { data: extra } = useQuery({
    queryKey: ["work-summary-extra", projectIds.join(",")],
    enabled: projectIds.length > 0,
    queryFn: async () => {
      const [projects, quotes] = await Promise.all([
        fetchAll((f, t) => supabase.from("projects").select("*").in("id", projectIds).range(f, t)),
        fetchAll((f, t) => supabase.from("quotations").select("id, company_id").in("id", quotationIds).range(f, t)),
      ]);
      return {
        project: new Map(projects.map((p) => [p.id, p as typeof p & { designer?: string | null }])),
        company: new Map(quotes.map((q) => [q.id, q.company_id as string])),
      };
    },
  });

  const rows = jobs
    .map((j) => {
      const p = extra?.project.get(j.projectId);
      return {
        ...j,
        client: custName(p?.customer_id) ?? "",
        company: extra?.company.get(j.quotationId) ?? "ccse",
        designer: p?.designer ?? "",
      };
    })
    .filter((j) => company === "all" || j.company === company)
    .filter((j) => (status === "all" ? true : status === "open" ? j.jobStatus !== "paid" : j.jobStatus === status))
    .filter((j) => matchesSearch(search, [j.code, j.ref, j.name, j.client, j.designer]));
  const allForCompany = jobs.filter((j) => company === "all" || (extra?.company.get(j.quotationId) ?? "ccse") === company);
  const head = statusTotals(allForCompany);

  if (!canViewPayments) return <p className="text-sm text-muted-foreground">หน้านี้สำหรับทีมขายและทีมการเงิน</p>;

  const download = () => {
    const blob = new Blob([jobsCsv(rows.map((r) => ({ ...r, company: r.company === "one" ? "ONE" : "CCSE" })))], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `work-summary-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <PageHeader
        title="สรุปงาน"
        description="ทุกงานที่มีงวดเงิน: ยอดสัญญา (ก่อน VAT) จ่ายแล้ว คงเหลือ สถานะ และงวดถัดไป — จากใบเสนอราคาปัจจุบันของแต่ละงาน"
        actions={
          <Button size="sm" variant="outline" onClick={download} disabled={!rows.length}>
            ดาวน์โหลด Excel (CSV)
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card label="จ่ายครบ 100%" sub={`${head.paid.jobs} งาน`} value={formatTHB(head.paid.total)} hint="ยอดสัญญารวม" />
        <Card label="มัดจำแล้ว" sub={`${head.deposit_paid.jobs} งาน`} value={formatTHB(head.deposit_paid.remaining)} hint="ยังค้างรับ" />
        <Card label="รอมัดจำ" sub={`${head.waiting_deposit.jobs} งาน`} value={formatTHB(head.waiting_deposit.remaining)} hint="ยังค้างรับ" />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={company} onChange={(e) => setCompany(e.target.value as typeof company)}>
          <option value="all">ทุกบริษัท</option>
          <option value="ccse">CCSE</option>
          <option value="one">One Engineering</option>
        </select>
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="open">ยังรับไม่ครบ</option>
          <option value="waiting_deposit">รอมัดจำ</option>
          <option value="deposit_paid">มัดจำแล้ว</option>
          <option value="paid">จ่ายครบ 100%</option>
          <option value="no_amount">ยังไม่มียอด</option>
          <option value="all">ทั้งหมด</option>
        </select>
        <Input className="max-w-xs" placeholder="ค้นหา เลขงาน QC ชื่องาน ลูกค้า" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="text-xs text-muted-foreground">{rows.length} งาน</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <Th>Run no.</Th>
              <Th>QC / QO</Th>
              <Th>งาน / ลูกค้า</Th>
              <Th>ยอดสัญญา</Th>
              <Th>จ่ายแล้ว</Th>
              <Th>คงเหลือ</Th>
              <Th>สถานะ</Th>
              <Th>งวดที่รับแล้ว</Th>
              <Th>งวดถัดไป</Th>
              <Th>ผู้ออกแบบ</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <Td colSpan={10}>กำลังโหลด…</Td>
              </tr>
            ) : rows.length ? (
              rows.map((j) => (
                <tr key={j.projectId} className="border-t border-border align-top">
                  <Td className="whitespace-nowrap font-medium">
                    <Link to="/projects/$projectId" params={{ projectId: j.projectId }} className="text-primary hover:underline">
                      {j.code}
                    </Link>
                    <div className="text-xs text-muted-foreground">{j.company === "one" ? "ONE" : "CCSE"}</div>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {j.ref}
                    {j.rev && j.rev !== "A" ? <span className="text-muted-foreground"> {j.rev}</span> : null}
                  </Td>
                  <Td>
                    <div>{j.name}</div>
                    <div className="text-xs text-muted-foreground">{j.client || "-"}</div>
                  </Td>
                  <Td className="text-right tabular-nums">{formatTHB(j.total)}</Td>
                  <Td className="text-right tabular-nums">{formatTHB(j.paid)}</Td>
                  <Td className="text-right font-medium tabular-nums">{formatTHB(j.remaining)}</Td>
                  <Td className="whitespace-nowrap">
                    <span className={"rounded px-1.5 py-0.5 text-xs " + STATUS_CLS[j.jobStatus]}>{JOB_STATUS_LABEL[j.jobStatus]}</span>
                  </Td>
                  <Td className="text-xs">
                    {j.payments.length
                      ? j.payments.map((p) => (
                          <div key={p.seq} className="whitespace-nowrap">
                            {p.seq}. {p.date ? formatDate(p.date) : "-"} · {formatTHB(p.amount)}
                          </div>
                        ))
                      : "-"}
                  </Td>
                  <Td className="text-xs">
                    {j.next ? (
                      <div className="space-y-0.5">
                        <div>
                          {j.next.seq}. {j.next.name} · {formatTHB(j.next.amount)}
                        </div>
                        <div className="flex items-center gap-1">
                          <DueBadge s={j.next.dueStatus} />
                          {j.next.date ? <span>{formatDate(j.next.date)}</span> : null}
                        </div>
                      </div>
                    ) : (
                      "-"
                    )}
                  </Td>
                  <Td className="text-xs">{j.designer || "-"}</Td>
                </tr>
              ))
            ) : (
              <tr>
                <Td colSpan={10}>ไม่มีงานที่ตรงกับตัวกรอง</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        แสดงเฉพาะงานที่ตั้งงวดเงินในใบเสนอราคาแล้ว · ยอดจ่ายแล้วนับจากเงินที่บันทึกรับในแท็บ งวดเงิน (รวมภาษีหัก ณ ที่จ่าย)
      </p>
    </div>
  );
}

function Card({ label, sub, value, hint }: { label: string; sub: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{sub}</span>
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}
