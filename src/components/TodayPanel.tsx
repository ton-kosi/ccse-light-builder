import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, HandCoins, Receipt, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useFollowups } from "@/components/payments/Followups";
import { useTickets } from "@/components/repairs/Repairs";
import { useCrew, useCrewJobs } from "@/hooks/useCrew";
import { useMe } from "@/hooks/useMe";
import { chaseList } from "@/lib/collections";
import { woTypeLabel } from "@/lib/erp";
import { isoDate, runsOn } from "@/lib/jobs";

/** "What to do today" at the top of the dashboard: jobs today, money to chase / bill, open repairs. */
export function TodayPanel() {
  const { me, roles, canManagePayments } = useMe();
  const today = isoDate(new Date());
  const fieldOnly = roles.length > 0 && roles.every((r) => r === "technician" || r === "production");
  const { data: crew } = useCrew();
  const { data: crewJobs } = useCrewJobs();
  const { data: tickets } = useTickets();
  const { data: followups } = useFollowups();

  const { data: jobs } = useQuery({
    queryKey: ["work_orders", "today", today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select("id, doc_no, title, wo_type, status, scheduled_date, end_date, projects(code, name)")
        .lte("scheduled_date", today)
        .not("status", "in", "(done,cancelled)");
      if (error) throw error;
      return data;
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

  const mine = (crew ?? []).find((m) => m.user_id && m.user_id === me?.userId);
  const todayJobs = (jobs ?? [])
    .filter((j) => runsOn({ id: j.id, scheduled_date: j.scheduled_date, end_date: j.end_date }, today))
    .filter((j) => !fieldOnly || (mine && (crewJobs?.get(j.id) ?? []).includes(mine.id)));
  const openTickets = (tickets ?? []).filter((t) => t.status === "open" || t.status === "scheduled");
  const openBills = (schedule ?? [])
    .filter((t) => t.bill_id && Number(t.outstanding) > 0.005)
    .map((t) => ({ bill_id: t.bill_id, due_date: t.due_date, outstanding: Number(t.outstanding), days_overdue: t.days_overdue }));
  const chase = chaseList(openBills, followups ?? [], today);
  const toBill = (schedule ?? []).filter((t) => t.due_status === "to_bill");

  const tile = (to: string, icon: React.ReactNode, label: string, value: number, hint: string, urgent = false) => (
    <Link
      to={to}
      className={"block rounded-lg border p-3 hover:bg-secondary " + (urgent && value ? "border-destructive/40 bg-destructive/5" : "border-border bg-card")}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon} {label}
      </div>
      <div className={"text-2xl font-semibold " + (urgent && value ? "text-destructive" : "")}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{hint}</div>
    </Link>
  );

  return (
    <section className="mb-6 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <h2 className="mb-3 text-sm font-semibold">วันนี้ต้องทำอะไร</h2>
      <div className={"grid gap-3 sm:grid-cols-2 " + (canManagePayments ? "lg:grid-cols-4" : "lg:grid-cols-2")}>
        {tile("/queue", <CalendarDays className="h-3.5 w-3.5" />, fieldOnly ? "งานของฉันวันนี้" : "งานช่าง / ผลิต วันนี้", todayJobs.length, "ดูตารางงานช่าง")}
        {tile("/repairs", <Wrench className="h-3.5 w-3.5" />, "ใบแจ้งซ่อมที่ยังไม่เสร็จ", openTickets.length, "รับแจ้ง / ลงคิวช่างแล้ว")}
        {canManagePayments
          ? tile("/collections", <HandCoins className="h-3.5 w-3.5" />, "ต้องทวงเงินวันนี้", chase.length, "เกินกำหนด / ถึงวันนัด", true)
          : null}
        {canManagePayments
          ? tile("/dashboard", <Receipt className="h-3.5 w-3.5" />, "ถึงเวลาวางบิล", toBill.length, "รายการด้านล่าง")
          : null}
      </div>
      {todayJobs.length ? (
        <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
          {todayJobs.slice(0, 6).map((j) => {
            const p = j.projects as { code: string; name: string } | null;
            return (
              <li key={j.id}>
                <Link to="/work-orders/$woId" params={{ woId: j.id }} className="block rounded border border-border bg-card px-2 py-1 hover:bg-secondary">
                  <span className="font-medium">{p?.name ?? p?.code}</span>
                  <span className="text-muted-foreground"> · {woTypeLabel(j.wo_type)}{j.title ? ` · ${j.title}` : ""}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
