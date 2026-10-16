<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep initial revision A stored internally and centralize its visible suffix in the BOQ helper; this preserves revision copying without schema changes.
- Quotation preview and PDF share the same print view and cut-length formatting to keep customer documents consistent.
- Fit individual quotation description lines to their measured print-column width while preserving manual line breaks; this prevents unwanted wrapping on A4 documents.
- Measure every BOQ column from visible controls, selected labels, text, and buttons using their rendered fonts and a fixed colgroup; remeasure on live input and data changes to fit longest lines without restricting input lengths.
- SKU stock categories and per-category fields (LED W/m, chip, PCB width, EZ clip; profile model; rail size; PSU watt/dim) are stored as `[key: value]` tags at the start of `skus.notes` (see `src/lib/skuCategory.ts`, `src/lib/skuAttrs.ts`); screens strip the tags, builders read the tags first and the SKU name only as a fallback, and only offer SKUs of the matching category.
- LED profile rules (Jedi % per LED/profile, sizes by mounting/trim, 3/8 vs 4/8 rail, PCB > 10 mm not in W13/45° Reverse) live in `src/lib/profiles.ts`; the linear builder stores the choices on its config (optional fields, older blocks still open).
- Purchase history lives in `public.purchases` (SQL in `docs/sql/purchases.sql`, applied through Lovable): each insert receives stock (or receives its purchase request) and sets `sku_costs` to the latest purchase cost (price + extra cost ÷ qty).
- Clipso stretch-ceiling rules (fabric 3.4/5.1 m × 50 m rolls, +10 cm per side, strips across the roll width, charge = roll width × cut length, CC/CW track in 2 m lengths, optional LED above at 1.5 × cavity depth) live in `src/lib/clipso.ts`; blocks are tagged `CLP <blockId>` in line_recipes like the linear builder.
- Jedi flex (neon flex) is sold by the roll: `src/lib/neon.ts` packs every run of a roll family in the quotation into 5/10 m rolls (no joining offcuts) and gives all those lines the same price per metre (`src/lib/neonSync.ts` re-prices after save/delete). Run lines point at a hidden roll component `RF-<family>` and carry `cut_lengths`, so the existing work-order roll plan and remnants flow handle cutting and leftovers.
- Jedi flex whole-roll demand: `rebalanceNeon` writes the rolls each quotation needs as line_recipes noted `NEO ROLLS <family>` on the family's first run line; `docs/sql/neon_rolls.sql` (via Lovable) makes `private.project_demand` drop them once a work-order roll plan exists and removes the per-metre recipes of `RF-` components.
- Privacy film (PDLC) builder in `src/lib/film.ts`: per-m² price on the cutting size (no separate calculation size), max sheet 1.5 x 3 m, busbar single/double on the width or height side per piece, transformers per location by watts (tag `PVF <blockId>`).
- Quotation totals: `computeTotals`/`chain`/`summaryRows` in `src/lib/boq.ts` apply special discount → `quotations.adjustments` (contract lines: % on the running total, fixed amount, or note) → VAT; `quotations.vat_mode` only changes how VAT is printed (show / "EXCLUDING VAT x%" / none), the money still includes `vat_percent`. `private.payment_quote` mirrors this (`docs/sql/quote_totals.sql`).
- `quote_lines.kind = 'internal'` = note for the work sheet only: never printed for the customer, no price, not in material demand. The BOQ grid has no cut-length column any more (Jedi flex sets still write `cut_lengths`).
- Two issuing companies live in `public.companies` (`ccse` = ชิงชัยและบุตรวิศวกรรม, `one` = วรรณวิศวกรรม / One Engineering): letterhead, tax id, bank, bill signer, default withholding tax, logo (data URL). `quotations.company_id` picks one; bills copy it. `src/lib/companies.ts` falls back to a built-in copy when the table is missing. SQL: `docs/sql/companies_billing.sql` (also restores the full `create_quotation_revision`, which `quote_totals.sql` had cut down).
- Billing docs print as "INVOICE PAYMENT" (`src/components/print/BillingSheet.tsx`): RC NO = Thai year-MMDD+day counter, summary of payment lists the project's earlier bills, ex-VAT request → VAT → withholding tax → THIS TIME PAYMENT. Once billed, `payment_schedule.amount` = the bill's grand total.
