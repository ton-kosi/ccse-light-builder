import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { blockConfigs, type WosRecipe, type WosSku } from "@/lib/wos";

/** Real materials of builder lines, for the work sheets. No prices. */
export function useWosParts(projectId: string, lineIds: string[]) {
  const { data } = useQuery({
    queryKey: ["wos_parts", projectId, lineIds.join(",")],
    enabled: lineIds.length > 0,
    queryFn: async () => {
      const { data: rec, error } = await supabase
        .from("line_recipes")
        .select("quote_line_id, sku_id, qty, note")
        .in("quote_line_id", lineIds);
      if (error) throw error;
      const ids = [...new Set((rec ?? []).map((r) => r.sku_id))];
      const { data: sk, error: e2 } = ids.length
        ? await supabase.from("skus").select("id, code, name, unit").in("id", ids)
        : { data: [] as WosSku[], error: null };
      if (e2) throw e2;
      const byLine = new Map<string, WosRecipe[]>();
      for (const r of rec ?? []) byLine.set(r.quote_line_id, [...(byLine.get(r.quote_line_id) ?? []), r]);
      return { byLine, all: (rec ?? []) as WosRecipe[], skus: new Map((sk ?? []).map((s) => [s.id, s as WosSku])) };
    },
  });
  return {
    recipesOf: (id: string) => data?.byLine.get(id) ?? [],
    skuOf: (id: string) => data?.skus.get(id),
    configs: blockConfigs(data?.all ?? []),
  };
}
