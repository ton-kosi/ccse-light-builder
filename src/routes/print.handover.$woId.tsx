import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { DocFooter, DocHeader } from "@/components/print/DocHeader";
import { useHandover } from "@/components/work/HandoverSection";
import { useJobFiles } from "@/components/work/JobFiles";
import { useAssignees } from "@/components/work/WorkPlanSection";
import { useCustomerNames } from "@/hooks/useCustomerNames";
import { useStaff } from "@/hooks/useStaff";
import { companyOf, useCompanies } from "@/lib/companies";
import { woTypeLabel } from "@/lib/erp";
import { formatDate, formatQty } from "@/lib/format";
import { isImage } from "@/lib/jobs";
import { buildA4Pdf } from "@/lib/pdf";

export const Route = createFileRoute("/print/handover/$woId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ใบส่งมอบงาน | CCSE ERP" },
      { name: "description", content: "ใบส่งมอบงานพร้อมรูปและลายเซ็นลูกค้า รูปแบบ A4 ไม่มีราคา" },
      { property: "og:title", content: "ใบส่งมอบงาน | CCSE ERP" },
      { property: "og:description", content: "ใบส่งมอบงาน รูปแบบ A4" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrintHandover,
});

/** ใบส่งมอบงาน / DELIVERY NOTE: what was handed over, photos, and the customer's signature. No prices. */
function PrintHandover() {
  const { woId } = Route.useParams();
  const companies = useCompanies();
  const custName = useCustomerNames();
  const { data: staff } = useStaff();
  const { data: assignees } = useAssignees();
  const { data: handover, isLoading: hLoading } = useHandover(woId);

  const { data, isLoading } = useQuery({
    queryKey: ["print_handover", woId],
    queryFn: async () => {
      const { data: wo, error } = await supabase
        .from("work_orders")
        .select("*, projects(id, code, name, site_address, po_number, customer_id, attn, customers(name))")
        .eq("id", woId)
        .single();
      if (error) throw error;
      const [{ data: items }, { data: q }] = await Promise.all([
        supabase.from("work_order_items").select("item_name, qty, unit").eq("work_order_id", woId).order("created_at"),
        supabase
          .from("quotations")
          .select("company_id")
          .eq("project_id", wo.project_id)
          .eq("is_current", true)
          .maybeSingle(),
      ]);
      return { wo, items: items ?? [], companyId: q?.company_id ?? null };
    },
  });
  const { data: files } = useJobFiles(data?.wo.project_id ?? "");

  if (isLoading || hLoading) return <p className="p-6 text-sm text-muted-foreground">กำลังโหลด…</p>;
  if (!data) return <p className="p-6 text-sm text-muted-foreground">ไม่พบใบสั่งงานนี้</p>;
  if (!handover) return <p className="p-6 text-sm text-muted-foreground">ใบสั่งงานนี้ยังไม่ได้บันทึกส่งมอบงาน</p>;

  const { wo, items } = data;
  const p = wo.projects as {
    code: string;
    name: string;
    site_address: string | null;
    po_number: string | null;
    customer_id: string | null;
    attn: string | null;
    customers: { name: string } | null;
  } | null;
  const co = companyOf(companies, data.companyId);
  const photos = (files ?? []).filter(
    (f) => f.work_order_id === woId && f.kind === "handover_photo" && isImage(f.mime, f.name) && f.url,
  );
  const crew = (assignees?.get(woId) ?? [])
    .map((id) => staff?.find((s) => s.id === id)?.name)
    .filter(Boolean)
    .join(", ");
  const row = "grid grid-cols-[34mm_1fr] gap-2";

  return (
    <div className="min-h-screen bg-muted print:bg-background">
      <style>{`@page { size: A4; margin: 12mm; } @media print { .handover-print { padding: 0 !important; max-width: none !important; box-shadow: none !important; } }`}</style>
      <div className="mx-auto flex max-w-[210mm] justify-end gap-2 py-3 print:hidden">
        <Button variant="outline" onClick={() => window.print()}>
          พิมพ์
        </Button>
        <Button
          onClick={async () => {
            const el = document.querySelector(".handover-print") as HTMLElement | null;
            if (el) (await buildA4Pdf(el)).save(`ส่งมอบงาน-${wo.doc_no}.pdf`);
          }}
        >
          บันทึก PDF
        </Button>
      </div>
      <div className="handover-print mx-auto max-w-[210mm] bg-background p-[12mm] text-[12px] leading-snug text-foreground shadow">
        <DocHeader company={co} title="ใบส่งมอบงาน / DELIVERY NOTE" subtitle={`เลขที่ ${wo.doc_no}`} />

        <section className="mt-4 space-y-1">
          <div className={row}>
            <span className="font-semibold">วันที่ส่งมอบ</span>
            <span>{formatDate(handover.handover_date)}</span>
          </div>
          <div className={row}>
            <span className="font-semibold">ลูกค้า</span>
            <span>
              {custName(p?.customer_id, p?.customers) ?? "-"}
              {p?.attn ? ` · ATTN: ${p.attn}` : ""}
            </span>
          </div>
          <div className={row}>
            <span className="font-semibold">โครงการ</span>
            <span>
              {p?.code} — {p?.name}
              {p?.po_number ? ` · PO ${p.po_number}` : ""}
            </span>
          </div>
          {p?.site_address ? (
            <div className={row}>
              <span className="font-semibold">สถานที่</span>
              <span>{p.site_address}</span>
            </div>
          ) : null}
          <div className={row}>
            <span className="font-semibold">งาน</span>
            <span>
              {woTypeLabel(wo.wo_type)}
              {wo.title ? ` · ${wo.title}` : ""}
              {wo.scheduled_date
                ? ` · ${formatDate(wo.scheduled_date)}${wo.end_date && wo.end_date !== wo.scheduled_date ? ` – ${formatDate(wo.end_date)}` : ""}`
                : ""}
            </span>
          </div>
          {crew ? (
            <div className={row}>
              <span className="font-semibold">ผู้ปฏิบัติงาน</span>
              <span>{crew}</span>
            </div>
          ) : null}
        </section>

        {items.length ? (
          <table className="mt-4 w-full border-collapse text-[11.5px]">
            <thead>
              <tr className="border-y border-foreground">
                <th className="w-10 py-1 text-center">#</th>
                <th className="py-1 text-left">รายการที่ส่งมอบ</th>
                <th className="w-32 py-1 text-right">จำนวน</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="py-1 text-center">{i + 1}</td>
                  <td className="py-1">{it.item_name}</td>
                  <td className="py-1 text-right tabular-nums">
                    {formatQty(Number(it.qty))} {it.unit ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {handover.note ? (
          <p className="mt-3">
            <span className="font-semibold">หมายเหตุ:</span> {handover.note}
          </p>
        ) : null}

        <p className="mt-4">
          ข้าพเจ้าได้ตรวจรับงานข้างต้นแล้ว งานติดตั้งแล้วเสร็จและใช้งานได้ตามรายการ
        </p>

        {photos.length ? (
          <section className="mt-4" data-pdf-keep>
            <div className="mb-1 font-semibold">รูปงานที่ส่งมอบ</div>
            <div className="grid grid-cols-3 gap-2">
              {photos.slice(0, 6).map((f) => (
                <img
                  key={f.id}
                  src={f.url!}
                  alt={f.name}
                  crossOrigin="anonymous"
                  className="aspect-[4/3] w-full rounded border border-border object-cover"
                />
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-8 grid grid-cols-2 gap-10 text-center" data-pdf-keep>
          <div>
            <div className="flex h-24 items-end justify-center border-b border-foreground">
              {handover.signatureUrl ? (
                <img
                  src={handover.signatureUrl}
                  alt="ลายเซ็นลูกค้า"
                  crossOrigin="anonymous"
                  className="max-h-24 object-contain"
                />
              ) : null}
            </div>
            <div className="mt-1">({handover.receiver_name})</div>
            <div>{handover.receiver_position || "ผู้รับมอบงาน"}</div>
            <div>วันที่ {formatDate(handover.handover_date)}</div>
          </div>
          <div>
            <div className="h-24 border-b border-foreground" />
            <div className="mt-1">({crew || " "})</div>
            <div>ผู้ส่งมอบงาน · {co.name_th}</div>
            <div>วันที่ {formatDate(handover.handover_date)}</div>
          </div>
        </section>

        <DocFooter company={co} />
      </div>
    </div>
  );
}
