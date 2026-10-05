import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function quoteLinesQuery(quotationId: string) {
  return {
    queryKey: ["quote_lines", quotationId] as const,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_lines")
        .select("*, sales_components(code, name, unit)")
        .eq("quotation_id", quotationId)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  };
}

export function useCurrentQuotation(projectId: string, enabled: boolean) {
  const quotation = useQuery({
    queryKey: ["quotation", projectId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotations")
        .select("*")
        .eq("project_id", projectId)
        .eq("is_current", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const qid = quotation.data?.id ?? "";
  const lines = useQuery({ ...quoteLinesQuery(qid), enabled: enabled && !!qid });
  return { quotation: quotation.data ?? null, lines: lines.data ?? [] };
}
