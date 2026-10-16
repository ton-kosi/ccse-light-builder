import type { Company } from "@/lib/companies";

/** Company letterhead shared by customer documents (quotation, billing). */
export function DocHeader({
  company,
  title,
  subtitle,
}: {
  company: Company;
  title?: string;
  subtitle?: string;
}) {
  return (
    <header className="border-b-2 border-foreground pb-2">
      <div className="flex items-center gap-4">
        {company.logo_data ? (
          <img
            src={company.logo_data}
            alt=""
            className="h-[22mm] w-auto max-w-[45mm] object-contain"
          />
        ) : null}
        <div className="ml-auto text-right leading-tight">
          <div className="text-[15px] font-bold">{company.name_th}</div>
          <div className="text-[13px] font-semibold">{company.name_en}</div>
          {company.tax_id ? (
            <div className="text-[11px]">เลขประจำตัวผู้เสียภาษี : {company.tax_id}</div>
          ) : null}
        </div>
      </div>
      {title ? (
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-lg font-bold tracking-wide">{title}</span>
          {subtitle ? <span className="text-[11px]">{subtitle}</span> : null}
        </div>
      ) : null}
    </header>
  );
}

/** Address / phone line printed at the bottom of customer documents. */
export function DocFooter({ company }: { company: Company }) {
  const lines = [company.address_th, company.address_en, company.contact_line].filter(
    (x): x is string => !!x?.trim(),
  );
  if (!lines.length) return null;
  return (
    <footer className="mt-8 border-t border-foreground pt-1 text-center text-[9px] leading-snug">
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </footer>
  );
}
