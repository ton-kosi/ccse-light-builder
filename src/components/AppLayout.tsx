import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/useMe";
import { ROLE_LABELS } from "@/lib/erp";
import { Button } from "@/components/ui/button";

type NavItem = { to: string; label: string; money?: boolean };

const NAV: NavItem[] = [
  { to: "/dashboard", label: "ภาพรวม" },
  { to: "/projects", label: "โปรเจกต์" },
  { to: "/customers", label: "ลูกค้า", money: true },
  { to: "/components", label: "ส่วนประกอบ & สูตร" },
  { to: "/skus", label: "คลังสินค้า (SKU)" },
  { to: "/work-orders", label: "ใบสั่งงาน" },
  { to: "/users", label: "ผู้ใช้ & สิทธิ์" },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const { me, roles, canSeeMoney, isCeo } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const items = NAV.filter((i) => {
    if (i.to === "/users") return isCeo;
    if (i.money) return canSeeMoney;
    return true;
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
          <Link to="/dashboard" className="flex items-baseline gap-2">
            <span className="text-lg font-bold tracking-tight text-primary">CCSE</span>
            <span className="text-xs text-muted-foreground">ระบบบริหารงาน (ERP) v0</span>
          </Link>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <div className="text-right leading-tight">
              <div className="font-medium">{me?.fullName || me?.email}</div>
              <div className="text-xs text-muted-foreground">
                {roles.length ? roles.map((r) => ROLE_LABELS[r]).join(" · ") : "ยังไม่กำหนดสิทธิ์"}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={handleSignOut}>
              ออกจากระบบ
            </Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-7xl flex-wrap gap-1 px-2 pb-2">
          {items.map((item) => {
            const active = pathname === item.to || pathname.startsWith(item.to + "/");
            return (
              <Link
                key={item.to}
                to={item.to}
                className={
                  "rounded-md px-3 py-1.5 text-sm transition-colors " +
                  (active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}
