import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DocFooter, DocHeader } from "@/components/print/DocHeader";
import { bahtText } from "@/lib/bahtText";
import { companyOf, useCompanies } from "@/lib/companies";
import { formatDate, formatTHB } from "@/lib/format";
import { buildA4Pdf } from "@/lib/pdf";

type Search = { notice: 1 | 2 | 3 };

export const Route = createFileRoute("/print/reminder/$billId")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): Search => {
    const n = Number(s["notice"]);
    return { notice: n === 2 || n === 3 ? n : 1 };
  },
  head: () => ({
    meta: [
      { title: "ใบทวงถาม | CCSE ERP" },
      { name: "description", content: "หนังสือแจ้งเตือนการชำระเงิน ครั้งที่ 1 / 2 / ฉบับสุดท้าย" },
      { property: "og:title", content: "ใบทวงถาม | CCSE ERP" },
      { property: "og:description", content: "หนังสือแจ้งเตือนการชำระเงิน" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrintReminder,
});

const THAI_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const thaiLong = (d: Date) => `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;

const SUBJECT: Record<number, string> = {
  1: "ขอแจ้งเตือนการชำระเงิน",
  2: "ขอแจ้งเตือนการชำระเงิน (ครั้งที่ 2)",
  3: "ขอให้ชำระเงินที่ค้างชำระ (ฉบับสุดท้าย)",
};
const BODY: Record<number, string> = {
  1: "ตามที่บริษัทฯ ได้ส่งใบเบิกเงินสำหรับงานข้างต้นให้แก่ท่านแล้วนั้น บริษัทฯ ขอเรียนให้ทราบว่ายังมียอดค้างชำระตามรายละเอียดด้านล่าง จึงเรียนมาเพื่อโปรดดำเนินการชำระเงินตามช่องทางที่แจ้งไว้ หากท่านได้ชำระแล้ว บริษัทฯ ต้องขออภัยและขอบพระคุณมา ณ โอกาสนี้",
  2: "บริษัทฯ ได้เคยแจ้งเตือนการชำระเงินสำหรับงานข้างต้นแล้ว แต่จนถึงวันนี้ยังไม่ได้รับชำระ จึงขอความกรุณาท่านดำเนินการชำระเงินตามรายละเอียดด้านล่างโดยเร็ว หรือแจ้งกำหนดวันชำระให้บริษัทฯ ทราบ",
  3: "บริษัทฯ ได้แจ้งเตือนการชำระเงินสำหรับงานข้างต้นมาแล้วหลายครั้ง แต่ยังไม่ได้รับชำระ จึงขอให้ท่านชำระยอดค้างทั้งหมดตามรายละเอียดด้านล่างภายใน 7 วันนับจากวันที่ในหนังสือฉบับนี้ หากพ้นกำหนด บริษัทฯ ขอสงวนสิทธิ์ดำเนินการตามความเหมาะสมต่อไป",
};

/** หนังสือแจ้งเตือนการชำระเงิน: all unpaid bills of the project, bank account, signer. */
function PrintReminder() {
  const { billId } = Route.useParams();
  const { notice } = Route.useSearch();
  const companies = useCompanies();
  const { data, isLoading } = useQuery({
    queryKey: ["reminder", billId],
    queryFn: async () => {
      const { data: bill, error } = await supabase.from("billing_docs").select("*").eq("id", billId).single();
      if (error) throw error;
      const { data: sched, error: e2 } = await supabase.rpc("payment_schedule", { _project_id: bill.project_id });
      if (e2) throw e2;
      const open = (sched ?? []).filter((t) => t.bill_id && Number(t.outstanding) > 0.005);
      return { bill, open };
    },
  });

  if (isLoading || !data) return <p className="p-6 text-sm text-muted-foreground">กำลังโหลด…</p>;
  const { bill, open } = data;
  const co = companyOf(companies, bill.company_id);
  const total = open.reduce((s, t) => s + Number(t.outstanding), 0);
  const th = "border border-foreground px-1.5 py-1 text-left font-semibold";
  const td = "border border-foreground px-1.5 py-1 tabular-nums";

  return (
    <div className="min-h-screen bg-muted print:bg-background">
      <style>{`@page { size: A4; margin: 12mm; } @media print { .rem-print { padding: 0 !important; max-width: none !important; box-shadow: none !important; } }`}</style>
      <div className="mx-auto flex max-w-[210mm] justify-end gap-2 py-3 print:hidden">
        <Button variant="outline" onClick={() => window.print()}>
          พิมพ์
        </Button>
        <Button
          onClick={async () => {
            const el = document.querySelector(".rem-print") as HTMLElement | null;
            if (el) (await buildA4Pdf(el)).save(`ใบทวงถาม ${bill.doc_no}.pdf`);
          }}
        >
          บันทึก PDF
        </Button>
      </div>
      <div className="rem-print mx-auto max-w-[210mm] bg-background p-[12mm] text-[12.5px] leading-relaxed text-foreground shadow">
        <DocHeader company={co} />
        <div className="mt-4 text-right">วันที่ {thaiLong(new Date())}</div>
        <div className="mt-2 space-y-1">
          <div>
            <b>เรื่อง</b> {SUBJECT[notice]}
          </div>
          <div>
            <b>เรียน</b> {bill.attn ? `${bill.attn} / ` : ""}
            {bill.customer_name ?? "-"}
          </div>
          <div>
            <b>โครงการ</b> {bill.project_name ?? "-"}
            {bill.po_number ? ` (PO ${bill.po_number})` : ""}
          </div>
        </div>
        <p className="mt-3 indent-10">{BODY[notice]}</p>

        <table className="mt-3 w-full border-collapse text-[11.5px]">
          <thead>
            <tr>
              <th className={th}>เลขที่ใบเบิกเงิน</th>
              <th className={th}>งวด</th>
              <th className={th}>วันที่วางบิล</th>
              <th className={th}>ครบกำหนด</th>
              <th className={th + " text-right"}>เกินกำหนด (วัน)</th>
              <th className={th + " text-right"}>ยอดค้างชำระ (บาท)</th>
            </tr>
          </thead>
          <tbody>
            {open.map((t) => (
              <tr key={t.bill_id}>
                <td className={td}>{t.bill_no}</td>
                <td className={td}>
                  {t.seq}. {t.name}
                </td>
                <td className={td}>{t.bill_date ? formatDate(t.bill_date) : "-"}</td>
                <td className={td}>{t.due_date ? formatDate(t.due_date) : "-"}</td>
                <td className={td + " text-right"}>{t.days_overdue ?? "-"}</td>
                <td className={td + " text-right"}>{formatTHB(Number(t.outstanding))}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={td} colSpan={5}>
                รวมยอดค้างชำระ ({bahtText(total)})
              </td>
              <td className={td + " text-right"}>{formatTHB(total)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4">
          <b>ช่องทางการชำระเงิน</b> โอนเข้าบัญชี {co.bank_account_name_th ?? co.name_th} · {co.bank_name_th ?? ""} สาขา{" "}
          {co.bank_branch_th ?? ""} · เลขที่บัญชี <b>{co.bank_account_no ?? "-"}</b>
          <div className="text-[11px] text-muted-foreground">
            เมื่อชำระแล้ว กรุณาส่งหลักฐานการโอนให้ฝ่ายบัญชี{co.contact_line ? ` (${co.contact_line})` : ""}
          </div>
        </div>

        <div className="mt-10 grid grid-cols-2">
          <div />
          <div className="text-center">
            <div>ขอแสดงความนับถือ</div>
            <div className="mt-12">({co.signer_name ?? ""})</div>
            <div>{co.signer_title ?? ""}</div>
            <div>{co.name_th}</div>
          </div>
        </div>
        <DocFooter company={co} />
      </div>
    </div>
  );
}
