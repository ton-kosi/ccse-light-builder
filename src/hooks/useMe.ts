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
  const query = useQuery({
    queryKey: meQueryKey(),
    queryFn: fetchMe,
    staleTime: 30_000,
    // Right after a page load the role lookup can run before the session token is attached and
    // come back empty; look again a few times before showing "no role" (menus depend on it).
    refetchInterval: (q) =>
      q.state.data && q.state.data.roles.length === 0 && q.state.dataUpdateCount < 6 ? 2_000 : false,
  });
  const roles = query.data?.roles ?? [];
  const has = (...r: AppRole[]) => r.some((x) => roles.includes(x));
  return {
    ...query,
    me: query.data,
    roles,
    has,
    isAdmin: has("admin"),
    // Teams: sale = sales + estimator · purchase = stock · payment = accounting · production · technician
    /** BOQ cost / margin, and typing costs or selling prices by hand */
    canSeeMoney: has("admin"),
    /** latest purchase cost + purchase history: admin, purchase team, payment team (never sale / production) */
    canSeeCost: has("admin", "stock", "accounting"),
    /** sale team writes the BOQ */
    canEditQuote: has("admin", "sales", "estimator"),
    /** BOQ and selling prices: sale team, payment team read only (never purchase / production / technician) */
    canViewQuote: has("admin", "sales", "estimator", "accounting"),
    canManagePayments: has("admin", "accounting"),
    canEditSales: has("admin", "sales", "estimator"),
    /** project status, site measurements, work-order instructions and items */
    canEditProduction: has("admin", "sales", "estimator", "production"),
    /** production sheet (ใบผลิต) choices: production team */
    canEditProductionSheet: has("admin", "production"),
    /** plan field work: job type, dates, who is assigned, repair tickets */
    canPlanWork: has("admin", "sales", "estimator", "production"),
    canEditMaster: has("admin", "estimator", "stock"),
    canViewMaster: roles.some((r) => r !== "technician"),
    hasNoRole: query.isSuccess && roles.length === 0,
  };
}
