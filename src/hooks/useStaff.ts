import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/erp";

export type StaffMember = { id: string; name: string; roles: AppRole[] };

/** Everyone with a role, with display names; field staff (technician, production) first. */
export function useStaff() {
  return useQuery({
    queryKey: ["staff"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<StaffMember[]> => {
      const { data: roles, error } = await supabase.from("user_roles").select("user_id, role");
      if (error) throw error;
      const byUser = new Map<string, AppRole[]>();
      for (const r of roles) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.role as AppRole]);
      const ids = [...byUser.keys()];
      if (!ids.length) return [];
      const { data: names } = await supabase.rpc("user_display_names", { _ids: ids });
      const nameOf = new Map((names ?? []).map((n) => [n.id, n.display_name]));
      const field = (m: StaffMember) =>
        m.roles.includes("technician") ? 0 : m.roles.includes("production") ? 1 : 2;
      return ids
        .map((id) => ({ id, name: nameOf.get(id) || "ผู้ใช้", roles: byUser.get(id)! }))
        .sort((a, b) => field(a) - field(b) || a.name.localeCompare(b.name, "th"));
    },
  });
}
