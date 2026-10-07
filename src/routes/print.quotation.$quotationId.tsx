import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useLayoutEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { kindText } from "@/components/boq/BoqGrid";
import { computeTotals, lineAmount, optKey, optionNames, quotationRevisionSuffix } from "@/lib/boq";
import { Button } from "@/components/ui/button";
import { formatDate, formatQty, formatTHB } from "@/lib/format";

export const Route = createFileRoute("/print/quotation/$quotationId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "พิมพ์ใบเสนอราคา | CCSE ERP" },
      { name: "description", content: "ใบเสนอราคาสำหรับลูกค้า รูปแบบ A4 พร้อมพิมพ์/บันทึก PDF" },
      { property: "og:title", content: "พิมพ์ใบเสนอราคา | CCSE ERP" },
      { property: "og:description", content: "ใบเสนอราคาสำหรับลูกค้า รูปแบบ A4" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrintQuotation,
});

async function savePdf(filename: string) {
  const el = document.querySelector(".quote-print") as HTMLElement | null;
  if (!el) return;
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas-pro"), import("jspdf")]);
  el.classList.add("pdf-capture");
  try {
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff", ignoreElements: (n) => n.classList?.contains("no-print") });
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = 210, pageH = 297, margin = 8;
    const imgW = pageW - margin * 2;
    const pxPerMm = canvas.width / imgW;
    const sliceH = Math.floor((pageH - margin * 2) * pxPerMm);
    for (let y = 0, page = 0; y < canvas.height; y += sliceH, page++) {
      const h = Math.min(sliceH, canvas.height - y);
      const c = document.createElement("canvas");
      c.width = canvas.width; c.height = h;
      const context = c.getContext("2d");
      if (!context) throw new Error("ไม่สามารถสร้าง PDF ได้");
      context.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
      if (page) pdf.addPage();
      pdf.addImage(c.toDataURL("image/jpeg", 0.95), "JPEG", margin, margin, imgW, h / pxPerMm);
    }
    pdf.save(filename);
  } finally {
    el.classList.remove("pdf-capture");
  }
}

function FittedDescriptionLine({ children, bold = false }: { children: string; bold?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.removeProperty("font-size");
      const base = parseFloat(getComputedStyle(el).fontSize);
      if (el.scrollWidth > el.clientWidth && el.clientWidth > 0) {
        el.style.fontSize = `${base * el.clientWidth / el.scrollWidth}px`;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    document.fonts.ready.then(fit);
    return () => observer.disconnect();
  }, [children]);
  return <div ref={ref} className={"min-h-[1lh] whitespace-pre " + (bold ? "font-bold" : "")}>{children || "\u00a0"}</div>;
}

function PrintQuotation() {
  const { quotationId } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["print_quotation", quotationId],
    queryFn: async () => {
      const { data: q, error } = await supabase
        .from("quotations")
        .select("*, projects(code, name, attn, site_address, selected_option, customers(name, address))")
        .eq("id", quotationId)
        .maybeSingle();
      if (error) throw error;
      if (!q) return null;
      const [{ data: lines }, { data: terms }] = await Promise.all([
        supabase
          .from("quote_lines")
           .select("id, sort_order, option_name, zone, item_no, kind, customer_text, circuit_note, cut_lengths, qty, unit, unit_price, discount_percent, sales_components(name)")
          .eq("quotation_id", quotationId)
          .order("sort_order"),
        supabase.from("payment_terms").select("seq, name, percent, note").eq("quotation_id", quotationId).order("seq"),
      ]);
      return { q, lines: lines ?? [], terms: terms ?? [] };
    },
  });

  if (isLoading) return <p className="p-8 text-sm">กำลังโหลด...</p>;
  if (!data) return <p className="p-8 text-sm">ไม่พบใบเสนอราคา หรือคุณไม่มีสิทธิ์ดู (กรุณาเข้าสู่ระบบด้วยบัญชีผู้ดูแลระบบ)</p>;

  const { q, lines, terms } = data;
  const project = q.projects as {
    code: string;
    name: string;
    attn: string | null;
    site_address: string | null;
    selected_option: string | null;
    customers: { name: string; address: string | null } | null;
  } | null;
  const sel = project?.selected_option ?? null;
  const printed = sel ? lines.filter((l) => optKey(l) === "" || optKey(l) === sel) : lines;
  const opts = optionNames(lines);
  const discount = Number(q.discount ?? 0);
  const vatPct = Number(q.vat_percent ?? 0);
  const t = computeTotals(lines, discount, vatPct, sel);

  let lastOpt = "";
  return (
    <div className="quote-print mx-auto max-w-[210mm] bg-background p-[12mm] text-[12px] leading-snug text-foreground">
      <style>{`@page { size: A4; margin: 12mm; } @media print { .quote-print { padding: 0 !important; max-width: none !important; } .no-print { display: none !important; } tr { break-inside: avoid; } }`}</style>
      <div className="no-print mb-4 flex justify-end gap-2">
         <Button variant="outline"
          onClick={() => window.print()}
          className="h-9 rounded-md border border-input bg-background px-4 text-sm"
        >
          พิมพ์
         </Button>
         <Button
           onClick={() => savePdf(`${q.ref_no}${quotationRevisionSuffix(q.rev) ? `-Rev${q.rev}` : ""}.pdf`)}
          className="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground"
        >
          บันทึก PDF
         </Button>
      </div>

      <header className="flex items-start justify-between border-b-2 border-foreground pb-2">
        <div>
          <div className="text-lg font-bold">Chingchai &amp; Sons Engineering</div>
          <div className="text-xs">CCSE · Bangkok</div>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold tracking-wide">QUOTATION</div>
          <div>ใบเสนอราคา</div>
        </div>
      </header>

      <section className="mt-3 grid grid-cols-2 gap-4">
        <div className="space-y-0.5">
          <Info label="TO">{project?.customers?.name ?? "-"}</Info>
          {project?.customers?.address ? <Info label="">{project.customers.address}</Info> : null}
          <Info label="ATTN">{project?.attn ?? "-"}</Info>
          <Info label="PROJECT">{project?.name ?? "-"}</Info>
          {project?.site_address ? <Info label="SITE">{project.site_address}</Info> : null}
        </div>
        <div className="space-y-0.5">
          <Info label="REF NO.">{q.ref_no}</Info>
           {quotationRevisionSuffix(q.rev) ? <Info label="REV">{q.rev}</Info> : null}
          <Info label="DATE">{formatDate(q.date)}</Info>
          {q.validity_days ? <Info label="VALIDITY">{q.validity_days} days</Info> : null}
        </div>
      </section>

      <table className="mt-4 w-full table-fixed border-collapse">
        <thead>
          <tr className="border-y-2 border-foreground text-[11px]">
            <th className="w-8 py-1 text-left">ITEM</th>
            <th className="py-1 text-left">DESCRIPTION</th>
            <th className="w-10 py-1 text-right">Q'TY</th>
            <th className="w-10 py-1 pl-2 text-left">UNIT</th>
            <th className="w-16 py-1 text-right">@PRICE</th>
            <th className="w-12 py-1 text-right">% DISC.</th>
            <th className="w-20 py-1 text-right">TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {printed.map((l) => {
            const comp = l.sales_components as { name: string } | null;
            const desc = l.customer_text?.trim() || comp?.name || "";
            const ok = optKey(l);
            const optHeader = !sel && ok && ok !== lastOpt;
            lastOpt = ok;
            const heading = l.kind === "heading";
            const priced = l.kind === "priced";
            const special = kindText(l.kind);
            const showQty = !heading && l.qty !== null;
            return (
              <Fragment key={l.id}>
                {optHeader ? (
                  <tr>
                    <td />
                    <td colSpan={6} className="pt-2 font-bold underline">
                      OPTION {ok}
                    </td>
                  </tr>
                ) : null}
                <tr className={"align-top " + (heading ? "font-bold" : "")}>
                  <td className="py-0.5">{l.item_no ?? ""}</td>
                   <td className={"py-0.5 pr-2 " + (heading ? "pt-2" : "")}>
                     {l.zone?.trim() ? <FittedDescriptionLine bold>{l.zone.trim()}</FittedDescriptionLine> : null}
                     {desc.split("\n").map((text, index) => <FittedDescriptionLine key={index} bold={heading}>{text}</FittedDescriptionLine>)}
                     {l.circuit_note?.trim() ? <FittedDescriptionLine>{`- ${l.circuit_note.trim()}`}</FittedDescriptionLine> : null}
                     {l.cut_lengths?.length ? (
                       <div className="mt-1 text-[11px] font-normal">
                         <FittedDescriptionLine>{`- ${l.cut_lengths.map((length) => `${Number(length).toFixed(2)}m`).join(" + ")}`}</FittedDescriptionLine>
                       </div>
                     ) : null}
                   </td>
                  <td className="py-0.5 text-right tabular-nums">{showQty ? formatQty(Number(l.qty)) : ""}</td>
                  <td className="py-0.5 pl-2">{showQty ? (l.unit ?? "") : ""}</td>
                  {priced ? (
                    <>
                      <td className="py-0.5 text-right tabular-nums">{formatTHB(Number(l.unit_price ?? 0))}</td>
                      <td className="py-0.5 text-right tabular-nums">
                        {Number(l.discount_percent) ? formatQty(Number(l.discount_percent)) + "%" : ""}
                      </td>
                      <td className="py-0.5 text-right tabular-nums">{formatTHB(lineAmount(l))}</td>
                    </>
                  ) : (
                    <td colSpan={3} className="py-0.5 text-right italic">
                      {special}
                    </td>
                  )}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <section className="mt-3 flex justify-end border-t-2 border-foreground pt-2">
        <div className="w-72 space-y-0.5">
          {!sel && opts.length ? (
            <>
              <Sum label="MAIN ITEMS" value={formatTHB(t.base)} />
              {opts.map((o) => (
                <Sum key={o} label={`OPTION ${o}`} value={formatTHB(t.perOption[o] ?? 0)} />
              ))}
              <div className="pt-1 text-[11px] italic">Total below excludes options.</div>
            </>
          ) : null}
          <Sum label="SUB TOTAL" value={formatTHB(t.subtotal)} />
          {discount ? <Sum label="SPECIAL DISCOUNT" value={"-" + formatTHB(discount)} /> : null}
          <Sum label={`VAT ${vatPct}%`} value={formatTHB(t.vat)} />
          <Sum label="GRAND TOTAL (THB)" value={formatTHB(t.net)} bold />
        </div>
      </section>

      <section className="mt-6 space-y-3 break-inside-avoid">
        {terms.length ? (
          <div>
            <div className="font-bold">PAYMENT TERMS</div>
            <ol className="mt-1 space-y-0.5">
              {terms.map((p) => (
                <li key={p.seq}>
                  {p.seq}. {p.name} — {formatQty(Number(p.percent))}% ({formatTHB((t.net * Number(p.percent)) / 100)} THB)
                  {p.note ? ` · ${p.note}` : ""}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {q.delivery_text ? (
          <div>
            <span className="font-bold">DELIVERY: </span>
            {q.delivery_text}
          </div>
        ) : null}
        {q.notes ? (
          <div>
            <div className="font-bold">NOTES</div>
            <div className="whitespace-pre-line">{q.notes}</div>
          </div>
        ) : null}
      </section>

      <section className="mt-12 grid grid-cols-2 gap-12 text-center text-[11px] break-inside-avoid">
        <div className="border-t border-foreground pt-1">ACCEPTED BY (CUSTOMER)</div>
        <div className="border-t border-foreground pt-1">AUTHORIZED SIGNATURE · CCSE</div>
      </section>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 font-semibold">{label}</span>
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
