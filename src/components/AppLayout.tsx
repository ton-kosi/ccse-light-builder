import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  LayoutDashboard,
  FolderKanban,
  Boxes,
  Layers,
  ShoppingCart,
  Scissors,
  Users,
  Settings,
  Building2,
  ClipboardList,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe } from "@/hooks/useMe";
import { ROLE_LABELS, type AppRole } from "@/lib/erp";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

type NavItem = { to: string; label: string; icon: LucideIcon; roles: AppRole[] | "all" };

export const NAV: NavItem[] = [
  { to: "/dashboard", label: "แดชบอร์ด", icon: LayoutDashboard, roles: "all" },
  { to: "/projects", label: "โปรเจกต์", icon: FolderKanban, roles: "all" },
  { to: "/skus", label: "สต็อก", icon: Boxes, roles: ["admin", "sales", "estimator", "stock", "production", "accounting"] },
  { to: "/components", label: "ชิ้นส่วนขายและสูตร", icon: Layers, roles: ["admin", "sales", "estimator", "stock", "production", "accounting"] },
  { to: "/purchase-requests", label: "ใบขอซื้อ", icon: ShoppingCart, roles: ["admin", "stock", "production", "accounting"] },
  { to: "/remnants", label: "เศษม้วน", icon: Scissors, roles: ["admin", "stock", "production"] },
  { to: "/customers", label: "ลูกค้า", icon: Building2, roles: ["admin", "sales", "accounting"] },
  { to: "/work-orders", label: "ใบสั่งงาน", icon: ClipboardList, roles: ["admin", "production", "technician", "stock"] },
  { to: "/users", label: "ผู้ใช้งาน", icon: Users, roles: ["admin"] },
  { to: "/settings", label: "ตั้งค่า", icon: Settings, roles: ["admin"] },
];

function AppSidebar() {
  const { roles } = useMe();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const items = NAV.filter((i) => i.roles === "all" || i.roles.some((r) => roles.includes(r)));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link to="/dashboard" className="flex items-baseline gap-2 px-2 py-1">
          <span className="text-lg font-bold tracking-tight text-primary">CCSE</span>
          {!collapsed && <span className="text-xs text-muted-foreground">ERP v0</span>}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => {
                const active = pathname === item.to || pathname.startsWith(item.to + "/");
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link to={item.to}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter />
    </Sidebar>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const { me, roles } = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background text-foreground">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center gap-3 border-b border-border bg-card px-3">
            <SidebarTrigger />
            <div className="ml-auto flex items-center gap-3 text-sm">
              <div className="text-right leading-tight">
                <div className="font-medium">{me?.fullName || me?.email}</div>
                <div className="text-xs text-muted-foreground">
                  {roles.length ? roles.map((r) => ROLE_LABELS[r]).join(" · ") : "ยังไม่กำหนดสิทธิ์"}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">ออกจากระบบ</span>
              </Button>
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
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
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}
