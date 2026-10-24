import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const holidaysKey = ["public_holidays"];

/** Public holidays by date (yyyy-mm-dd → name); empty until the migration is applied. */
export function useHolidays() {
  return useQuery({
    queryKey: holidaysKey,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("public_holidays").select("day, name").order("day");
      if (error) {
        if (/does not exist|schema cache/i.test(error.message)) return new Map<string, string>();
        throw error;
      }
      return new Map(data.map((h) => [h.day, h.name]));
    },
  });
}
