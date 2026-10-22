import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/erp";

export type Me = {
  userId: string | null;
  email: string | null;
  fullName: string;
  roles: AppRole[];
};

export function meQueryKey() {
  return ["me"] as const;
}

export async function fetchMe(): Promise<Me> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return { userId: null, email: null, fullName: "", roles: [] };

  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
  ]);

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: profile?.full_name ?? "",
    roles: (roles ?? []).map((r) => r.role as AppRole),
  };
}

export function useMe() {
  const query = useQuery({ queryKey: meQueryKey(), queryFn: fetchMe, staleTime: 30_000 });
  const roles = query.data?.roles ?? [];
  const has = (...r: AppRole[]) => r.some((x) => roles.includes(x));
  return {
    ...query,
    me: query.data,
    roles,
    has,
    isAdmin: has("admin"),
    canSeeMoney: has("admin"),
    canEditQuote: has("admin", "sales"),
    canManagePayments: has("admin", "accounting"),
    canEditSales: has("admin", "sales"),
    canEditProduction: has("admin", "sales", "estimator", "stock", "production"),
    /** plan field work: job type, dates, who is assigned */
    canPlanWork: has("admin", "sales", "production"),
    canEditMaster: has("admin", "estimator", "stock"),
    canViewMaster: roles.some((r) => r !== "technician"),
    hasNoRole: query.isSuccess && roles.length === 0,
  };
}
