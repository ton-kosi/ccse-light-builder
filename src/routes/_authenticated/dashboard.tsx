import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useMe, meQueryKey } from "@/hooks/useMe";
import { PROJECT_STATUSES, statusLabel } from "@/lib/erp";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "ภาพรวมงาน | CCSE ERP" },
      { name: "description", content: "สรุปจำนวนงานตามสถานะ และงานที่เคลื่อนไหวล่าสุด" },
      { property: "og:title", content: "ภาพรวมงาน | CCSE ERP" },
      { property: "og:description", content: "สรุปจำนวนงานตามสถานะของ CCSE" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { me, roles, hasNoRole } = useMe();
  const queryClient = useQueryClient();

  // make sure a profile row exists for this user
  useEffect(() => {
    if (!me?.userId) return;
    if (me.fullName) return;
    supabase.auth.getUser().then(({ data }) => {
      const name = (data.user?.user_metadata as { full_name?: string } | undefined)?.full_name ?? "";
      supabase
        .from("profiles")
        .upsert({ id: me.userId!, full_name: name })
        .then(() => queryClient.invalidateQueries({ queryKey: meQueryKey() }));
    });
  }, [me?.userId, me?.fullName, queryClient]);

  const { data: projects } = useQuery({
    queryKey: ["projects", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, code, name, status, updated_at, customers(name)")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: woCount } = useQuery({
    queryKey: ["work_orders", "count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("work_orders")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  async function claimCeo() {
    const { data, error } = await supabase.rpc("claim_ceo");
    if (error) { toast.error(error.message); return; }
    if (data) {
      toast.success("รับสิทธิ์ผู้บริหาร (CEO) เรียบร้อย");
      queryClient.invalidateQueries({ queryKey: meQueryKey() });
    } else {
      toast.error("มีผู้ใช้สิทธิ์ CEO อยู่แล้ว กรุณาให้ CEO กำหนดสิทธิ์ให้คุณ");
    }
  }

  const byStatus = PROJECT_STATUSES.map((s) => ({
    ...s,
    count: (projects ?? []).filter((p) => p.status === s.value).length,
  }));

  return (
    <div>
      <PageHeader
        title="ภาพรวมงาน"
        description={`สวัสดี ${me?.fullName || me?.email || ""}`}
      />

      {hasNoRole ? (
        <div className="mb-6 rounded-lg border border-border bg-card p-4">
          <p className="text-sm">
            บัญชีนี้ยังไม่ได้กำหนดสิทธิ์ จึงดูข้อมูลได้จำกัด — ถ้าคุณเป็นผู้ตั้งระบบคนแรก
            กดรับสิทธิ์ผู้บริหารได้เลย
          </p>
          <Button className="mt-3" size="sm" onClick={claimCeo}>
            รับสิทธิ์ผู้บริหาร (CEO)
          </Button>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="โปรเจกต์ทั้งหมด" value={projects?.length ?? 0} />
        <StatCard
          label="งานที่ยังไม่ถึงขั้นปล่อยใบ Work"
          value={(projects ?? []).filter((p) => p.status < 6).length}
        />
        <StatCard
          label="งานกำลังผลิต/ติดตั้ง"
          value={(projects ?? []).filter((p) => p.status >= 7 && p.status <= 8).length}
        />
        <StatCard label="ใบสั่งงานทั้งหมด" value={woCount ?? 0} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">จำนวนงานตามสถานะ (1–11)</h2>
          <ul className="space-y-1 text-sm">
            {byStatus.map((s) => (
              <li key={s.value} className="flex justify-between border-b border-border/60 py-1">
                <span className="text-muted-foreground">{s.label}</span>
                <span className="font-medium">{s.count}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">งานที่เคลื่อนไหวล่าสุด</h2>
          <ul className="space-y-2 text-sm">
            {(projects ?? []).slice(0, 10).map((p) => (
              <li key={p.id} className="border-b border-border/60 pb-2">
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: p.id }}
                  className="font-medium text-primary hover:underline"
                >
                  {p.code} — {p.name}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {(p.customers as { name: string } | null)?.name ?? "ไม่ระบุลูกค้า"} ·{" "}
                  {statusLabel(p.status)} · แก้ไข {formatDate(p.updated_at)}
                </div>
              </li>
            ))}
            {projects?.length === 0 ? (
              <li className="text-muted-foreground">ยังไม่มีโปรเจกต์</li>
            ) : null}
          </ul>
        </section>
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        สิทธิ์ของคุณ: {roles.length ? roles.join(", ") : "ยังไม่กำหนด"} — ฝ่ายผลิตและช่างจะไม่เห็น
        ใบเสนอราคา ราคา และต้นทุนทั้งระบบ
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
