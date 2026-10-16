import { groupBySection, termPrintLabel } from "@/lib/clauses";

export type FooterClause = { section: string; text: string; sort_order: number };
export type FooterTerm = {
  seq: number;
  percent: number;
  fixed_amount: number | null;
  trigger: string | null;
  print_label: string | null;
};

const DEFAULT_CLOSING = "WE HOPE THAT OUR QUOTATION CAN BE OF CONSIDERABLE VALUE TO YOUR COMPANY.";

/**
 * Bottom of the printed quotation, laid out like CCSE's real quotations:
 * REMARK / WARRANTY / หมายเหตุ / WARNING → closing line →
 * left: FAITHFULLY YOURS + signer | right: TERM OF PAYMENT, VALIDITY, DELIVERY, APPROVED BY.
 * The sign-off is one block (data-pdf-keep) so neither printing nor the PDF splits it across pages.
 */
export function QuoteFooterPrint({
  companyName,
  clauses,
  legacyNotes,
  closingText,
  signerName,
  signerPosition,
  terms,
  validityDays,
  deliveryText,
}: {
  companyName: string;
  clauses: FooterClause[];
  legacyNotes: string | null;
  closingText: string | null;
  signerName: string | null;
  signerPosition: string | null;
  terms: FooterTerm[];
  validityDays: number | null;
  deliveryText: string | null;
}) {
  const groups = groupBySection(clauses);
  const legacy = (legacyNotes ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
  const delivery = (deliveryText ?? "").split("\n").filter((l) => l.trim());

  return (
    <>
      {groups.length || legacy.length ? (
        <section className="mt-4 space-y-2">
          {groups.map((g) => (
            <div key={g.value} data-pdf-keep className="break-inside-avoid">
              <div className="font-bold">{g.heading}</div>
              {g.rows.map((r, i) => (
                <div key={i} className="whitespace-pre-line pl-1">
                  - {r.text}
                </div>
              ))}
            </div>
          ))}
          {legacy.length && !groups.some((g) => g.value === "note_th") ? (
            <div data-pdf-keep className="break-inside-avoid">
              <div className="font-bold">หมายเหตุ :</div>
              {legacy.map((t, i) => (
                <div key={i} className="pl-1">
                  - {t}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section data-pdf-keep className="quote-signoff mt-4 break-inside-avoid">
        <p>{closingText?.trim() || DEFAULT_CLOSING}</p>
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-8">
          <div className="flex flex-col">
            <div>FAITHFULLY YOURS,</div>
            <div>{companyName}</div>
            <div className="mt-auto pt-14">
              {signerName?.trim() ? <div>({signerName.trim()})</div> : <div>(……………………………)</div>}
              {signerPosition?.trim() ? <div>{signerPosition.trim()}</div> : null}
            </div>
          </div>
          <div className="min-w-[62mm]">
            {terms.length ? (
              <div>
                <div>TERM OF PAYMENT:</div>
                {terms.map((t) => (
                  <div key={t.seq} className="pl-6">
                    {termPrintLabel(t)}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-1">
              {validityDays ? (
                <>
                  <span>VALIDITY :</span>
                  <span>{validityDays} DAYS</span>
                </>
              ) : null}
              {delivery.length ? (
                <>
                  <span>DELIVERY :</span>
                  <span>
                    {delivery.map((l, i) => (
                      <div key={i}>{l}</div>
                    ))}
                  </span>
                </>
              ) : null}
            </div>
            <div className="mt-4 text-center">
              <div>APPROVED BY</div>
              <div className="mt-12">(……………………………)</div>
              <div>……/……/……..</div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
