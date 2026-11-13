import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "@/lib/fetchAll";

/** Customer names for every role (technicians can't read the customers table). */
export function useCustomerNames() {
  const { data } = useQuery({
    queryKey: ["customer_names"],
    staleTime: 60_000,
    queryFn: async () => {
      // more than one page of customers since the import from the old system
      const data = await fetchAll<{ id: string; name: string }>((from, to) => supabase.rpc("customer_names").range(from, to));
      return new Map(data.map((c) => [c.id, c.name]));
    },
  });
  return (customerId: string | null | undefined, joined?: unknown): string | null => {
    const j = joined as { name?: string } | null | undefined;
    return j?.name ?? (customerId ? data?.get(customerId) ?? null : null);
  };
}
