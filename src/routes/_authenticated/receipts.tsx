import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Td, Th } from "@/routes/_authenticated/customers";
import { useCustomerNames } from "@/hooks/useCustomerNames";
import { useMe } from "@/hooks/useMe";
import { fetchAll, matchesSearch } from "@/lib/fetchAll";
import { formatDate, formatTHB } from "@/lib/format";
import { receiptMath, receiptsCsv, registerTotals, setWhtCertificate, type ReceiptExtra, type RegisterRow } from "@/lib/receipts";
import { isMissingInDb } from "@/lib/untypedRpc";

export const Route = createFileRoute("/_authenticated/receipts")({
  head: () => ({
    meta: [
      { title: "ใบเสร็จรับเงิน | CCSE ERP" },
      { name: "description", content: "ทะเบียนใบเสร็จรับเงิน หนังสือรับรองหักภาษี ณ ที่จ่าย และเงินประกันผลงาน" },
      { property: "og:title", content: "ใบเสร็จรับเงิน | CCSE ERP" },
      { property: "og:description", content: "ทะเบียนใบเสร็จ หนังสือรับรองหักภาษี เงินประกันผลงาน" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReceiptsPage,
});

type Tab = "register" | "wht" | "retention";

function ReceiptsPage() {
  const { canViewPayments, canManagePayments } = useMe();
  const custName = useCustomerNames();
  const [tab, setTab] = useState<Tab>("register");
  const [company, setCompany] = useState<"all" | "ccse" | "one">("all");
  const [month, setMonth] = useState(""); // yyyy-mm
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [search, setSearch] = useState("");

  const { data, error, isLoading } = useQuery({
    queryKey: ["payment_receipts", "register"],
    enabled: canViewPayments,
    queryFn: async () => {
      const recs = (await fetchAll((f, t) =>
        supabase.from("payment_receipts").select("*").not("receipt_no" as never, "is", null).is("voided_at", null).order("received_date", { ascending: false }).range(f, t),
      )) as (Tables<"payment_receipts"> & ReceiptExtra)[];
      const termIds = [...new Set(recs.map((r) => r.term_id))];
      const terms = termIds.length ? await fetchAll((f, t) => supabase.from("payment_terms").select("id, seq, quotation_id").in("id", termIds).range(f, t)) : [];
      const quoteIds = [...new Set(terms.map((t) => t.quotation_id))];
      const quotes = quoteIds.length ? await fetchAll((f, t) => supabase.from("quotations").select("id, ref_no, rev, company_id, vat_percent, project_id").in("id", quoteIds).range(f, t)) : [];
      const projectIds = [...new Set(quotes.map((q) => q.project_id))];
      const projects = projectIds.length ? await fetchAll((f, t) => supabase.from("projects").select("id, code, name, customer_id").in("id", projectIds).range(f, t)) : [];
      const bills = termIds.length ? await fetchAll((f, t) => supabase.from("billing_docs").select("term_id, customer_name, vat_percent").in("term_id", termIds).is("cancelled_at", null).range(f, t)) : [];
      const { data: sched } = await supabase.rpc("payment_schedule", {});
      return { recs, terms, quotes, projects, bills, sched: sched ?? [] };
    },
  });

  const rows: RegisterRow[] = useMemo(() => {
    if (!data) return [];
    const term = new Map(data.terms.map((t) => [t.id, t]));
    const quote = new Map(data.quotes.map((q) => [q.id, q]));
    const project = new Map(data.projects.map((p) => [p.id, p]));
    const bill = new Map(data.bills.map((b) => [b.term_id, b]));
    const out = new Map(data.sched.map((s) => [s.id, Number(s.outstanding ?? 0)]));
    return data.recs.map((r) => {
      const t = term.get(r.term_id);
      const q = t ? quote.get(t.quotation_id) : undefined;
      const p = q ? project.get(q.project_id) : undefined;
      const b = bill.get(r.term_id);
      const m = receiptMath({ amount: Number(r.amount), wht: Number(r.wht_amount), retention: Number(r.retention_amount ?? 0), vatPercent: Number(b?.vat_percent ?? q?.vat_percent ?? 7) });
      return {
        id: r.id,
        receiptNo: r.receipt_no ?? "",
        date: r.received_date,
        company: (r.receipt_company_id ?? q?.company_id ?? "ccse") === "one" ? "ONE" : "CCSE",
        taxInvoiceNo: r.tax_invoice_no ?? "",
        termSeq: t?.seq ?? null,
        qc: q ? `${q.ref_no}${q.rev && q.rev !== "A" ? ` ${q.rev}` : ""}` : "",
        projectId: p?.id ?? null,
        projectCode: p?.code ?? "",
        projectName: p?.name ?? "",
        customer: b?.customer_name ?? custName(p?.customer_id) ?? "",
        ...m,
        whtCertOn: r.wht_cert_received_on ?? null,
        whtCertNo: r.wht_cert_no ?? "",
        termOutstanding: out.has(r.term_id) ? out.get(r.term_id)! : null,
      };
    });
  }, [data, custName]);

  const shown = rows
    .filter((r) => company === "all" || r.company.toLowerCase() === company)
    .filter((r) => !month || r.date.startsWith(month))
    .filter((r) => (tab === "wht" ? r.wht > 0 && (!onlyOpen || !r.whtCertOn) : tab === "retention" ? r.retention > 0 && (!onlyOpen || (r.termOutstanding ?? 0) > 0.005) : true))
    .filter((r) => matchesSearch(search, [r.receiptNo, r.taxInvoiceNo, r.qc, r.projectCode, r.projectName, r.customer]));
  const tot = registerTotals(shown);

  if (!canViewPayments) return <p className="text-sm text-muted-foreground">หน้านี้สำหรับทีมขายและทีมการเงิน</p>;

  const download = () => {
    const blob = new Blob([receiptsCsv(shown)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `receipts-${month || new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const tabBtn = (t: Tab, label: string) => (
    <Button size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>
      {label}
    </Button>
  );

  return (
    <div>
      <PageHeader
        title="ใบเสร็จรับเงิน"
        description="ทะเบียนใบเสร็จ · หนังสือรับรองหักภาษี ณ ที่จ่ายที่ยังไม่ได้รับ · เงินประกันผลงานที่ลูกค้ายังไม่คืน — ออกใบเสร็จจากแท็บงวดเงินของแต่ละงาน"
        actions={
          <Button size="sm" variant="outline" onClick={download} disabled={!shown.length}>
            ดาวน์โหลด Excel (CSV)
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {tabBtn("register", "ทะเบียนใบเสร็จ")}
        {tabBtn("wht", "หนังสือรับรองหักภาษี 3%")}
        {tabBtn("retention", "เงินประกันผลงาน")}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={company} onChange={(e) => setCompany(e.target.value as typeof company)}>
          <option value="all">ทุกบริษัท</option>
          <option value="ccse">CCSE</option>
          <option value="one">One Engineering</option>
        </select>
        <Input type="month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value)} />
        {tab !== "register" ? (
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
            {tab === "wht" ? "เฉพาะที่ยังไม่ได้รับหนังสือ" : "เฉพาะที่ลูกค้ายังไม่คืน"}
          </label>
        ) : null}
        <Input className="max-w-xs" placeholder="ค้นหา เลขที่ ใบกำกับ QC งาน ลูกค้า" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {error ? (
        <p className="rounded border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {isMissingInDb((error as Error).message) ? "ยังใช้ไม่ได้ — ต้องให้ Lovable ติดตั้ง migration 0042_receipts ก่อน" : (error as Error).message}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <Th>เลขที่</Th><Th>วันที่</Th><Th>ใบกำกับภาษี</Th><Th>งาน</Th><Th>ลูกค้า</Th>
              <th className="px-3 py-2 text-right font-medium">ก่อน VAT</th><th className="px-3 py-2 text-right font-medium">VAT</th><th className="px-3 py-2 text-right font-medium">รวม</th>
              <th className="px-3 py-2 text-right font-medium">ประกันผลงาน</th><th className="px-3 py-2 text-right font-medium">ภาษีหัก</th><th className="px-3 py-2 text-right font-medium">รับสุทธิ</th>
              <Th>{tab === "wht" ? "หนังสือรับรอง" : tab === "retention" ? "งวดยังค้าง" : ""}</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <Td className="whitespace-nowrap">
                  <a className="text-primary underline" href={`/print/receipt/${r.id}`} target="_blank" rel="noopener">{r.receiptNo}</a>
                  <div className="text-xs text-muted-foreground">{r.company}</div>
                </Td>
                <Td className="whitespace-nowrap">{formatDate(r.date)}</Td>
                <Td>{r.taxInvoiceNo || "-"}</Td>
                <Td>
                  {r.projectId ? <Link className="text-primary underline" to="/projects/$projectId" params={{ projectId: r.projectId }}>{r.projectCode || "-"}</Link> : "-"}
                  <div className="text-xs text-muted-foreground">{r.projectName} · {r.qc} · งวด {r.termSeq ?? "-"}</div>
                </Td>
                <Td>{r.customer || "-"}</Td>
                <Td className="text-right tabular-nums">{formatTHB(r.exVat)}</Td>
                <Td className="text-right tabular-nums">{formatTHB(r.vat)}</Td>
                <Td className="text-right tabular-nums">{formatTHB(r.total)}</Td>
                <Td className="text-right tabular-nums">{r.retention ? formatTHB(r.retention) : "-"}</Td>
                <Td className="text-right tabular-nums">{r.wht ? formatTHB(r.wht) : "-"}</Td>
                <Td className="text-right tabular-nums font-medium">{formatTHB(r.received)}</Td>
                <Td className="whitespace-nowrap text-xs">
                  {tab === "wht" ? <WhtCell row={r} canEdit={canManagePayments} /> : tab === "retention" ? (r.termOutstanding == null ? "-" : r.termOutstanding > 0.005 ? <span className="text-warning">ค้าง {formatTHB(r.termOutstanding)}</span> : <span className="text-success">คืนแล้ว</span>) : r.wht > 0 ? (r.whtCertOn ? <span className="text-success">ได้หนังสือแล้ว</span> : <span className="text-warning">รอหนังสือ</span>) : null}
                </Td>
              </tr>
            ))}
            {!shown.length ? (
              <tr><Td colSpan={12} className="py-6 text-center text-muted-foreground">{isLoading ? "กำลังโหลด…" : "ไม่มีรายการ"}</Td></tr>
            ) : (
              <tr className="border-t border-border font-semibold">
                <Td colSpan={5}>รวม {shown.length} ใบ</Td>
                <Td className="text-right tabular-nums">{formatTHB(tot.exVat)}</Td>
                <Td className="text-right tabular-nums">{formatTHB(tot.vat)}</Td>
                <Td className="text-right tabular-nums">{formatTHB(tot.total)}</Td>
                <Td className="text-right tabular-nums">{formatTHB(tot.retention)}</Td>
                <Td className="text-right tabular-nums">{formatTHB(tot.wht)}</Td>
                <Td className="text-right tabular-nums">{formatTHB(tot.received)}</Td>
                <Td></Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Tick off the customer's withholding tax certificate (หนังสือรับรองการหักภาษี ณ ที่จ่าย). */
function WhtCell({ row, canEdit }: { row: RegisterRow; canEdit: boolean }) {
  const qc = useQueryClient();
  const [no, setNo] = useState(row.whtCertNo);
  const save = useMutation({
    mutationFn: (on: string | null) => setWhtCertificate(row.id, on, no),
    onSuccess: () => { toast.success("บันทึกแล้ว"); qc.invalidateQueries({ queryKey: ["payment_receipts"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (row.whtCertOn)
    return (
      <span>
        <span className="text-success">ได้รับ {formatDate(row.whtCertOn)}</span>
        {row.whtCertNo ? ` · ${row.whtCertNo}` : ""}
        {canEdit ? <button className="ml-2 text-muted-foreground underline" disabled={save.isPending} onClick={() => save.mutate(null)}>ยกเลิก</button> : null}
      </span>
    );
  if (!canEdit) return <span className="text-warning">รอหนังสือ</span>;
  return (
    <span className="flex items-center gap-1">
      <Input className="h-7 w-28" placeholder="เลขที่ (ถ้ามี)" value={no} onChange={(e) => setNo(e.target.value)} />
      <Button size="sm" className="h-7" disabled={save.isPending} onClick={() => save.mutate(new Date().toISOString().slice(0, 10))}>ได้รับแล้ว</Button>
    </span>
  );
}
