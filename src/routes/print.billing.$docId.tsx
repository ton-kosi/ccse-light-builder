import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DocHeader } from "@/components/print/DocHeader";
import { buildA4Pdf } from "@/lib/pdf";
import { bahtText } from "@/lib/bahtText";
import { quotationRevisionSuffix } from "@/lib/boq";
import { formatDate, formatQty, formatTHB } from "@/lib/format";

export const Route = createFileRoute("/print/billing/$docId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ใบเบิกเงิน / ใบแจ้งหนี้ | CCSE ERP" },
      { name: "description", content: "ใบเบิกเงินสำหรับลูกค้า รูปแบบ A4 พร้อมพิมพ์/บันทึก PDF" },
      { property: "og:title", content: "ใบเบิกเงิน / ใบแจ้งหนี้ | CCSE ERP" },
      { property: "og:description", content: "ใบเบิกเงินสำหรับลูกค้า รูปแบบ A4" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrintBilling,
});

function PrintBilling() {
  const { docId } = Route.useParams();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["print_billing", docId],
    queryFn: async () => {
      const [{ data: d, error }, { data: s }] = await Promise.all([
        supabase.from("billing_docs").select("*").eq("id", docId).maybeSingle(),
        supabase.from("settings").select("bank_name, bank_branch, bank_account_name, bank_account_no").maybeSingle(),
      ]);
      if (error) throw error;
      return d ? { d, s } : null;
    },
  });

  // First open after issuing: store the PDF with the project (once).
  const saving = useRef(false);
  useEffect(() => {
    if (!data || data.d.pdf_path || data.d.cancelled_at || saving.current) return;
    saving.current = true;
    (async () => {
      await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 300));
      const el = document.querySelector(".bill-print") as HTMLElement | null;
      if (!el) return;
      const blob = (await buildA4Pdf(el)).output("blob");
      const path = `billing/${data.d.project_id}/${data.d.doc_no}.pdf`;
      const { error: upErr } = await supabase.storage.from("payment-slips").upload(path, blob, { contentType: "application/pdf", upsert: true });
      if (upErr) { toast.error(upErr.message); return; }
      const { error } = await supabase.from("billing_docs").update({ pdf_path: path }).eq("id", data.d.id);
      if (error) { toast.error(error.message); return; }
      toast.success(`บันทึก PDF ${data.d.doc_no} ไว้กับโปรเจกต์แล้ว`);
      qc.invalidateQueries({ queryKey: ["print_billing", docId] });
    })().catch((e: Error) => toast.error(e.message));
  }, [data, docId, qc]);

  if (isLoading) return <p className="p-8 text-sm">กำลังโหลด...</p>;
  if (!data) return <p className="p-8 text-sm">ไม่พบใบเบิกเงิน หรือคุณไม่มีสิทธิ์ดู</p>;
  const { d, s } = data;
  const bank = [s?.bank_name, s?.bank_branch ? `สาขา ${s.bank_branch}` : null].filter(Boolean).join(" ");

  return (
    <div className="bill-print mx-auto max-w-[210mm] bg-background p-[12mm] text-[12px] leading-snug text-foreground">
      <style>{`@page { size: A4; margin: 12mm; } @media print { .bill-print { padding: 0 !important; max-width: none !important; } .no-print { display: none !important; } }`}</style>
      <div className="no-print mb-4 flex justify-end gap-2">
        <Button variant="outline" onClick={() => window.print()}>พิมพ์</Button>
        <Button onClick={async () => {
          const el = document.querySelector(".bill-print") as HTMLElement | null;
          if (el) (await buildA4Pdf(el)).save(`${d.doc_no}.pdf`);
        }}>บันทึก PDF</Button>
      </div>
      {d.cancelled_at ? (
        <div className="mb-3 rounded border-2 border-destructive p-2 text-center font-bold text-destructive">
          ยกเลิกแล้ว ({formatDate(d.cancelled_at)}) — {d.cancel_reason}
        </div>
      ) : null}

      <DocHeader title="INVOICE" subtitle="ใบเบิกเงิน / ใบแจ้งหนี้" />

      <section className="mt-3 grid grid-cols-2 gap-4">
        <div className="space-y-0.5">
          <Info label="TO">{d.customer_name ?? "-"}</Info>
          {d.customer_address ? <Info label="">{d.customer_address}</Info> : null}
          <Info label="ATTN">{d.attn ?? "-"}</Info>
          <Info label="PROJECT">{d.project_name ?? "-"}</Info>
        </div>
        <div className="space-y-0.5">
          <Info label="NO.">{d.doc_no}</Info>
          <Info label="DATE">{formatDate(d.bill_date)}</Info>
          <Info label="QUOTATION">{d.quotation_ref}{quotationRevisionSuffix(d.quotation_rev ?? "")}</Info>
          <Info label="PO NO.">{d.po_number ?? "-"}</Info>
          <Info label="DUE DATE">{formatDate(d.due_date)}</Info>
        </div>
      </section>

      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-y-2 border-foreground text-[11px]">
            <th className="w-10 py-1 text-left">ITEM</th>
            <th className="py-1 text-left">DESCRIPTION</th>
            <th className="w-32 py-1 text-right">AMOUNT (THB)</th>
          </tr>
        </thead>
        <tbody>
          <tr className="align-top">
            <td className="py-2">1</td>
            <td className="py-2">{d.description}</td>
            <td className="py-2 text-right tabular-nums">{formatTHB(Number(d.amount))}</td>
          </tr>
        </tbody>
      </table>

      <section className="mt-3 flex items-start justify-between gap-6 border-t-2 border-foreground pt-2">
        <div className="flex-1 rounded border border-foreground px-2 py-1 font-semibold">
          ({bahtText(Number(d.grand_total))})
        </div>
        <div className="w-72 space-y-0.5">
          <Sum label="AMOUNT" value={formatTHB(Number(d.amount))} />
          <Sum label={`VAT ${formatQty(Number(d.vat_percent))}%`} value={formatTHB(Number(d.vat_amount))} />
          <Sum label="GRAND TOTAL (THB)" value={formatTHB(Number(d.grand_total))} bold />
        </div>
      </section>

      <section className="mt-6 space-y-2">
        <div>
          <span className="font-bold">PAYMENT TERMS: </span>
          เครดิต {d.credit_days} วัน · ครบกำหนดชำระ {formatDate(d.due_date)}
        </div>
        <div>
          <div className="font-bold">กรุณาชำระเงินเข้าบัญชี</div>
          {s?.bank_account_no ? (
            <div>
              {bank} · ชื่อบัญชี {s.bank_account_name ?? "-"} · เลขที่บัญชี {s.bank_account_no}
            </div>
          ) : (
            <div className="no-print text-destructive">ยังไม่ได้ตั้งค่าบัญชีธนาคาร (ตั้งค่า → บัญชีธนาคารสำหรับรับเงิน)</div>
          )}
        </div>
      </section>

      <section className="mt-16 grid grid-cols-2 gap-12 text-center text-[11px]">
        <div className="border-t border-foreground pt-1">RECEIVED BY (CUSTOMER)</div>
        <div className="border-t border-foreground pt-1">APPROVED BY · CCSE</div>
      </section>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 font-semibold">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function Sum({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={"flex justify-between " + (bold ? "border-t border-foreground pt-1 font-bold" : "")}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
