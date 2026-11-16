import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DocFooter, DocHeader } from "@/components/print/DocHeader";
import { branchText, companyOf, useCompanies } from "@/lib/companies";
import { bahtText } from "@/lib/bahtText";
import { formatDate, formatTHB } from "@/lib/format";
import { buildA4Pdf } from "@/lib/pdf";
import { methodLabel } from "@/lib/payments";
import { receiptMath, type ReceiptExtra } from "@/lib/receipts";

export const Route = createFileRoute("/print/receipt/$receiptId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "RECEIPT | CCSE ERP" },
      { name: "description", content: "ใบเสร็จรับเงิน รูปแบบ A4" },
      { property: "og:title", content: "RECEIPT | CCSE ERP" },
      { property: "og:description", content: "ใบเสร็จรับเงิน A4" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrintReceipt,
});

/** Everything printed on a receipt, read from the payment, its term, quotation, project, customer and bill. */
export async function loadReceipt(receiptId: string) {
  const { data: r, error } = await supabase.from("payment_receipts").select("*").eq("id", receiptId).single();
  if (error) throw new Error(error.message);
  const rec = r as typeof r & ReceiptExtra;
  const { data: term } = await supabase.from("payment_terms").select("*").eq("id", rec.term_id).single();
  const { data: quote } = term ? await supabase.from("quotations").select("*").eq("id", term.quotation_id).single() : { data: null };
  const { data: project } = quote ? await supabase.from("projects").select("*").eq("id", quote.project_id).single() : { data: null };
  const { data: customer } = project?.customer_id ? await supabase.from("customers").select("*").eq("id", project.customer_id).single() : { data: null };
  const { data: bills } = await supabase.from("billing_docs").select("*").eq("term_id", rec.term_id).is("cancelled_at", null).order("bill_date", { ascending: false }).limit(1);
  return { rec, term, quote, project, customer, bill: bills?.[0] ?? null };
}

function PrintReceipt() {
  const { receiptId } = Route.useParams();
  const companies = useCompanies();
  const [copy, setCopy] = useState(false);
  const { data, error } = useQuery({ queryKey: ["receipt_print", receiptId], queryFn: () => loadReceipt(receiptId) });
  if (error) return <p className="p-6 text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return <p className="p-6 text-sm text-muted-foreground">กำลังโหลด…</p>;
  const { rec, term, quote, project, customer, bill } = data;
  if (!rec.receipt_no) return <p className="p-6 text-sm text-destructive">รายการรับเงินนี้ยังไม่ได้ออกใบเสร็จ — กด "ออกใบเสร็จ" ในแท็บงวดเงินก่อน</p>;
  const co = companyOf(companies, rec.receipt_company_id ?? quote?.company_id);
  const vatPercent = Number(bill?.vat_percent ?? quote?.vat_percent ?? 7);
  const m = receiptMath({ amount: Number(rec.amount), wht: Number(rec.wht_amount), retention: Number(rec.retention_amount ?? 0), vatPercent });
  const name = bill?.customer_name ?? customer?.name ?? "";
  const address = bill?.customer_address ?? customer?.address ?? "";
  const taxId = bill?.customer_tax_id ?? customer?.tax_id ?? "";
  const branch = branchText(bill?.customer_branch ?? customer?.branch);
  const ref = quote ? `${quote.ref_no}${quote.rev && quote.rev !== "A" ? ` ${quote.rev}` : ""}` : "";
  const row = (label: string, en: string, v: number, bold = false) => (
    <div className={"flex justify-between px-2 py-1 " + (bold ? "border-t border-foreground font-bold" : "")}>
      <span>
        {label} <span className="text-[9px]">{en}</span>
      </span>
      <span className="tabular-nums">{formatTHB(v)}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-muted print:bg-background">
      <style>{`@page { size: A4; margin: 10mm; } @media print { .rc-print { padding: 0 !important; max-width: none !important; box-shadow: none !important; } }`}</style>
      <div className="mx-auto flex max-w-[210mm] justify-end gap-2 py-3 print:hidden">
        <Button variant={copy ? "outline" : "default"} onClick={() => setCopy(false)}>ต้นฉบับ</Button>
        <Button variant={copy ? "default" : "outline"} onClick={() => setCopy(true)}>สำเนา</Button>
        <Button variant="outline" onClick={() => window.print()}>พิมพ์</Button>
        <Button
          onClick={async () => {
            const el = document.querySelector(".rc-print") as HTMLElement | null;
            if (el) (await buildA4Pdf(el)).save(`ใบเสร็จ ${rec.receipt_no}${copy ? " สำเนา" : ""}.pdf`);
          }}
        >
          บันทึก PDF
        </Button>
      </div>
      <div className="rc-print mx-auto max-w-[210mm] bg-background p-[10mm] text-[11px] leading-snug text-foreground shadow">
        <DocHeader company={co} />
        <div className="mt-2 flex items-start justify-between">
          <div>
            <div className="text-[12px] font-semibold">{copy ? "สำเนา" : "ต้นฉบับ"}</div>
            <div className="text-[18px] font-bold">ใบเสร็จรับเงิน</div>
            <div className="text-[13px] font-semibold tracking-wide">RECEIPT</div>
          </div>
          <div className="grid grid-cols-[30mm_1fr] gap-y-0.5 text-right">
            <span className="text-left">เลขที่ / No.</span>
            <b className="text-[13px]">{rec.receipt_no}</b>
            <span className="text-left">วันที่ / Date</span>
            <span>{formatDate(rec.received_date)}</span>
            <span className="text-left">ใบกำกับภาษี</span>
            <span>{rec.tax_invoice_no ?? "-"}</span>
            <span className="text-left">งวดที่ / Payment no.</span>
            <span>{term?.seq ?? "-"}</span>
            <span className="text-left">QC</span>
            <span>{ref || "-"}</span>
            <span className="text-left">P/J</span>
            <span>{project?.code ?? "-"}</span>
          </div>
        </div>

        <section className="mt-3 grid grid-cols-[30mm_1fr] gap-y-1 border border-foreground p-2">
          <span>
            ได้รับเงินจาก
            <br />
            <span className="text-[9px]">Received from</span>
          </span>
          <div>
            <b>{name}</b> ({branch})
            {address ? <div className="whitespace-pre-line">{address}</div> : null}
            {taxId ? <div>เลขประจำตัวผู้เสียภาษี : {taxId}</div> : null}
          </div>
          <span>
            โครงการ
            <br />
            <span className="text-[9px]">Project</span>
          </span>
          <span>{project?.name ?? "-"}</span>
        </section>

        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="text-center">
              <th className="border border-foreground px-1.5 py-1 font-semibold">รายการ / Description</th>
              <th className="w-[40mm] border border-foreground px-1.5 py-1 font-semibold">จำนวนเงิน / Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="h-[30mm] border border-foreground px-1.5 py-1 align-top">
                ชำระค่าสินค้า / บริการ{rec.tax_invoice_no ? ` ตามใบกำกับภาษีเลขที่ ${rec.tax_invoice_no}` : ""}
                <br />
                งวดที่ {term?.seq ?? "-"} {term?.print_label ?? term?.name ?? ""}
                {ref ? <br /> : null}
                {ref ? `ตามใบเสนอราคา ${ref}` : null}
              </td>
              <td className="border border-foreground px-1.5 py-1 text-right align-top tabular-nums">{formatTHB(m.exVat)}</td>
            </tr>
          </tbody>
        </table>

        <section className="grid grid-cols-[1fr_80mm] border-x border-b border-foreground" data-pdf-keep>
          <div className="space-y-1 p-2">
            <div className="text-[9px]">จำนวนเงิน (ตัวอักษร)</div>
            <div className="font-semibold">({bahtText(m.received)})</div>
            <div className="pt-2">
              ชำระโดย / Paid by : <b>{methodLabel(rec.method)}</b>
              {rec.bank_ref ? ` · ${rec.bank_ref}` : ""}
            </div>
          </div>
          <div className="border-l border-foreground">
            {row("รวมเงิน", "Amount", m.exVat)}
            {row(`ภาษีมูลค่าเพิ่ม ${vatPercent}%`, "VAT", m.vat)}
            {row("รวมเป็นเงิน", "Total", m.total, true)}
            {m.retention > 0 ? row("หัก เงินประกันผลงาน", "Retention", m.retention) : null}
            {m.retention > 0 ? row("คงเหลือ", "After retention", m.afterRetention) : null}
            {m.wht > 0 ? row("หัก ภาษี ณ ที่จ่าย", "WHT", m.wht) : null}
            {row("รับเงินสุทธิ", "Net received", m.received, true)}
          </div>
        </section>

        <section className="mt-12 grid grid-cols-2 gap-10 text-center" data-pdf-keep>
          {[
            ["ผู้รับเงิน", "COLLECTOR"],
            ["ผู้มีอำนาจลงนาม", "AUTHORIZED SIGNATURE"],
          ].map(([th, en]) => (
            <div key={en}>
              <div className="border-b border-dotted border-foreground pb-6" />
              <div className="mt-1">{th}</div>
              <div className="text-[9px]">{en}</div>
              <div className="mt-1">วันที่ ......../......../........</div>
            </div>
          ))}
        </section>
        <p className="mt-4 text-[9px]">ใบเสร็จรับเงินนี้จะสมบูรณ์เมื่อบริษัทฯ ได้รับเงินเรียบร้อยแล้ว (กรณีชำระด้วยเช็ค เมื่อเช็คผ่านบัญชีแล้ว)</p>
        <DocFooter company={co} />
      </div>
    </div>
  );
}
