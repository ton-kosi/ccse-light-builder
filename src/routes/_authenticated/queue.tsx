import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useAssignees } from "@/components/work/WorkPlanSection";
import { useMe } from "@/hooks/useMe";
import { useStaff } from "@/hooks/useStaff";
import { WO_TYPES, woStatusLabel, woTypeLabel } from "@/lib/erp";
import { formatDate } from "@/lib/format";
import { addDaysIso, groupByDay, isoDate, thaiDow, weekDays, weekStart, WO_TYPE_CLS } from "@/lib/jobs";

export const Route = createFileRoute("/_authenticated/queue")({
  head: () => ({
    meta: [
      { title: "คิวงาน | CCSE ERP" },
      { name: "description", content: "คิวงานวัดหน้างาน ผลิต ติดตั้ง และซ่อม รายสัปดาห์ แยกตามช่างและฝ่ายผลิต" },
      { property: "og:title", content: "คิวงาน | CCSE ERP" },
      { property: "og:description", content: "คิวช่างและฝ่ายผลิตของ CCSE" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: QueuePage,
});

type Job = {
  id: string;
  doc_no: string;
  title: string;
  wo_type: string;
  status: string;
  scheduled_date: string | null;
  end_date: string | null;
  projects: { code: string; name: string; site_address: string | null } | null;
};

const sel = "h-9 rounded-md border border-input bg-background px-3 text-sm";

function QueuePage() {
  const { me, roles } = useMe();
  // technicians and production staff open on their own jobs
  const fieldOnly = roles.length > 0 && roles.every((r) => r === "technician" || r === "production");
  const today = isoDate(new Date());
  const [start, setStart] = useState(weekStart(today));
  const [type, setType] = useState("");
  const [person, setPerson] = useState<string>(fieldOnly ? "me" : "");
  const [showDone, setShowDone] = useState(false);
  const { data: staff } = useStaff();
  const { data: assignees } = useAssignees();

  const { data: jobs, isLoading, error } = useQuery({
    queryKey: ["work_orders", "queue"],
    queryFn: async () => {
      const cols = "id, doc_no, title, wo_type, status, scheduled_date, projects(code, name, site_address)";
      const load = (withEnd: boolean) =>
        supabase
          .from("work_orders")
          .select(withEnd ? cols + ", end_date" : cols)
          .neq("status", "cancelled")
          .order("scheduled_date", { ascending: true, nullsFirst: false });
      let { data, error } = await load(true);
      // end_date arrives with docs/sql/field_work_handover.sql; until then show one-day jobs
      if (error && /end_date/.test(error.message)) ({ data, error } = await load(false));
      if (error) throw error;
      return (data ?? []).map((j) => ({ end_date: null, ...(j as object) })) as Job[];
    },
  });

  const who = person === "me" ? me?.userId ?? "" : person;
  const nameOf = new Map((staff ?? []).map((s) => [s.id, s.name]));
  const visible = (jobs ?? []).filter(
    (j) =>
      (!type || j.wo_type === type) &&
      (showDone || j.status !== "done") &&
      (!who || (assignees?.get(j.id) ?? []).includes(who)),
  );
  const days = weekDays(start);
  const { byDay, unscheduled } = groupByDay(visible, days);
  const weekCount = new Set(days.flatMap((d) => byDay.get(d)!.map((j) => j.id))).size;

  const card = (j: Job) => {
    const people = (assignees?.get(j.id) ?? []).map((id) => nameOf.get(id) ?? "ผู้ใช้");
    const multi = j.end_date && j.scheduled_date && j.end_date > j.scheduled_date;
    return (
      <Link
        key={j.id}
        to="/work-orders/$woId"
        params={{ woId: j.id }}
        className={
          "block rounded-md border border-border border-l-4 bg-card p-2 text-xs shadow-sm hover:bg-secondary " +
          (WO_TYPE_CLS[j.wo_type] ?? "") +
          (j.status === "done" ? " opacity-60" : "")
        }
      >
        <div className="flex items-center justify-between gap-1">
          <span className="font-semibold">{woTypeLabel(j.wo_type)}</span>
          <span className="font-mono text-[10px] text-muted-foreground">{j.doc_no}</span>
        </div>
        <div className="mt-0.5 font-medium">
          {j.projects?.code} — {j.projects?.name}
        </div>
        {j.title ? <div className="text-muted-foreground">{j.title}</div> : null}
        {j.projects?.site_address ? (
          <div className="mt-0.5 flex gap-1 text-muted-foreground">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="line-clamp-2">{j.projects.site_address}</span>
          </div>
        ) : null}
        {multi ? (
          <div className="mt-0.5 text-muted-foreground">
            {formatDate(j.scheduled_date)} – {formatDate(j.end_date)}
          </div>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {people.length ? (
            people.map((n) => (
              <span key={n} className="rounded bg-secondary px-1.5 py-0.5">
                {n}
              </span>
            ))
          ) : (
            <span className="text-destructive">ยังไม่มีคนรับงาน</span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">{woStatusLabel(j.status)}</span>
        </div>
      </Link>
    );
  };

  return (
    <div>
      <PageHeader
        title="คิวงาน"
        description="งานวัดหน้างาน ผลิต ติดตั้ง และซ่อม รายสัปดาห์ — กดที่งานเพื่อดูแบบ รูป และส่งมอบงาน"
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => setStart(addDaysIso(start, -7))} title="สัปดาห์ก่อน">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setStart(weekStart(today))}>
            สัปดาห์นี้
          </Button>
          <Button size="sm" variant="outline" onClick={() => setStart(addDaysIso(start, 7))} title="สัปดาห์หน้า">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 text-sm font-medium">
            {formatDate(days[0])} – {formatDate(days[6])}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select className={sel} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">ทุกประเภทงาน</option>
            {WO_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <select className={sel} value={person} onChange={(e) => setPerson(e.target.value)}>
            <option value="">ทุกคน</option>
            <option value="me">งานของฉัน</option>
            {(staff ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            แสดงงานที่เสร็จแล้ว
          </label>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">กำลังโหลด…</p>
      ) : (
        <>
          {/* one row per day; seven columns only where there is room */}
          <div className="grid gap-2 xl:grid-cols-7">
            {days.map((d) => {
              const list = byDay.get(d)!;
              const isToday = d === today;
              return (
                <div
                  key={d}
                  className={
                    "rounded-lg border p-2 xl:min-h-24 " +
                    (isToday ? "border-primary bg-primary/5" : "border-border bg-muted/40")
                  }
                >
                  <div className="mb-2 flex items-baseline justify-between text-xs">
                    <span className={isToday ? "font-semibold text-primary" : "font-semibold"}>
                      {thaiDow(d)} {d.slice(8)}/{d.slice(5, 7)}
                    </span>
                    {list.length ? <span className="text-muted-foreground">{list.length} งาน</span> : null}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-1">{list.map(card)}</div>
                </div>
              );
            })}
          </div>
          {!weekCount ? (
            <p className="mt-2 text-sm text-muted-foreground">ไม่มีงานในสัปดาห์นี้ตามตัวกรองที่เลือก</p>
          ) : null}

          <h2 className="mb-2 mt-6 text-base font-semibold">
            ยังไม่ได้ลงวัน {unscheduled.length ? `(${unscheduled.length})` : ""}
          </h2>
          {unscheduled.length ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{unscheduled.map(card)}</div>
          ) : (
            <p className="text-sm text-muted-foreground">ทุกงานลงวันแล้ว</p>
          )}
        </>
      )}
    </div>
  );
}
