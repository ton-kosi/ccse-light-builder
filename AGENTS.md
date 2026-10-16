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
