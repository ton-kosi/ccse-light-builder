/**
 * Keeps Jedi flex prices equal per metre for the same model across one quotation: after a Jedi
 * flex set is saved or a line is deleted, every run line of that roll family is re-priced from
 * the rolls all those runs need together.
 */
import { supabase } from "@/integrations/supabase/client";
import { partPriceMap } from "@/lib/fo";
import { familyPrice, neonFamilies, type NeonFamily, type NeonItem } from "@/lib/neon";

export const NEON_SKU_KEY = ["skus", "neon"];
export const NEON_SKU_COLUMNS =
  "id, code, name, unit, notes, is_roll, roll_family, roll_length_m, cut_step_cm, max_piece_m";

export async function loadNeonFamilies(): Promise<NeonFamily[]> {
  const [s, c] = await Promise.all([
    supabase.from("skus").select(NEON_SKU_COLUMNS).eq("is_roll", true),
    supabase.from("sales_components").select("id, roll_family, is_roll_product").eq("is_roll_product", true),
  ]);
  if (s.error) throw s.error;
  if (c.error) throw c.error;
  return neonFamilies(s.data, c.data);
}

type Line = { id: string; component_id: string | null; cut_lengths: number[] | null; qty: number | null };
type Rec = { quote_line_id: string; sku_id: string; qty: number; note: string | null };

/** Run lines of one family as pricing items (accessories from their ENDCAP / MOUNT materials). */
export function itemsFromLines(componentId: string, lines: Line[], recipes: Rec[], skip = new Set<string>()): NeonItem[] {
  return lines
    .filter((l) => l.component_id === componentId && !skip.has(l.id))
    .map((l) => ({
      lengths: (l.cut_lengths?.length ? l.cut_lengths : [Number(l.qty ?? 0)]).map(Number).filter((x) => x > 0),
      extras: recipes
        .filter((r) => r.quote_line_id === l.id && / (ENDCAP|MOUNT)\b/.test(r.note ?? ""))
        .map((r) => ({ skuId: r.sku_id, qty: Number(r.qty) })),
    }));
}

export async function loadQuotationRuns(quotationId: string) {
  const { data: lines, error } = await supabase
    .from("quote_lines")
    .select("id, component_id, cut_lengths, qty, unit_price, sort_order")
    .eq("quotation_id", quotationId);
  if (error) throw error;
  const ids = lines.map((l) => l.id);
  const { data: recipes, error: e2 } = ids.length
    ? await supabase.from("line_recipes").select("quote_line_id, sku_id, qty, note").in("quote_line_id", ids)
    : { data: [], error: null };
  if (e2) throw e2;
  return {
    lines: lines as (Line & { unit_price: number | null; sort_order: number })[],
    recipes: (recipes ?? []) as Rec[],
  };
}

export const ROLLS_NOTE = "NEO ROLLS";

/**
 * Re-prices every Jedi flex run line in the quotation and rewrites the rolls it needs (whole 5 m /
 * 10 m rolls per family, kept as materials on the family's first run line so stock reserves and
 * orders whole rolls). Returns how many lines changed price.
 */
export async function rebalanceNeon(quotationId: string): Promise<number> {
  const [families, runs, r, p] = await Promise.all([
    loadNeonFamilies(),
    loadQuotationRuns(quotationId),
    supabase.from("recipes").select("component_id, sku_id, qty_per_unit"),
    supabase.from("component_prices").select("component_id, list_price, max_discount_percent"),
  ]);
  if (r.error) throw r.error;
  if (p.error) throw p.error;
  const prices = partPriceMap(r.data, p.data);
  let changed = 0;
  const rollRows: { quote_line_id: string; sku_id: string; qty: number; note: string }[] = [];
  for (const f of families) {
    if (!f.componentId) continue;
    const mine = runs.lines
      .filter((l) => l.component_id === f.componentId)
      .sort((a, b) => a.sort_order - b.sort_order);
    if (!mine.length) continue;
    const fp = familyPrice(f, itemsFromLines(f.componentId, runs.lines, runs.recipes), prices);
    const count = new Map<string, number>();
    for (const roll of fp.rolls) count.set(roll.skuId, (count.get(roll.skuId) ?? 0) + 1);
    for (const [skuId, qty] of count)
      rollRows.push({ quote_line_id: mine[0]!.id, sku_id: skuId, qty, note: `${ROLLS_NOTE} ${f.family}` });
    const stale = mine.filter((l) => Number(l.unit_price) !== fp.perM).map((l) => l.id);
    if (!stale.length) continue;
    const { error } = await supabase.from("quote_lines").update({ unit_price: fp.perM }).in("id", stale);
    if (error) throw error;
    changed += stale.length;
  }
  // replace the rolls of the whole quotation
  const ids = runs.lines.map((l) => l.id);
  if (ids.length) {
    const { error } = await supabase
      .from("line_recipes")
      .delete()
      .in("quote_line_id", ids)
      .like("note", `${ROLLS_NOTE}%`);
    if (error) throw error;
  }
  if (rollRows.length) {
    const { error } = await supabase.from("line_recipes").insert(rollRows);
    if (error) throw error;
  }
  return changed;
}
