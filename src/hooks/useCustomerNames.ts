import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Customer names for every role (technicians can't read the customers table). */
export function useCustomerNames() {
  const { data } = useQuery({
    queryKey: ["customer_names"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("customer_names");
      if (error) throw error;
      return new Map((data ?? []).map((c) => [c.id, c.name]));
    },
  });
  return (customerId: string | null | undefined, joined?: unknown): string | null => {
    const j = joined as { name?: string } | null | undefined;
    return j?.name ?? (customerId ? data?.get(customerId) ?? null : null);
  };
}
