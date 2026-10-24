import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useWorkSheet } from "@/components/work/WorkSheet";
import { useCustomerNames } from "@/hooks/useCustomerNames";
import { useMeasurements } from "@/hooks/useMeasurements";
import { companyOf, useCompanies } from "@/lib/companies";
import { quotationRevisionSuffix } from "@/lib/boq";
import { formatCutSpecWos, parseCutSpec, runsFromPieces } from "@/lib/cutSpec";
import { formatQty } from "@/lib/format";
import { buildA4Pdf } from "@/lib/pdf";

export const Route = createFileRoute("/print/wos/$projectId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "WORK ORDER SHEET | CCSE ERP" },
      { name: "description", content: "ใบ Work (WOS) รูปแบบ CCSE สำหรับช่างและฝ่ายผลิต ไม่มีราคา" },
      { property: "og:title", content: "WORK ORDER SHEET | CCSE ERP" },
      { property: "og:description", content: "ใบ Work (WOS) รูปแบบ A4" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrintWos,
});

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
const enDate = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
/** Field-note date the way the team writes it: 6/10/69 (Buddhist year, 2 digits). */
const thaiShort = (iso: string) => {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}/${String((d.getFullYear() + 543) % 100).padStart(2, "0")}`;
};

/** CCSE WORK ORDER SHEET (ใบ Work): BOQ items without prices, site notes, approvals. */
function PrintWos() {
  const { projectId } = Route.useParams();
  const companies = useCompanies();
  const custName = useCustomerNames();
  const { header, lines, pick, isLoading } = useWorkSheet(projectId);
  const { data: measured } = useMeasurements(projectId);
  const { data: p } = useQuery({
    queryKey: ["project", projectId, "wos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        // "*" so the sheet still opens before contacts / schedule note exist (migration 0015)
        .select("*, customers(name)")
        .eq("id", projectId)
        .single();
      if (error) throw error;
      return data;
    },
  });
  const { data: q } = useQuery({
    queryKey: ["quotation", projectId, "wos"],
    enabled: !!header?.quotation_id,
    queryFn: async () => {
      const { data } = await supabase.from("quotations").select("company_id").eq("id", header!.quotation_id).maybeSingle();
      return data;
    },
  });

  if (isLoading || !p) return <p className="p-6 text-sm text-muted-foreground">กำลังโหลด…</p>;
  const co = companyOf(companies, q?.company_id);
  const rows = lines.filter((l) => l.kind !== "internal");
  const cell = "border-x border-foreground px-1.5 py-0.5 align-top";
  const deposit = p.released_by === "deposit";
  const ceo = p.released_by === "ceo";
  const box = (on: boolean) => (on ? "☑" : "☐");

  return (
    <div className="min-h-screen bg-muted print:bg-background">
      <style>{`@page { size: A4; margin: 10mm; } @media print { .wos-print { padding: 0 !important; max-width: none !important; box-shadow: none !important; } }`}</style>
      <div className="mx-auto flex max-w-[210mm] justify-end gap-2 py-3 print:hidden">
        <Button variant="outline" onClick={() => window.print()}>
          พิมพ์
        </Button>
        <Button
          onClick={async () => {
            const el = document.querySelector(".wos-print") as HTMLElement | null;
            if (el) (await buildA4Pdf(el)).save(`WOS ${p.code}.pdf`);
          }}
        >
          บันทึก PDF
        </Button>
      </div>
      <div className="wos-print mx-auto max-w-[210mm] bg-background p-[10mm] text-[11px] leading-snug text-foreground shadow">
        <div className="text-right text-[10px] font-semibold">{co.name_en}</div>
        <section className="mt-2 grid grid-cols-[1fr_auto] gap-x-6">
          <div className="space-y-0.5">
            <div className="grid grid-cols-[14mm_1fr]">
              <b>DATE:</b>
              <span>{enDate(new Date())}</span>
            </div>
            <div className="grid grid-cols-[14mm_1fr]">
              <b>SUBJ:</b>
              <span className="font-bold">WORK ORDER SHEET</span>
            </div>
            <div className="grid grid-cols-[14mm_1fr]">
              <b>PROJ:</b>
              <span className="font-semibold">{p.name}</span>
            </div>
            <div className="grid grid-cols-[14mm_1fr]">
              <b>ATTN:</b>
              <span>
                {p.attn || custName(p.customer_id, p.customers) || "-"}
                {p.schedule_note ? <span className="ml-4 font-semibold text-destructive">{p.schedule_note}</span> : null}
              </span>
            </div>
            <div className="grid grid-cols-[14mm_1fr]">
              <b>ติดต่อ</b>
              <span>{p.site_contacts || ""}</span>
            </div>
          </div>
          <div className="space-y-0.5 text-right">
            <div>
              <b>P/J NO :</b> {p.code}
            </div>
            <div>
              <b>ref :</b> {header ? `${header.ref_no}${quotationRevisionSuffix(header.rev)}` : "-"}
            </div>
          </div>
        </section>

        <table className="mt-3 w-full border-collapse border border-foreground">
          <thead>
            <tr className="border-b border-foreground text-center">
              <th className={cell + " w-10"}>ITEM</th>
              <th className={cell}>DESCRIPTION</th>
              <th className={cell + " w-16"}>Q&apos;TY</th>
              <th className={cell + " w-12"}>UNIT</th>
              <th className={cell + " w-[52mm]"}>หมายเหตุ</th>
              <th className={cell + " w-[24mm]"}>หัวหน้าช่าง (รับของ)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const m = measured?.get(l.id);
              const name = l.component_name ?? l.heading_text ?? "";
              if (l.kind === "heading")
                return (
                  <tr key={l.id} className="font-bold">
                    <td className={cell + " text-center"}>{l.item_no}</td>
                    <td className={cell} colSpan={3}>
                      {name}
                      {l.zone ? ` · ${l.zone}` : ""}
                    </td>
                    <td className={cell}>{l.circuit_note}</td>
                    <td className={cell} />
                  </tr>
                );
              const spec = m?.cut_spec ? parseCutSpec(m.cut_spec) : null;
              // measured notation → measured pieces → contract pieces
              const pieces = m?.cut_lengths?.length ? m.cut_lengths : l.cut_lengths;
              const specText =
                spec && !("error" in spec)
                  ? formatCutSpecWos(spec.runs)
                  : pieces?.length
                    ? formatCutSpecWos(runsFromPieces(pieces.map(Number)))
                    : "";
              const changed = m?.measured_qty != null && Number(m.measured_qty) !== Number(l.qty ?? 0);
              const site = l.kind === "by_buyer" || l.kind === "existing";
              return (
                <Fragment key={l.id}>
                  <tr>
                    <td className={cell + " text-center"}>{l.item_no}</td>
                    <td className={cell}>
                      {l.item_no ? name : `- ${name}`}
                      {specText ? <div>- L = {specText}</div> : null}
                    </td>
                    <td className={cell + " text-right tabular-nums"}>
                      {site ? (
                        "by buyer"
                      ) : changed ? (
                        <>
                          <s className="text-muted-foreground">{formatQty(Number(l.qty ?? 0))}</s>{" "}
                          <b>{formatQty(Number(m!.measured_qty))}</b>
                        </>
                      ) : (
                        formatQty(Number(l.qty ?? 0))
                      )}
                    </td>
                    <td className={cell}>{site ? "" : l.unit}</td>
                    <td className={cell}>
                      {l.circuit_note ? <div>{l.circuit_note}</div> : null}
                      {m ? (
                        <div className="text-destructive">
                          {thaiShort(m.measured_at)} : วัดหน้างานจริง{m.note ? ` — ${m.note}` : ""}
                        </div>
                      ) : null}
                    </td>
                    <td className={cell} />
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>

        <table className="mt-3 w-full border-collapse border border-foreground" data-pdf-keep>
          <thead>
            <tr className="border-b border-foreground text-center">
              <th className={cell + " w-10"}>ลำดับ</th>
              <th className={cell}>รายการเบิก</th>
              <th className={cell + " w-24"}>จำนวน</th>
              <th className={cell + " w-[40mm]"}>หมายเหตุ</th>
              <th className={cell + " w-[18mm]"}>สโตร์</th>
              <th className={cell + " w-[18mm]"}>ฝ่ายผลิต</th>
            </tr>
          </thead>
          <tbody>
            {(pick.length ? pick : Array.from({ length: 5 }, () => null)).map((r, i) => (
              <tr key={i} className="border-b border-border">
                <td className={cell + " text-center"}>{r ? i + 1 : " "}</td>
                <td className={cell}>{r ? `${r.code} — ${r.name}` : ""}</td>
                <td className={cell + " text-right tabular-nums"}>{r ? `${formatQty(Number(r.qty))} ${r.unit ?? ""}` : ""}</td>
                <td className={cell} />
                <td className={cell} />
                <td className={cell} />
              </tr>
            ))}
          </tbody>
        </table>

        <section className="mt-3 grid grid-cols-2 gap-4 border border-foreground p-2" data-pdf-keep>
          <div>
            <b>1. ฝ่ายการเงิน</b>
            <div className="mt-1 flex gap-4">
              <span>{box(!!p.po_number)} มี PO</span>
              <span>{box(!p.po_number)} ไม่มี PO</span>
              <span>{box(deposit)} รับมัดจำแล้ว</span>
            </div>
            <div className="mt-6">ลายเซ็นต์ ..................... วันที่ ….. /….. /…..</div>
          </div>
          <div>
            <b>2. กรณีไม่มีมัดจำ หรือกรณีพิเศษอื่นๆ</b>
            <div className="mt-1">{box(ceo)} CEO อนุมัติ</div>
            <div className="mt-6">ลายเซ็นต์ ..................... วันที่ ….. /….. /…..</div>
          </div>
          <div className="col-span-2 border-t border-foreground pt-2">
            <b>เจ้าหน้าที่ภาคสนาม</b> ลายเซ็นต์ ............................................ วันที่ .......... /........../..........
            <div className="text-[10px]">(ยืนยันรายการถูกต้อง และมีเอกสารประกอบแนบ)</div>
          </div>
        </section>
      </div>
    </div>
  );
}
