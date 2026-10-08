import { ROLE_LABELS } from "@/lib/erp";
import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCustomerNames } from "@/hooks/useCustomerNames";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useMe, meQueryKey } from "@/hooks/useMe";
import { PROJECT_STATUSES, statusLabel } from "@/lib/erp";
import { formatDate, formatTHB } from "@/lib/format";
import { methodLabel } from "@/lib/payments";
import type { ReactNode } from "react";

type PayRow = { key: string; projectId?: string | undefined; project: string; cells: ReactNode[]; money: number };

function PayList({ title, empty, head, rows, total }: { title: string; empty: string; head: string[]; rows: PayRow[]; total: number }) {
  return (
    <section className="mt-6 rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{title} <span className="font-normal text-muted-foreground">· รวม {formatTHB(total)} บาท</span></h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>{head.map((h, i) => <th key={h} className={"px-3 py-2" + (i === 4 ? " text-right" : "")}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <td className="px-3 py-2">{r.cells[0]}</td>
                <td className="px-3 py-2">
                  {r.projectId ? (
                    <Link to="/projects/$projectId" params={{ projectId: r.projectId }} className="text-primary hover:underline">{r.project}</Link>
                  ) : r.project}
                </td>
                <td className="px-3 py-2">{r.cells[2]}</td>
                <td className="px-3 py-2">{r.cells[3]}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatTHB(r.money)}</td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={5} className="px-3 py-2 text-muted-foreground">{empty}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "ภาพรวมงาน | CCSE ERP" },
      { name: "description", content: "สรุปจำนวนงานตามสถานะ และงานที่เคลื่อนไหวล่าสุด" },
      { property: "og:title", content: "ภาพรวมงาน | CCSE ERP" },
      { property: "og:description", content: "สรุปจำนวนงานตามสถานะของ CCSE" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { me, roles, hasNoRole, canManagePayments } = useMe();
  const queryClient = useQueryClient();
  const custName = useCustomerNames();

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
        .select("id, code, name, status, updated_at, customer_id, customers(name)")
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


  const { data: schedule } = useQuery({
    queryKey: ["payment_schedule", "all"],
    enabled: canManagePayments,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("payment_schedule", {});
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: recentReceipts } = useQuery({
    queryKey: ["payment_receipts", "recent"],
    enabled: canManagePayments,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_receipts")
        .select("id, term_id, received_date, amount, wht_amount, method, created_at")
        .is("voided_at", null)
        .order("received_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
  });
  const toBill = (schedule ?? [])
    .filter((t) => t.due_status === "to_bill")
    .sort((a, b) => (a.due_since ?? "").localeCompare(b.due_since ?? ""));
  const overdue = (schedule ?? [])
    .filter((t) => t.due_status === "overdue")
    .sort((a, b) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0));
  const termById = new Map((schedule ?? []).map((t) => [t.id, t]));

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
            บัญชีนี้ยังไม่ได้กำหนดสิทธิ์ กรุณาติดต่อผู้ดูแลระบบ (admin) เพื่อกำหนดบทบาทให้คุณ
          </p>
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
                  {custName(p.customer_id, p.customers) ?? "ไม่ระบุลูกค้า"} ·{" "}
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

      {canManagePayments ? (
        <>
          <PayList
            title="ฝ่ายบัญชี — ถึงเวลาวางบิล"
            empty="ไม่มีงวดที่ถึงเวลาวางบิล"
            head={["ถึงกำหนดตั้งแต่", "โปรเจกต์", "ใบเสนอราคา", "งวด", "จำนวนเงิน (บาท)"]}
            total={toBill.reduce((s, t) => s + Number(t.amount ?? 0), 0)}
            rows={toBill.map((t) => ({
              key: t.id, projectId: t.project_id, project: `${t.project_code} — ${t.project_name}`,
              cells: [t.due_since ? formatDate(t.due_since) : "—", null, `${t.ref_no} Rev ${t.rev}`, `${t.seq}. ${t.name}`],
              money: Number(t.amount ?? 0),
            }))}
          />
          <PayList
            title="เกินกำหนดชำระ (เกินนานสุดก่อน)"
            empty="ไม่มีงวดที่เกินกำหนด"
            head={["เกินกำหนด", "โปรเจกต์", "ใบวางบิล / ครบกำหนด", "งวด", "คงค้าง (บาท)"]}
            total={overdue.reduce((s, t) => s + Number(t.outstanding ?? 0), 0)}
            rows={overdue.map((t) => ({
              key: t.id, projectId: t.project_id, project: `${t.project_code} — ${t.project_name}`,
              cells: [<span className="font-semibold text-destructive">{t.days_overdue} วัน</span>, null, `${t.bill_no} · ${formatDate(t.due_date)}`, `${t.seq}. ${t.name}`],
              money: Number(t.outstanding ?? 0),
            }))}
          />
          <PayList
            title="รับเงินล่าสุด"
            empty="ยังไม่มีการรับเงิน"
            head={["วันที่รับ", "โปรเจกต์", "วิธีรับ", "งวด", "จำนวนเงิน + ภาษีหัก (บาท)"]}
            total={(recentReceipts ?? []).reduce((s, r) => s + Number(r.amount) + Number(r.wht_amount), 0)}
            rows={(recentReceipts ?? []).map((r) => {
              const t = termById.get(r.term_id);
              return {
                key: r.id, projectId: t?.project_id, project: t ? `${t.project_code} — ${t.project_name}` : "-",
                cells: [formatDate(r.received_date), null, methodLabel(r.method), t ? `${t.seq}. ${t.name}` : "-"],
                money: Number(r.amount) + Number(r.wht_amount),
              };
            })}
          />
        </>
      ) : null}

      <p className="mt-6 text-xs text-muted-foreground">
        สิทธิ์ของคุณ: {roles.length ? roles.map((r) => ROLE_LABELS[r]).join(", ") : "ยังไม่กำหนด"} — ฝ่ายผลิตและช่างจะไม่เห็น
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
