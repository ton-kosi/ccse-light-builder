import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { companyOf, useCompanies } from "@/lib/companies";
import { formatQty, formatTHB } from "@/lib/format";
import { buildA4Pdf } from "@/lib/pdf";
import { db, lineAmount, poLabel, poTotals, type PoLine, type PurchaseOrder } from "@/lib/purchaseOrders";

export const Route = createFileRoute("/print/po/$poId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "PURCHASE ORDER | CCSE ERP" },
      { name: "description", content: "ใบสั่งซื้อ (PO) รูปแบบ A4" },
      { property: "og:title", content: "PURCHASE ORDER | CCSE ERP" },
      { property: "og:description", content: "ใบสั่งซื้อ A4" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrintPo,
});

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** As in the PO workbooks: NOV 10,2026 */
const poDate = (iso: string) => {
  const d = new Date(iso);
  return `${MON[d.getMonth()]} ${d.getDate()},${d.getFullYear()}`;
};

function PrintPo() {
  const { poId } = Route.useParams();
  const companies = useCompanies();
  const { data } = useQuery({
    queryKey: ["purchase_order", poId, "print"],
    queryFn: async () => {
      const { data: po, error } = await db("purchase_orders").select("*").eq("id", poId).single();
      if (error) throw new Error(error.message);
      const { data: lines, error: e2 } = await db("purchase_order_lines").select("*").eq("po_id", poId).order("sort_order");
      if (e2) throw new Error(e2.message);
      return { po: po as PurchaseOrder, lines: (lines ?? []) as PoLine[] };
    },
  });
  if (!data) return <p className="p-6 text-sm text-muted-foreground">กำลังโหลด…</p>;
  const { po, lines } = data;
  const co = companyOf(companies, po.company_id);
  const t = poTotals(lines, po.vat_percent);
  const cell = "border border-foreground px-1.5 py-1 align-top";
  const blankRows = Math.max(0, 12 - lines.length);

  return (
    <div className="min-h-screen bg-muted print:bg-background">
      <style>{`@page { size: A4; margin: 10mm; } @media print { .po-print { padding: 0 !important; max-width: none !important; box-shadow: none !important; } }`}</style>
      <div className="mx-auto flex max-w-[210mm] justify-end gap-2 py-3 print:hidden">
        <Button variant="outline" onClick={() => window.print()}>
          พิมพ์
        </Button>
        <Button
          onClick={async () => {
            const el = document.querySelector(".po-print") as HTMLElement | null;
            if (el) (await buildA4Pdf(el)).save(`PO ${poLabel(po)}.pdf`);
          }}
        >
          บันทึก PDF
        </Button>
      </div>
      <div className="po-print mx-auto max-w-[210mm] bg-background p-[10mm] text-[11px] leading-snug text-foreground shadow">
        <header className="flex items-start justify-between gap-4 border-b-2 border-foreground pb-2">
          <div className="flex items-start gap-3">
            {co.logo_data ? <img src={co.logo_data} alt="" className="h-[18mm] w-auto max-w-[35mm] object-contain" /> : null}
            <div>
              <div className="text-[14px] font-bold">{co.name_th}</div>
              <div className="text-[12px] font-semibold">{co.short_en || co.name_en}</div>
              {co.address_th ? <div>{co.address_th}</div> : null}
              <div>
                {co.contact_line ?? ""}
                {co.tax_id ? `  (เลขผู้เสียภาษี ${co.tax_id} สำนักงานใหญ่)` : ""}
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[16px] font-bold">ใบสั่งซื้อ</div>
            <div className="text-[13px] font-semibold">PURCHASE ORDER</div>
          </div>
        </header>

        <section className="mt-2 grid grid-cols-[1fr_68mm] gap-x-6 gap-y-1">
          <div className="grid grid-cols-[26mm_1fr] gap-y-1">
            <span>
              บริษัท
              <br />
              <span className="text-[9px]">COMPANY</span>
            </span>
            <b>{po.supplier_name}</b>
            <span>
              เรียน
              <br />
              <span className="text-[9px]">ATTENTION</span>
            </span>
            <span>{po.attn ?? ""}</span>
            <span>
              โทรศัพท์
              <br />
              <span className="text-[9px]">TELEPHONE</span>
            </span>
            <span>
              {po.phone ?? ""}
              {po.fax ? <span className="ml-4">แฟกซ์ / FAX : {po.fax}</span> : null}
            </span>
          </div>
          <div className="grid grid-cols-[28mm_1fr] gap-y-1">
            <span>
              ใบสั่งซื้อเลขที่
              <br />
              <span className="text-[9px]">PO. NO.</span>
            </span>
            <b className="text-[13px]">{poLabel(po)}</b>
            <span>
              วันที่
              <br />
              <span className="text-[9px]">DATE</span>
            </span>
            <span>{poDate(po.date)}</span>
            <span>
              โครงการ
              <br />
              <span className="text-[9px]">PROJECT</span>
            </span>
            <span>{po.run_label ?? ""}</span>
          </div>
        </section>

        <table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="text-center">
              <th className={cell + " w-10"}>
                ลำดับ
                <br />
                <span className="text-[9px] font-normal">ITEM</span>
              </th>
              <th className={cell}>
                รายการ
                <br />
                <span className="text-[9px] font-normal">DESCRIPTION</span>
              </th>
              <th className={cell + " w-24"} colSpan={2}>
                จำนวน
                <br />
                <span className="text-[9px] font-normal">QUANTITY</span>
              </th>
              <th className={cell + " w-20"}>
                ราคา
                <br />
                <span className="text-[9px] font-normal">UNIT PRICE</span>
              </th>
              <th className={cell + " w-14"}>
                ส่วนลด
                <br />
                <span className="text-[9px] font-normal">DISCOUNT</span>
              </th>
              <th className={cell + " w-24"}>
                จำนวนเงิน
                <br />
                <span className="text-[9px] font-normal">AMOUNT</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id}>
                <td className={cell + " text-center"}>{i + 1}</td>
                <td className={cell + " whitespace-pre-line"}>{l.description}</td>
                <td className={cell + " border-r-0 text-right tabular-nums"}>{formatQty(Number(l.qty))}</td>
                <td className={cell + " border-l-0"}>{l.unit ?? ""}</td>
                <td className={cell + " text-right tabular-nums"}>{formatTHB(Number(l.unit_price))}</td>
                <td className={cell + " text-right"}>{Number(l.discount_percent) ? `${Number(l.discount_percent)}%` : ""}</td>
                <td className={cell + " text-right tabular-nums"}>{formatTHB(lineAmount(l))}</td>
              </tr>
            ))}
            {Array.from({ length: blankRows }, (_, i) => (
              <tr key={`b${i}`}>
                {Array.from({ length: 7 }, (_, j) => (
                  <td key={j} className={cell}>
                    &nbsp;
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        <section className="grid grid-cols-[1fr_72mm] border-x border-b border-foreground" data-pdf-keep>
          <div className="space-y-1 p-2">
            <div>
              กำหนดส่ง / DELIVERY : <b>{po.delivery_text ?? ""}</b>
            </div>
            <div>
              สถานที่ส่ง / SHIP TO : <b>{po.ship_to ?? ""}</b>
            </div>
            <div>
              เงื่อนไขการชำระเงิน / TERM OF CREDIT : <b>{po.credit_text ?? ""}</b>
            </div>
          </div>
          <div className="border-l border-foreground">
            {[
              ["รวมเงิน", t.subtotal],
              [`ภาษีมูลค่าเพิ่ม ${Number(po.vat_percent)}%`, t.vat],
              ["รวมเป็นเงินทั้งสิ้น", t.total],
            ].map(([label, v], i) => (
              <div key={String(label)} className={"flex justify-between px-2 py-1 " + (i === 2 ? "border-t border-foreground font-bold" : "")}>
                <span>{label}</span>
                <span className="tabular-nums">{formatTHB(Number(v))}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-10 flex justify-end" data-pdf-keep>
          <div className="w-[70mm] text-center">
            <div className="border-b border-dotted border-foreground pb-6" />
            <div className="mt-1">ลายมือชื่อผู้มีอำนาจสั่งซื้อ</div>
            <div className="text-[9px]">AUTHORIZED SIGNATURE</div>
          </div>
        </section>
      </div>
    </div>
  );
}
