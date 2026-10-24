import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, MapPin, Plus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMe } from "@/hooks/useMe";
import { useStaff } from "@/hooks/useStaff";
import { useHolidays } from "@/hooks/useHolidays";
import {
  crewJobsKey,
  crewKey,
  crewMigrationMsg,
  isCrewMigrationError,
  SCHEDULE_KINDS,
  scheduleKey,
  scheduleKindLabel,
  useCrew,
  useCrewJobs,
  useScheduleEntries,
  type CrewMember,
  type ScheduleEntry,
} from "@/hooks/useCrew";
import { WO_TYPES, woStatusLabel, woTypeLabel } from "@/lib/erp";
import { formatDate } from "@/lib/format";
import { addDaysIso, groupByDay, isoDate, runsOn, thaiDow, weekDays, weekStart, WO_TYPE_CLS } from "@/lib/jobs";

export const Route = createFileRoute("/_authenticated/queue")({
  head: () => ({
    meta: [
      { title: "คิวงาน | CCSE ERP" },
      { name: "description", content: "ตารางงานช่างรายสัปดาห์ — วัดหน้างาน ผลิต ติดตั้ง ซ่อม แยกตามช่างและทีม" },
      { property: "og:title", content: "คิวงาน | CCSE ERP" },
      { property: "og:description", content: "ตารางงานช่างและฝ่ายผลิตของ CCSE" },
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
// one background per crew, like the colour bands on the paper schedule
const CREW_BG = ["bg-accent/40", "bg-primary/5", "bg-success/10", "bg-warning/10", "bg-secondary", "bg-destructive/5"];

function QueuePage() {
  const { me, roles, canPlanWork } = useMe();
  const fieldOnly = roles.length > 0 && roles.every((r) => r === "technician" || r === "production");
  const today = isoDate(new Date());
  const [start, setStart] = useState(weekStart(today));
  const [view, setView] = useState<"people" | "days">("people");
  const [type, setType] = useState("");
  const [person, setPerson] = useState<string>(fieldOnly ? "me" : "");
  const [showDone, setShowDone] = useState(false);
  const [sunday, setSunday] = useState(false);
  const [manage, setManage] = useState(false);
  const [cell, setCell] = useState<{ member: CrewMember; day: string } | null>(null);
  const { data: crew } = useCrew();
  const { data: crewJobs } = useCrewJobs();
  const { data: holidays } = useHolidays();

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
      if (error && /end_date/.test(error.message)) ({ data, error } = await load(false));
      if (error) throw error;
      return (data ?? []).map((j) => ({ end_date: null, ...(j as object) })) as Job[];
    },
  });

  const allDays = weekDays(start);
  const days = sunday ? allDays : allDays.slice(0, 6);
  const { data: entries } = useScheduleEntries(allDays[0]!, allDays[6]!);
  const myMember = (crew ?? []).find((m) => m.user_id && m.user_id === me?.userId);
  const who = person === "me" ? myMember?.id ?? "__none__" : person;
  const nameOf = new Map((crew ?? []).map((m) => [m.id, m.display_name]));
  const visible = (jobs ?? []).filter(
    (j) =>
      (!type || j.wo_type === type) &&
      (showDone || j.status !== "done") &&
      (!who || (crewJobs?.get(j.id) ?? []).includes(who)),
  );
  const { byDay, unscheduled } = groupByDay(visible, days);

  const card = (j: Job, compact = false) => {
    const people = (crewJobs?.get(j.id) ?? []).map((id) => nameOf.get(id) ?? "—");
    const multi = j.end_date && j.scheduled_date && j.end_date > j.scheduled_date;
    return (
      <Link
        key={j.id}
        to="/work-orders/$woId"
        params={{ woId: j.id }}
        className={
          "block rounded-md border border-border border-l-4 bg-card p-1.5 text-xs shadow-sm hover:bg-secondary " +
          (WO_TYPE_CLS[j.wo_type] ?? "") +
          (j.status === "done" ? " opacity-60" : "")
        }
        title={`${j.doc_no} · ${woStatusLabel(j.status)}`}
      >
        <div className="font-medium leading-tight">
          {j.projects?.name ?? j.projects?.code}
          {j.title ? <span className="font-normal text-muted-foreground"> ({j.title})</span> : null}
        </div>
        <div className="text-[10px] text-muted-foreground">{woTypeLabel(j.wo_type)}</div>
        {!compact ? (
          <>
            {j.projects?.site_address ? (
              <div className="mt-0.5 flex gap-1 text-muted-foreground">
                <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="line-clamp-2">{j.projects.site_address}</span>
              </div>
            ) : null}
            {multi ? (
              <div className="text-muted-foreground">
                {formatDate(j.scheduled_date)} – {formatDate(j.end_date)}
              </div>
            ) : null}
            <div className="mt-1 flex flex-wrap gap-1">
              {people.length ? (
                people.map((n) => (
                  <span key={n} className="rounded bg-secondary px-1.5 py-0.5">
                    {n}
                  </span>
                ))
              ) : (
                <span className="text-destructive">ยังไม่มีช่างรับงาน</span>
              )}
            </div>
          </>
        ) : null}
      </Link>
    );
  };

  // people × days: crews in order, then their members
  const members = (crew ?? []).filter((m) => m.active && (!who || m.id === who));
  const crews: { name: string; rows: CrewMember[] }[] = [];
  for (const m of members) {
    const name = m.crew ?? "";
    const last = crews[crews.length - 1];
    if (last && last.name === name) last.rows.push(m);
    else crews.push({ name, rows: [m] });
  }
  const entriesOf = (memberId: string, day: string) =>
    (entries ?? []).filter((e) => e.member_id === memberId && day >= e.date_from && day <= e.date_to);
  const jobsOf = (memberId: string, day: string) =>
    visible.filter((j) => runsOn(j, day) && (crewJobs?.get(j.id) ?? []).includes(memberId));

  return (
    <div>
      <PageHeader
        title="คิวงาน"
        description="ตารางงานช่างรายสัปดาห์ — กดที่งานเพื่อดูแบบ รูป วัดหน้างาน และส่งมอบงาน"
        actions={
          canPlanWork ? (
            <Button size="sm" variant="outline" onClick={() => setManage(true)}>
              <Users className="h-4 w-4" /> จัดการทีมช่าง
            </Button>
          ) : null
        }
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
            {formatDate(days[0])} – {formatDate(days[days.length - 1])}
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-input p-0.5 text-sm">
            {(["people", "days"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={"rounded px-2.5 py-1 " + (view === v ? "bg-primary text-primary-foreground" : "")}
                onClick={() => setView(v)}
              >
                {v === "people" ? "ตามคน" : "ตามวัน"}
              </button>
            ))}
          </div>
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
            {(crew ?? []).filter((m) => m.active).map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            งานที่เสร็จแล้ว
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={sunday} onChange={(e) => setSunday(e.target.checked)} />
            วันอาทิตย์
          </label>
        </div>
      </div>

      {error ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">กำลังโหลด…</p>
      ) : view === "people" ? (
        members.length ? (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[860px] border-collapse text-xs">
              <thead>
                <tr className="bg-secondary">
                  <th className="sticky left-0 z-10 w-28 border border-border bg-secondary px-2 py-1.5 text-left">ช่าง</th>
                  {days.map((d) => {
                    const hol = holidays?.get(d);
                    return (
                      <th
                        key={d}
                        className={
                          "border border-border px-2 py-1.5 " +
                          (hol ? "bg-warning/30" : d === today ? "bg-primary/10 text-primary" : "")
                        }
                      >
                        <div>{thaiDow(d)} {d.slice(8)}/{d.slice(5, 7)}</div>
                        {hol ? <div className="text-[10px] font-normal">{hol}</div> : null}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {crews.map((c, ci) => (
                  <Fragment key={c.name + ci}>
                    {c.rows.map((m, mi) => (
                      <tr key={m.id} className={CREW_BG[ci % CREW_BG.length]}>
                        <th className={"sticky left-0 z-10 border border-border px-2 py-1.5 text-left align-top " + CREW_BG[ci % CREW_BG.length]}>
                          <div className="font-semibold">{m.display_name}</div>
                          {mi === 0 && c.name ? <div className="text-[10px] font-normal text-muted-foreground">{c.name}</div> : null}
                        </th>
                        {days.map((d) => {
                          const hol = holidays?.get(d);
                          const js = jobsOf(m.id, d);
                          const es = entriesOf(m.id, d);
                          return (
                            <td key={d} className={"group border border-border p-1 align-top " + (hol ? "bg-warning/20" : "")}>
                              <div className="space-y-1">
                                {js.map((j) => card(j, true))}
                                {es.map((e) => (
                                  <div
                                    key={e.id}
                                    className={"rounded px-1.5 py-1 " + (SCHEDULE_KINDS.find((k) => k.value === e.kind)?.cls ?? "")}
                                    title={scheduleKindLabel(e.kind)}
                                  >
                                    {e.note || scheduleKindLabel(e.kind)}
                                  </div>
                                ))}
                                {canPlanWork ? (
                                  <button
                                    type="button"
                                    className="flex w-full items-center justify-center rounded border border-dashed border-border py-0.5 text-muted-foreground opacity-0 hover:bg-card group-hover:opacity-100"
                                    title="ลงงานให้ช่างคนนี้"
                                    onClick={() => setCell({ member: m, day: d })}
                                  >
                                    <Plus className="h-3 w-3" />
                                  </button>
                                ) : null}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            {person === "me"
              ? "บัญชีนี้ยังไม่ได้ผูกกับรายชื่อช่าง — ให้หัวหน้าผูกที่ “จัดการทีมช่าง”"
              : "ยังไม่มีรายชื่อช่าง — กด “จัดการทีมช่าง” เพื่อเพิ่ม (ช่างไม่จำเป็นต้องมีบัญชีเข้าระบบ)"}
          </p>
        )
      ) : (
        <div className="grid gap-2 xl:grid-cols-6">
          {days.map((d) => {
            const list = byDay.get(d)!;
            const hol = holidays?.get(d);
            return (
              <div
                key={d}
                className={
                  "rounded-lg border p-2 xl:min-h-24 " +
                  (hol ? "border-warning bg-warning/10" : d === today ? "border-primary bg-primary/5" : "border-border bg-muted/40")
                }
              >
                <div className="mb-2 flex items-baseline justify-between text-xs">
                  <span className={d === today ? "font-semibold text-primary" : "font-semibold"}>
                    {thaiDow(d)} {d.slice(8)}/{d.slice(5, 7)}
                    {hol ? ` · ${hol}` : ""}
                  </span>
                  {list.length ? <span className="text-muted-foreground">{list.length} งาน</span> : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-1">{list.map((j) => card(j))}</div>
              </div>
            );
          })}
        </div>
      )}

      <h2 className="mb-2 mt-6 text-base font-semibold">ยังไม่ได้ลงวัน {unscheduled.length ? `(${unscheduled.length})` : ""}</h2>
      {unscheduled.length ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{unscheduled.map((j) => card(j))}</div>
      ) : (
        <p className="text-sm text-muted-foreground">ทุกงานลงวันแล้ว</p>
      )}

      {manage ? <CrewManager onClose={() => setManage(false)} /> : null}
      {cell ? (
        <CellDialog
          member={cell.member}
          day={cell.day}
          jobs={(jobs ?? []).filter((j) => j.status !== "done")}
          assigned={jobsOf(cell.member.id, cell.day)}
          entries={entriesOf(cell.member.id, cell.day)}
          onClose={() => setCell(null)}
        />
      ) : null}
    </div>
  );
}

/** Add / edit technicians and crews. A login is optional (for "งานของฉัน"). */
function CrewManager({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: crew } = useCrew();
  const { data: staff } = useStaff();
  const [f, setF] = useState({ display_name: "", crew: "" });
  const crews = [...new Set((crew ?? []).map((m) => m.crew).filter(Boolean) as string[])];
  const refresh = () => qc.invalidateQueries({ queryKey: crewKey });
  const onError = (e: Error) => toast.error(isCrewMigrationError(e.message) ? crewMigrationMsg : e.message);

  const add = useMutation({
    mutationFn: async () => {
      if (!f.display_name.trim()) throw new Error("ใส่ชื่อช่าง เช่น K.แขก");
      const sort = Math.max(0, ...(crew ?? []).map((m) => m.sort_order)) + 1;
      const { error } = await supabase
        .from("crew_members")
        .insert({ display_name: f.display_name.trim(), crew: f.crew.trim() || null, sort_order: sort });
      if (error) throw error;
    },
    onSuccess: () => {
      setF({ display_name: "", crew: f.crew });
      refresh();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<CrewMember> }) => {
      const { error } = await supabase.from("crew_members").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("crew_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: crewJobsKey });
    },
    onError,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>จัดการทีมช่าง</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          ทีม = แถบสีในตารางงาน · ลำดับ = เรียงแถว · ผูกบัญชีเพื่อให้ช่างเห็น “งานของฉัน” (ไม่บังคับ)
        </p>
        <datalist id="crew-names">
          {crews.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="max-h-[55vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">ชื่อ</th>
                <th className="py-1">ทีม</th>
                <th className="w-16 py-1">ลำดับ</th>
                <th className="py-1">บัญชีเข้าระบบ</th>
                <th className="w-14 py-1">ใช้งาน</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(crew ?? []).map((m) => (
                <tr key={m.id + m.display_name + (m.crew ?? "") + m.sort_order} className="border-t border-border">
                  <td className="py-1 pr-2">
                    <Input
                      className="h-8"
                      defaultValue={m.display_name}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== m.display_name) update.mutate({ id: m.id, patch: { display_name: v } });
                      }}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      className="h-8"
                      list="crew-names"
                      defaultValue={m.crew ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value.trim() || null;
                        if (v !== m.crew) update.mutate({ id: m.id, patch: { crew: v } });
                      }}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      className="h-8"
                      inputMode="numeric"
                      defaultValue={String(m.sort_order)}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v) && v !== m.sort_order) update.mutate({ id: m.id, patch: { sort_order: v } });
                      }}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <select
                      className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      value={m.user_id ?? ""}
                      onChange={(e) => update.mutate({ id: m.id, patch: { user_id: e.target.value || null } })}
                    >
                      <option value="">— ไม่มีบัญชี —</option>
                      {(staff ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 text-center">
                    <input
                      type="checkbox"
                      checked={m.active}
                      onChange={(e) => update.mutate({ id: m.id, patch: { active: e.target.checked } })}
                    />
                  </td>
                  <td className="py-1 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-destructive"
                      onClick={() => {
                        if (confirm(`ลบ ${m.display_name} ออกจากทีม? (งานที่เคยมอบหมายจะไม่มีชื่อนี้แล้ว)`)) remove.mutate(m.id);
                      }}
                    >
                      ลบ
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="flex flex-wrap items-center gap-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Input
            className="w-40"
            placeholder="ชื่อ เช่น K.แขก"
            value={f.display_name}
            onChange={(e) => setF({ ...f, display_name: e.target.value })}
          />
          <Input
            className="w-40"
            list="crew-names"
            placeholder="ทีม เช่น ทีม 1"
            value={f.crew}
            onChange={(e) => setF({ ...f, crew: e.target.value })}
          />
          <Button size="sm" type="submit" disabled={add.isPending}>
            เพิ่มช่าง
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One schedule cell: put the person on an existing job, or add workshop / off / other. */
function CellDialog({
  member,
  day,
  jobs,
  assigned,
  entries,
  onClose,
}: {
  member: CrewMember;
  day: string;
  jobs: Job[];
  assigned: Job[];
  entries: ScheduleEntry[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [jobId, setJobId] = useState("");
  const [f, setF] = useState({ kind: "workshop" as ScheduleEntry["kind"], note: "", to: day });
  const onError = (e: Error) => toast.error(isCrewMigrationError(e.message) ? crewMigrationMsg : e.message);
  const done = () => {
    qc.invalidateQueries({ queryKey: crewJobsKey });
    qc.invalidateQueries({ queryKey: scheduleKey });
    qc.invalidateQueries({ queryKey: ["work_orders"] });
  };

  const assign = useMutation({
    mutationFn: async () => {
      const j = jobs.find((x) => x.id === jobId);
      if (!j) throw new Error("เลือกงาน");
      const { error } = await supabase.from("work_order_crew").insert({ work_order_id: j.id, member_id: member.id });
      if (error && !/duplicate key/i.test(error.message)) throw error;
      // a job without a date starts on the chosen day
      if (!j.scheduled_date) {
        const { error: e2 } = await supabase.from("work_orders").update({ scheduled_date: day }).eq("id", j.id);
        if (e2) throw e2;
      }
    },
    onSuccess: () => {
      toast.success(`ลงงานให้ ${member.display_name} แล้ว`);
      done();
      onClose();
    },
    onError,
  });
  const addEntry = useMutation({
    mutationFn: async () => {
      if (f.to < day) throw new Error("ถึงวันที่ต้องไม่ก่อนวันเริ่ม");
      const { error } = await supabase
        .from("schedule_entries")
        .insert({ member_id: member.id, date_from: day, date_to: f.to, kind: f.kind, note: f.note.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("บันทึกแล้ว");
      done();
      onClose();
    },
    onError,
  });
  const removeEntry = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("schedule_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: done,
    onError,
  });
  const unassign = useMutation({
    mutationFn: async (woId: string) => {
      const { error } = await supabase.from("work_order_crew").delete().eq("work_order_id", woId).eq("member_id", member.id);
      if (error) throw error;
    },
    onSuccess: done,
    onError,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {member.display_name} · {thaiDow(day)} {formatDate(day)}
          </DialogTitle>
        </DialogHeader>
        {assigned.length || entries.length ? (
          <ul className="space-y-1 text-sm">
            {assigned.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1">
                <span>
                  {j.projects?.name} {j.title ? `(${j.title})` : ""} · {woTypeLabel(j.wo_type)}
                </span>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => unassign.mutate(j.id)}>
                  เอาออก
                </Button>
              </li>
            ))}
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1">
                <span>
                  {scheduleKindLabel(e.kind)}
                  {e.note ? ` · ${e.note}` : ""} ({formatDate(e.date_from)}
                  {e.date_to !== e.date_from ? ` – ${formatDate(e.date_to)}` : ""})
                </span>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => removeEntry.mutate(e.id)}>
                  ลบ
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="text-sm font-semibold">ลงงานโปรเจกต์</div>
          <select className={sel + " w-full"} value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">— เลือกใบสั่งงาน —</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.projects?.code} {j.projects?.name} · {woTypeLabel(j.wo_type)}
                {j.title ? ` · ${j.title}` : ""}
                {j.scheduled_date ? ` · ${formatDate(j.scheduled_date)}${j.end_date && j.end_date !== j.scheduled_date ? `–${formatDate(j.end_date)}` : ""}` : " · ยังไม่ลงวัน"}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            วันที่ทำงานตามใบสั่งงาน (แก้ช่วงวันได้ในใบสั่งงาน) · งานที่ยังไม่ลงวันจะเริ่มวันนี้
          </p>
          <Button size="sm" disabled={!jobId || assign.isPending} onClick={() => assign.mutate()}>
            ลงงาน
          </Button>
        </div>

        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="text-sm font-semibold">งานอื่น / พัก</div>
          <div className="flex flex-wrap gap-2">
            <select className={sel} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as ScheduleEntry["kind"] })}>
              {SCHEDULE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <Input className="w-40" type="date" min={day} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
          </div>
          <Input
            placeholder="หมายเหตุ เช่น CCSE (ชั้น4) / ลาป่วย / ช่วยขึ้นผ้า"
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
          <Button size="sm" variant="outline" disabled={addEntry.isPending} onClick={() => addEntry.mutate()}>
            บันทึก
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
