import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const measurementsKey = (projectId: string) => ["site_measurements", projectId];

/** Measurements of a project by BOQ line id (empty until the migration is applied). */
export function useMeasurements(projectId: string) {
  return useQuery({
    queryKey: measurementsKey(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("site_measurements")
        .select("*")
        .eq("project_id", projectId);
      if (error) {
        if (/does not exist|schema cache/i.test(error.message)) return new Map<string, Measurement>();
        throw error;
      }
      return new Map(data.map((m) => [m.quote_line_id, m]));
    },
  });
}
export type Measurement = {
  quote_line_id: string;
  measured_qty: number | null;
  cut_lengths: number[] | null;
  note: string | null;
  measured_at: string;
};
