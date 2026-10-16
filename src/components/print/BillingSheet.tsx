import { Fragment } from "react";
import type { Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { DocFooter, DocHeader } from "@/components/print/DocHeader";
import { billMoney, longDate, summaryOfPayment, type BillDoc } from "@/lib/billing";
import { bahtText } from "@/lib/bahtText";
import { quotationRevisionSuffix } from "@/lib/boq";
import { branchText, type Company } from "@/lib/companies";
import { formatDate, formatQty, formatTHB } from "@/lib/format";
import { buildA4Pdf } from "@/lib/pdf";

type Doc = Tables<"billing_docs">;

/** The printed INVOICE PAYMENT (ใบเบิกเงิน), laid out like the company's own forms. */
export function BillingSheet({ d, all, co }: { d: Doc; all: Doc[]; co: Company }) {
  const sum = summaryOfPayment(d as BillDoc, all as BillDoc[]);
  const m = billMoney(d as BillDoc);
  const seq = d.term_seq ?? sum.lines.length;
  const ref = `${d.quotation_ref ?? ""}${quotationRevisionSuffix(d.quotation_rev ?? "")}`;
  const num = (x: number) => (x ? formatTHB(x) : "");
  const cell = "border-x border-foreground px-1.5 align-top";

  return (
    <div className="bill-print mx-auto max-w-[210mm] bg-background p-[12mm] text-[11.5px] leading-snug text-foreground">
      <style>{`@page { size: A4; margin: 12mm; } @media print { .bill-print { padding: 0 !important; max-width: none !important; } .no-print { display: none !important; } }`}</style>
      <div className="no-print mb-4 flex justify-end gap-2">
        <Button variant="outline" onClick={() => window.print()}>
          พิมพ์
        </Button>
        <Button
          onClick={async () => {
            const el = document.querySelector(".bill-print") as HTMLElement | null;
            if (el) (await buildA4Pdf(el)).save(`${d.doc_no}.pdf`);
          }}
        >
          บันทึก PDF
        </Button>
      </div>
      {d.cancelled_at ? (
        <div className="mb-3 rounded border-2 border-destructive p-2 text-center font-bold text-destructive">
          ยกเลิกแล้ว ({formatDate(d.cancelled_at)}) — {d.cancel_reason}
        </div>
      ) : null}

      <DocHeader company={co} />

      <section className="mt-4 grid grid-cols-[1fr_auto] gap-x-6">
        <Info label="DATE:">{longDate(d.bill_date)}</Info>
        <Info label="RC NO:" right>
          {d.doc_no}
        </Info>
        <div />
        <Info label="DUE DATE:" right>
          {longDate(d.due_date)}
          {d.credit_days ? ` (${d.credit_days} DAYS)` : ""}
        </Info>
      </section>

      <section className="mt-3 space-y-0.5">
        <Info label="SUBJ:">INVOICE PAYMENT {seq}</Info>
        <Info label="PROJ:">{d.project_name ?? "-"}</Info>
        {d.po_number ? <Info label="PO NO:">{d.po_number}</Info> : null}
      </section>

      <section className="mt-3">
        <Info label="ATTN:">
          <div className="flex flex-wrap gap-x-6">
            <span className="font-semibold">{d.customer_name ?? "-"}</span>
            {d.customer_tax_id ? (
              <span>
                เลขประจำตัวผู้เสียภาษี: {d.customer_tax_id} &nbsp; {branchText(d.customer_branch)}
              </span>
            ) : null}
          </div>
          {d.customer_address ? (
            <div className="whitespace-pre-line">{d.customer_address}</div>
          ) : null}
          {d.attn ? <div>เรียน {d.attn}</div> : null}
        </Info>
      </section>

      <p className="mt-4">
        WE WOULD LIKE TO REQUEST FOR THE PAYMENT AS PER THE PROGRESS AND THE ATTACHED DETAILS.
      </p>

      <div className="mt-3 font-semibold">SUMMARY OF PAYMENT</div>
      <table className="mt-1 w-full table-fixed border-collapse border border-foreground">
        <colgroup>
          <col className="w-[10mm]" />
          <col />
          <col className="w-[25mm]" />
          <col className="w-[22mm]" />
          <col className="w-[25mm]" />
          <col className="w-[34mm]" />
        </colgroup>
        <thead className="text-center text-[10.5px]">
          <tr className="border-b border-foreground">
            <th rowSpan={2} className={cell + " align-middle font-semibold"}>
              ITEM
            </th>
            <th rowSpan={2} className={cell + " text-left font-normal"}>
              <div>{ref}</div>
              {d.quote_total_ex_vat !== null ? (
                <div>TOTAL 100% = {formatTHB(Number(d.quote_total_ex_vat))} (EX-VAT %)</div>
              ) : null}
            </th>
            <Head n="(1)">PAYMENT REQUEST</Head>
            <Head n="(2)">DEDUCT OF DEPOSIT</Head>
            <Head n="(3) = (1) - (2)">PAYABLE REQUEST</Head>
            <Head n="(4)">ACCUMULATIVE REQUEST</Head>
          </tr>
          <tr className="border-b border-foreground">
            {[0, 1, 2, 3].map((i) => (
              <th key={i} className={cell + " font-normal"}>
                (BAHT)
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {sum.lines.map((l) => (
            <tr key={l.id} className={l.current ? "font-semibold" : ""}>
              <td className={cell + " pt-1.5 text-center"}>{l.item}</td>
              <td className={cell + " pt-1.5"}>{l.description}</td>
              <td className={cell + " pt-1.5 text-right"}>{num(l.request)}</td>
              <td className={cell + " pt-1.5 text-right"}>
                {l.deduct ? `-${formatTHB(l.deduct)}` : ""}
              </td>
              <td className={cell + " pt-1.5 text-right"}>{l.current ? num(l.payable) : ""}</td>
              <td className={cell + " pt-1.5 text-right"}>{num(l.payable)}</td>
            </tr>
          ))}
          <tr className="h-[22mm]">
            {[0, 1, 2, 3, 4].map((i) => (
              <td key={i} className={cell} />
            ))}
            <td className="border-x border-foreground px-1.5 align-bottom">
              <div className="flex justify-between pb-1 font-semibold">
                <span>TOTAL</span>
                <span>{formatTHB(sum.accumulated)}</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <section data-pdf-keep className="mt-3 grid grid-cols-[1fr_auto] gap-x-6">
        <div className="space-y-0.5 pl-[25%]">
          <Money label="TOTAL" value={formatTHB(m.total)} />
          <Money label={`VAT ${formatQty(m.vatPercent)}%`} value={formatTHB(m.vat)} />
          {m.wht ? (
            <>
              <Money label="GRAND TOTAL" value={formatTHB(m.grand)} />
              <Money
                label={`Withholding tax ${formatQty(m.whtPercent)}%`}
                value={`(${formatTHB(m.wht)})`}
              />
            </>
          ) : null}
          <Money label="THIS TIME PAYMENT" value={formatTHB(m.pay)} bold />
          <div className="pt-1 text-right text-[10.5px]">({bahtText(m.pay)})</div>
        </div>
        <div />
      </section>

      <section data-pdf-keep className="mt-6 break-inside-avoid">
        <p>THANK YOU VERY MUCH FOR YOUR APPROVAL</p>
        <p className="mt-3">FAITHFULLY YOURS,</p>
        <p>{co.name_en}</p>
        <div className="mt-14">
          <div>({co.signer_name?.trim() || "……………………………"})</div>
          {co.signer_title ? <div>{co.signer_title}</div> : null}
        </div>
      </section>

      <section data-pdf-keep className="mt-6 grid grid-cols-2 gap-x-6 break-inside-avoid">
        {co.bank_account_no ? (
          <>
            <Bank
              rows={[
                ["Bank :", [co.bank_name_en, co.bank_branch_en].filter(Boolean).join(" ,  ")],
                ["Account Name :", co.bank_account_name_en ?? ""],
                ["Account Number :", co.bank_account_no],
              ]}
            />
            <Bank
              rows={[
                [
                  "ธนาคาร :",
                  [co.bank_name_th, co.bank_branch_th ? `สาขา ${co.bank_branch_th}` : null]
                    .filter(Boolean)
                    .join("  "),
                ],
                ["ชื่อบัญชี :", co.bank_account_name_th ?? ""],
                ["เลขบัญชี :", co.bank_account_no],
              ]}
            />
          </>
        ) : (
          <div className="no-print text-destructive">
            ยังไม่ได้ใส่บัญชีธนาคารของบริษัทนี้ (ตั้งค่า → บริษัท)
          </div>
        )}
      </section>

      <DocFooter company={co} />
    </div>
  );
}

function Info({
  label,
  children,
  right,
}: {
  label: string;
  children: React.ReactNode;
  right?: boolean;
}) {
  return (
    <div className={"flex gap-2 " + (right ? "justify-end" : "")}>
      <span className={(right ? "w-[19mm]" : "w-14") + " shrink-0 font-semibold"}>{label}</span>
      <div className={right ? "min-w-[28mm] text-right" : "flex-1"}>{children}</div>
    </div>
  );
}

function Head({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <th className="border-x border-foreground px-1 align-top font-normal">
      <div className="text-left text-[9px]">{n}</div>
      <div className="font-semibold">{children}</div>
    </th>
  );
}

function Money({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={"grid grid-cols-[1fr_32mm] " + (bold ? "font-bold" : "")}>
      <span className="text-center">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

function Bank({ rows }: { rows: [string, string][] }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <span>{k}</span>
          <span>{v}</span>
        </Fragment>
      ))}
    </div>
  );
}
