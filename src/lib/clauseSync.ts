import { supabase } from "@/integrations/supabase/client";
import { neededClauseIds } from "@/lib/clauses";

/**
 * Brings a quotation's notes & warranty in line with its lines: adds needed clauses (marked "new"
 * if the quote already had some) and removes unneeded ones that were not edited by hand.
 */
export async function syncQuotationClauses(quotationId: string, selectedOption: string | null) {
  const { data: lines, error: e1 } = await supabase
    .from("quote_lines")
    .select("id, component_id, option_name, kind")
    .eq("quotation_id", quotationId);
  if (e1) throw e1;
  const lineIds = lines.map((l) => l.id);
  const [lr, rc, cc, cl, existing] = await Promise.all([
    lineIds.length
      ? supabase.from("line_recipes").select("quote_line_id, sku_id").in("quote_line_id", lineIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("recipes").select("component_id, sku_id"),
    supabase.from("component_clauses").select("component_id, clause_id"),
    supabase.from("quote_clauses").select("id, active, always_include, section, text, sort_order"),
    supabase
      .from("quotation_clauses")
      .select("id, clause_id, edited, sort_order")
      .eq("quotation_id", quotationId),
  ]);
  for (const r of [lr, rc, cc, cl, existing]) if (r.error) throw r.error;

  const need = neededClauseIds({
    lines,
    selectedOption,
    lineRecipes: lr.data ?? [],
    recipes: rc.data ?? [],
    componentClauses: cc.data ?? [],
    clauses: cl.data ?? [],
  });
  const have = existing.data ?? [];
  const stale = have
    .filter((h) => h.clause_id && !h.edited && !need.has(h.clause_id))
    .map((h) => h.id);
  if (stale.length) {
    const { error } = await supabase.from("quotation_clauses").delete().in("id", stale);
    if (error) throw error;
  }
  const present = new Set(have.map((h) => h.clause_id));
  const add = (cl.data ?? [])
    .filter((c) => need.has(c.id) && !present.has(c.id))
    .sort((a, b) => a.sort_order - b.sort_order || a.text.localeCompare(b.text));
  if (add.length) {
    const base = Math.max(0, ...have.map((h) => h.sort_order));
    const { error } = await supabase.from("quotation_clauses").insert(
      add.map((c, i) => ({
        quotation_id: quotationId,
        clause_id: c.id,
        section: c.section,
        text: c.text,
        sort_order: base + i + 1,
        is_new: have.length > 0,
      })),
    );
    if (error) throw error;
  }
}
