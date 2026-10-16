import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useLayoutEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { kindText } from "@/components/boq/BoqGrid";
import {
  adjustmentsOf,
  computeTotals,
  isCustomerLine,
  lineAmount,
  optKey,
  optionNames,
  quotationRevisionSuffix,
  summaryRows,
  vatModeOf,
  type QuoteSettings,
  type SummaryRow,
} from "@/lib/boq";
import { Button } from "@/components/ui/button";
import { DocFooter, DocHeader } from "@/components/print/DocHeader";
import { companyOf, useCompanies } from "@/lib/companies";
import { QuoteFooterPrint } from "@/components/print/QuoteFooterPrint";
import { buildA4Pdf } from "@/lib/pdf";
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
  (await buildA4Pdf(el)).save(filename);
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
        el.style.fontSize = `${(base * el.clientWidth) / el.scrollWidth}px`;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    document.fonts.ready.then(fit);
    return () => observer.disconnect();
  }, [children]);
  return (
    <div ref={ref} className={"min-h-[1lh] whitespace-pre " + (bold ? "font-bold" : "")}>
      {children || "\u00a0"}
    </div>
  );
}

function PrintQuotation() {
  const { quotationId } = Route.useParams();
  const companies = useCompanies();
  const { data, isLoading } = useQuery({
    queryKey: ["print_quotation", quotationId],
    queryFn: async () => {
      const { data: q, error } = await supabase
        .from("quotations")
        .select(
          "*, projects(code, name, attn, site_address, selected_option, customers(name, address))",
        )
        .eq("id", quotationId)
        .maybeSingle();
      if (error) throw error;
      if (!q) return null;
      const [{ data: lines }, { data: terms }, { data: clauses }] = await Promise.all([
        supabase
          .from("quote_lines")
          .select(
            "id, sort_order, option_name, zone, item_no, kind, customer_text, circuit_note, cut_lengths, qty, unit, unit_price, discount_percent, sales_components(name)",
          )
          .eq("quotation_id", quotationId)
          .order("sort_order"),
        supabase
          .from("payment_terms")
          .select("seq, percent, fixed_amount, trigger, print_label")
          .eq("quotation_id", quotationId)
          .order("seq"),
        supabase
          .from("quotation_clauses")
          .select("section, text, sort_order")
          .eq("quotation_id", quotationId)
          .eq("included", true)
          .order("sort_order"),
      ]);
      return { q, lines: lines ?? [], terms: terms ?? [], clauses: clauses ?? [] };
    },
  });

  if (isLoading) return <p className="p-8 text-sm">กำลังโหลด...</p>;
  if (!data)
    return (
      <p className="p-8 text-sm">
        ไม่พบใบเสนอราคา หรือคุณไม่มีสิทธิ์ดู (กรุณาเข้าสู่ระบบด้วยบัญชีผู้ดูแลระบบ)
      </p>
    );

  const { q, terms, clauses } = data;
  const lines = data.lines.filter(isCustomerLine);
  const project = q.projects as {
    code: string;
    name: string;
    attn: string | null;
    site_address: string | null;
    selected_option: string | null;
    customers: { name: string; address: string | null } | null;
  } | null;
  const company = companyOf(companies, q.company_id);
  const sel = project?.selected_option ?? null;
  const printed = sel ? lines.filter((l) => optKey(l) === "" || optKey(l) === sel) : lines;
  const opts = optionNames(lines);
  const discount = Number(q.discount ?? 0);
  const vatPct = Number(q.vat_percent ?? 0);
  const settings: QuoteSettings = {
    discount,
    vatPercent: vatPct,
    vatMode: vatModeOf(q.vat_mode),
    adjustments: adjustmentsOf(q.adjustments),
  };
  const t = computeTotals(lines, discount, vatPct, sel, settings.adjustments);
  // no option chosen yet: one total per option (main items + that option), like "TOTAL OPTION A / B"
  const perOption =
    !sel && opts.length
      ? opts.map((o) => ({ o, rows: summaryRows(t.base + (t.perOption[o] ?? 0), settings) }))
      : null;

  let lastOpt = "";
  return (
    <div className="quote-print mx-auto max-w-[210mm] bg-background p-[12mm] text-[12px] leading-snug text-foreground">
      <style>{`@page { size: A4; margin: 12mm; } @media print { .quote-print { padding: 0 !important; max-width: none !important; } .no-print { display: none !important; } tr { break-inside: avoid; } }`}</style>
      <div className="no-print mb-4 flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => window.print()}
          className="h-9 rounded-md border border-input bg-background px-4 text-sm"
        >
          พิมพ์
        </Button>
        <Button
          onClick={() =>
            savePdf(`${q.ref_no}${quotationRevisionSuffix(q.rev) ? `-Rev${q.rev}` : ""}.pdf`)
          }
          className="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground"
        >
          บันทึก PDF
        </Button>
      </div>

      <DocHeader company={company} title="QUOTATION" subtitle="ใบเสนอราคา" />

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
                    {l.zone?.trim() ? (
                      <FittedDescriptionLine bold>{l.zone.trim()}</FittedDescriptionLine>
                    ) : null}
                    {desc.split("\n").map((text, index) => (
                      <FittedDescriptionLine key={index} bold={heading}>
                        {text}
                      </FittedDescriptionLine>
                    ))}
                    {l.circuit_note?.trim() ? (
                      <FittedDescriptionLine>{`- ${l.circuit_note.trim()}`}</FittedDescriptionLine>
                    ) : null}
                    {l.cut_lengths?.length ? (
                      <div className="mt-1 text-[11px] font-normal">
                        <FittedDescriptionLine>{`- ${l.cut_lengths.map((length) => `${Number(length).toFixed(2)}m`).join(" + ")}`}</FittedDescriptionLine>
                      </div>
                    ) : null}
                  </td>
                  <td className="py-0.5 text-right tabular-nums">
                    {showQty ? formatQty(Number(l.qty)) : ""}
                  </td>
                  <td className="py-0.5 pl-2">{showQty ? (l.unit ?? "") : ""}</td>
                  {priced ? (
                    <>
                      <td className="py-0.5 text-right tabular-nums">
                        {formatTHB(Number(l.unit_price ?? 0))}
                      </td>
                      <td className="py-0.5 text-right tabular-nums">
                        {Number(l.discount_percent)
                          ? formatQty(Number(l.discount_percent)) + "%"
                          : ""}
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

      <section
        data-pdf-keep
        className="mt-3 flex justify-end border-t-2 border-foreground pt-2 break-inside-avoid"
      >
        <div className="w-72 space-y-0.5">
          {perOption ? (
            <>
              <Sum label="MAIN ITEMS" value={formatTHB(t.base)} />
              {opts.map((o) => (
                <Sum key={o} label={`OPTION ${o}`} value={formatTHB(t.perOption[o] ?? 0)} />
              ))}
              {perOption.map(({ o, rows }) =>
                rows.filter((r) => typeof r.value === "number").length === 1 ? (
                  <SumRow key={o} row={{ ...rows[0]!, label: `TOTAL OPTION ${o}` }} />
                ) : (
                  <Fragment key={o}>
                    <div className="pt-2 font-bold underline">OPTION {o}</div>
                    {rows
                      .filter((r) => !r.label.startsWith("("))
                      .map((r, i) => (
                        <SumRow key={i} row={r} />
                      ))}
                  </Fragment>
                ),
              )}
              {perOption[0]!.rows
                .filter((r) => r.label.startsWith("("))
                .map((r, i) => (
                  <SumRow key={i} row={r} />
                ))}
            </>
          ) : (
            summaryRows(t.subtotal, settings).map((r, i) => <SumRow key={i} row={r} />)
          )}
        </div>
      </section>

      <QuoteFooterPrint
        companyName={company.short_en}
        clauses={clauses}
        legacyNotes={q.notes}
        closingText={q.closing_text}
        signerName={q.signer_name}
        signerPosition={q.signer_position}
        terms={terms.map((p) => ({
          ...p,
          percent: Number(p.percent),
          fixed_amount: p.fixed_amount === null ? null : Number(p.fixed_amount),
        }))}
        validityDays={q.validity_days}
        deliveryText={q.delivery_text}
      />
      <DocFooter company={company} />
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

function SumRow({ row }: { row: SummaryRow }) {
  if (row.value === "")
    return <div className={"text-center " + (row.italic ? "italic" : "")}>{row.label}</div>;
  return (
    <div
      className={
        "flex justify-between gap-3 " +
        (row.bold ? "border-t border-foreground pt-1 font-bold" : "")
      }
    >
      <span>{row.label}</span>
      <span className={"tabular-nums " + (row.italic ? "italic" : "")}>
        {typeof row.value === "number"
          ? row.value < 0
            ? "-" + formatTHB(-row.value)
            : formatTHB(row.value)
          : row.value}
      </span>
    </div>
  );
}

function Sum({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div
      className={
        "flex justify-between " + (bold ? "border-t border-foreground pt-1 font-bold" : "")
      }
    >
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
