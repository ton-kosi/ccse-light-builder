import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { categoryOf } from "@/lib/skuCategory";
import { isoDate } from "@/lib/jobs";
import { DEFAULT_WARRANTY_RULES, projectWarranty, warrantyStart } from "@/lib/warranty";

export const warrantyRulesKey = ["warranty_rules"];
const missing = (msg: string) => /does not exist|schema cache/i.test(msg);

type Rule = { category: string; months: number; note: string | null };

/**
 * Warranty months per SKU category. While nothing is saved (or before the migration), the
 * defaults from the quotations apply; `saved` tells whether these rows exist in the table.
 */
export function useWarrantyRules() {
  return useQuery({
    queryKey: warrantyRulesKey,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<{ rules: Rule[]; saved: boolean }> => {
      const { data, error } = await supabase.from("warranty_rules").select("category, months, note").order("category");
      if (error && !missing(error.message)) throw error;
      const rows = error ? [] : (data ?? []);
      return rows.length ? { rules: rows, saved: true } : { rules: DEFAULT_WARRANTY_RULES, saved: false };
    },
  });
}

/** A project's warranty: start (handover) and one line per product type it contains. */
export function useProjectWarranty(projectId: string) {
  const { data: rules } = useWarrantyRules();
  const q = useQuery({
    queryKey: ["project_warranty", projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const [pick, hand, log] = await Promise.all([
        supabase.rpc("wo_pick_list", { _project_id: projectId }),
        supabase.from("handovers").select("handover_date, work_orders(wo_type)").eq("project_id", projectId),
        supabase
          .from("project_status_log")
          .select("changed_at")
          .eq("project_id", projectId)
          .gte("to_status", 9)
          .order("changed_at")
          .limit(1),
      ]);
      if (pick.error) throw pick.error;
      const ids = (pick.data ?? []).map((p) => p.sku_id);
      const sk = ids.length ? await supabase.from("skus").select("id, code, name, notes").in("id", ids) : { data: [] };
      const categories = (sk.data ?? []).map((s) => categoryOf(s));
      const installs = (hand.error ? [] : (hand.data ?? []))
        .filter((h) => (h.work_orders as { wo_type: string } | null)?.wo_type === "installation")
        .map((h) => h.handover_date);
      return { categories, start: warrantyStart(installs, log.data?.[0]?.changed_at ?? null) };
    },
  });
  const ruleMap = new Map((rules?.rules ?? []).map((r) => [r.category, r.months]));
  const items = q.data ? projectWarranty(q.data.categories, ruleMap, q.data.start, isoDate(new Date())) : [];
  return { start: q.data?.start ?? null, items, isLoading: q.isLoading };
}
