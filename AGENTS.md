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

- Keep initial revision A internally; centralize its visible suffix in the BOQ helper to preserve revision copying.
- Quotation preview/PDF share a print view and cut formatting; fit description lines to measured column width while preserving manual breaks.
- BOQ uses a fixed colgroup measured from visible controls, labels, text and buttons in their rendered fonts; remeasure on input/data changes without input-length limits.
- SKU categories/attributes are leading `[key: value]` notes tags (`skuCategory.ts`, `skuAttrs.ts`); screens strip tags, builders prefer them over name fallbacks and filter by category.
- Collections: `payment_followups` belongs to bills; its trigger derives project/user, payment roles only. `collections.ts`, `payments/Followups.tsx`, `/collections`, `/print/reminder/$billId?notice=1|2|3`; open bills come from `payment_schedule` with bill_id and outstanding > 0.
- Warranty: `warranty.ts`/`useWarranty.ts` use `warranty_rules` by SKU category, falling back to `DEFAULT_WARRANTY_RULES` while empty; no migration seeds. Start at last installation handover else first status >= 9; categories come from wo_pick_list. Repairs UI: `repairs/Repairs.tsx`, `/repairs`; tickets save coverage/end at creation and link service/production jobs or new quote projects.
- Repair numbers SR<BEyy>-NNNN are trigger-generated with a column default so generated insert types accept omitted numbers; never require app-generated numbers.
- Materials: round 1 uses `confirm_material_issue`; extra issues/returns use `material_moves`, whose trigger requires round 1, caps returns at issued minus returned and posts stock. `materials.ts`, `work/MaterialSection.tsx`, `/print/materials/$projectId`.
- Production calculations live in `production.ts`: exactStep cut rounding, profile/shrink/clips/bars/amps/PSU rules. `useProduction.ts` gets LED from line_recipes else recipes (non-roll with cut_step_cm or LED ribbon category), profile by category, pieces from measured cut_spec/cut_lengths else BOQ. Settings key is (project_id,item_no); `work/ProductionSheet.tsx`, `/print/production/$projectId`, `/print/stickers/$projectId`.
- Crew assignments use `crew_members` (optional plain UUID user_id) and `work_order_crew`, not legacy work_order_assignees. Non-job cells use schedule_entries. public_holidays/private.working_days drive handover install days and jobs.ts mirrors them. Preserve typed cut_spec via cutSpec.ts; WOS fields site_contacts/schedule_note, print `/print/wos/$projectId`.
- Measurements: one site_measurements per quote_line_id, no prices, all staff. Revision copying uses ccse.copy_measurements to preserve measurer. Final Rev copies measured quantities/cuts; last is_balance term bills total minus other terms (max one balance per quote). `measure.ts`, `work/MeasureSection.tsx`, `boq/FinalRevPanel.tsx`.
- Field jobs support survey/multi-day end_date. job_files uses private job-files bucket and project/<workOrder|project>/<uuid>.<ext> paths (jobs.ts/work/JobFiles.tsx). One handover per job; trigger closes it and on last open installation sets actual days and project 6–8 to 9. Handover UI only on installation/service; starting an installation job (in_progress) moves project 6–7 to 8 (0022). Dashboard top uses `TodayPanel.tsx`. `/queue`, `/print/handover/$woId`; missing schema falls back gracefully.
- LED strips: non-roll with cut_step_cm only; neon flex uses roll fields. Profiles rules live in profiles.ts; linear config fields stay optional for older blocks.
- Purchases triggers receive stock/requests and refresh latest sku_costs including extra_cost/qty. Admin edits post stock adjustments and recalculate cost; request link and request SKU remain fixed. SQL: purchases.sql/purchases_edit.sql.
- Clipso uses clipso.ts for roll width, allowances, tracks and optional lighting; tag recipes CLP <blockId> to retain builder identity.
- Neon uses neon.ts to pack whole family runs into rolls without joined offcuts; neonSync.ts rebalances/reprices after save/delete. Hidden RF-<family> components with cut_lengths retain roll-plan/remnant integration. NEO ROLLS <family> recipes sit on the first run; project_demand stops counting them once roll plans exist and RF per-metre recipes stay removed (neon_rolls.sql).
- Privacy film calculations live in film.ts: price on cutting size, sheet limits, per-piece busbar side/type, location watt-based transformers; recipes tagged PVF <blockId>.
- Quotation totals in boq.ts apply discount, running-total adjustments (%/amount/note), then VAT; vat_mode only changes printing. private.payment_quote mirrors them (quote_totals.sql).
- Internal quote lines are work-only notes: no customer print, prices or material demand. BOQ has no cut-length column; neon still writes cut_lengths.
- Companies: quotations.company_id selects public.companies; bills snapshot issuer letterhead/tax/bank/signer/WHT/logo. companies.ts has missing-table fallback; companies_billing.sql preserves full revision copying.
- BillingSheet.tsx prints INVOICE PAYMENT, Thai-year/MMDD daily RC counter, earlier bill summary, ex-VAT request then VAT/WHT/net. Once billed, payment_schedule.amount is bill grand_total.
