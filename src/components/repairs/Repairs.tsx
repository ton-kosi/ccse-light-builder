import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useProjectWarranty } from "@/hooks/useWarranty";
import { useMe } from "@/hooks/useMe";
import { formatDate } from "@/lib/format";
import { isoDate } from "@/lib/jobs";
import { COVERAGE_LABEL, coverage } from "@/lib/warranty";

export const ticketsKey = ["service_tickets"];
export const TICKET_STATUSES: { value: string; label: string }[] = [
  { value: "open", label: "รับแจ้ง" },
  { value: "scheduled", label: "ลงคิวช่างแล้ว" },
  { value: "done", label: "ซ่อมเสร็จ" },
  { value: "quoted", label: "เสนอราคาใหม่" },
  { value: "closed", label: "ปิดงาน" },
  { value: "cancelled", label: "ยกเลิก" },
];
export const ticketStatusLabel = (s: string) => TICKET_STATUSES.find((x) => x.value === s)?.label ?? s;
const migrationMsg = "ยังบันทึกไม่ได้ — ให้ Lovable รันไฟล์ docs/sql/warranty_repairs.sql ก่อน";
const friendly = (m: string) => (/service_tickets|warranty_rules|schema cache/i.test(m) ? migrationMsg : m);

/** Project overview: warranty per product type from handover + "แจ้งซ่อม". */
export function WarrantyCard({ projectId }: { projectId: string }) {
  const { start, items, isLoading } = useProjectWarranty(projectId);
  const { canPlanWork } = useMe();
  const [open, setOpen] = useState(false);
  if (isLoading) return null;
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4" /> การรับประกัน
          </h2>
          <p className="text-xs text-muted-foreground">
            {start ? `เริ่มนับจากวันส่งมอบงาน ${formatDate(start)}` : "ประกันเริ่มเมื่อส่งมอบงาน (ยังไม่ส่งมอบ)"}
          </p>
        </div>
        {canPlanWork ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Wrench className="h-4 w-4" /> แจ้งซ่อม
          </Button>
        ) : null}
      </div>
      {items.length ? (
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {items.map((i) => (
            <li key={i.category} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1">
              <span>{i.category}</span>
              <span className="text-xs">
                {i.months === null ? (
                  <span className="text-muted-foreground">ไม่ได้กำหนด</span>
                ) : (
                  <>
                    {i.months} เดือน
                    {i.endsOn ? (
                      <span className={"ml-1.5 rounded px-1.5 py-0.5 " + (i.active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
                        {i.active ? "ถึง" : "หมด"} {formatDate(i.endsOn)}
                      </span>
                    ) : null}
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">ยังไม่มีรายการสินค้าในใบเสนอราคาปัจจุบัน</p>
      )}
      {open ? <TicketDialog projectId={projectId} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}

/** New repair ticket; checks the warranty of the failed part on the spot. */
export function TicketDialog({ projectId: fixed, onClose }: { projectId?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState(fixed ?? "");
  const [f, setF] = useState({ reporter: "", problem: "", part: "", reported_on: isoDate(new Date()) });
  const { data: projects } = useQuery({
    queryKey: ["projects", "repair-pick"],
    enabled: !fixed,
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("id, code, name").order("code", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
  const { start, items } = useProjectWarranty(projectId);
  const item = items.find((i) => i.category === f.part);
  const cov = f.part ? coverage(item, start) : null;

  const save = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("เลือกโปรเจกต์");
      if (!f.problem.trim()) throw new Error("ใส่อาการที่แจ้ง");
      const { error } = await supabase.from("service_tickets").insert({
        project_id: projectId,
        reported_on: f.reported_on,
        reporter: f.reporter.trim() || null,
        problem: f.problem.trim(),
        part_category: f.part || null,
        in_warranty: cov ? cov.status === "in" : null,
        warranty_ends_on: cov?.endsOn ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("บันทึกใบแจ้งซ่อมแล้ว");
      qc.invalidateQueries({ queryKey: ticketsKey });
      onClose();
    },
    onError: (e: Error) => toast.error(friendly(e.message)),
  });

  const sel = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>ใบแจ้งซ่อม</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {!fixed ? (
            <select className={sel} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— เลือกโปรเจกต์ —</option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <Input type="date" value={f.reported_on} onChange={(e) => setF({ ...f, reported_on: e.target.value })} />
            <Input placeholder="ผู้แจ้ง / เบอร์โทร" value={f.reporter} onChange={(e) => setF({ ...f, reporter: e.target.value })} />
          </div>
          <Textarea
            rows={3}
            placeholder="อาการ เช่น ไฟเส้นดับ 1 ช่วงที่ชั้น 2"
            value={f.problem}
            onChange={(e) => setF({ ...f, problem: e.target.value })}
          />
          <select className={sel} value={f.part} disabled={!projectId} onChange={(e) => setF({ ...f, part: e.target.value })}>
            <option value="">— ชิ้นส่วนที่เสีย (ใช้ตรวจประกัน) —</option>
            {items.map((i) => (
              <option key={i.category} value={i.category}>
                {i.category}
                {i.months !== null ? ` · ประกัน ${i.months} เดือน` : ""}
              </option>
            ))}
          </select>
          {cov ? (
            <div
              className={
                "rounded-md px-3 py-2 text-sm font-medium " +
                (cov.status === "in" ? "bg-success/15 text-success" : cov.status === "out" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")
              }
            >
              {COVERAGE_LABEL[cov.status]}
              {cov.endsOn ? ` (${cov.status === "in" ? "ถึง" : "หมดเมื่อ"} ${formatDate(cov.endsOn)})` : ""}
              <div className="text-xs font-normal">
                {cov.status === "in"
                  ? "บันทึกแล้วกด “สร้างใบงานซ่อม” เพื่อลงคิวช่าง"
                  : cov.status === "out"
                    ? "บันทึกแล้วกด “เสนอราคาใหม่” เพื่อเปิดโปรเจกต์งานซ่อม"
                    : ""}
              </div>
            </div>
          ) : null}
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            บันทึกใบแจ้งซ่อม
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Ticket = {
  id: string;
  ticket_no: string;
  project_id: string;
  reported_on: string;
  reporter: string | null;
  problem: string;
  part_category: string | null;
  in_warranty: boolean | null;
  warranty_ends_on: string | null;
  status: string;
  work_order_id: string | null;
  production_wo_id: string | null;
  quote_project_id: string | null;
  note: string | null;
  projects: { code: string; name: string; customer_id: string | null; attn: string | null; site_address: string | null } | null;
};

export function useTickets(projectId?: string) {
  return useQuery({
    queryKey: [...ticketsKey, projectId ?? "all"],
    queryFn: async (): Promise<Ticket[]> => {
      let q = supabase
        .from("service_tickets")
        .select("*, projects!service_tickets_project_id_fkey(code, name, customer_id, attn, site_address)")
        .order("reported_on", { ascending: false })
        .order("created_at", { ascending: false });
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) {
        if (/does not exist|schema cache/i.test(error.message)) return [];
        throw error;
      }
      return data as unknown as Ticket[];
    },
  });
}

/** One ticket: in warranty → service (and production) work order; out → new quotation project. */
export function TicketRow({ t }: { t: Ticket }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { canPlanWork } = useMe();
  const [needsProduction, setNeedsProduction] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ticketsKey });
    qc.invalidateQueries({ queryKey: ["work_orders"] });
  };

  const update = useMutation({
    mutationFn: async (patch: TablesUpdate<"service_tickets">) => {
      const { error } = await supabase.from("service_tickets").update(patch).eq("id", t.id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(friendly(e.message)),
  });

  const makeJobs = useMutation({
    mutationFn: async () => {
      const stamp = new Date().getTime().toString().slice(-6);
      const mk = async (type: string, prefix: string) => {
        const { data, error } = await supabase
          .from("work_orders")
          .insert({ project_id: t.project_id, doc_no: `${prefix}-${stamp}`, title: `${t.ticket_no} ${t.problem}`.slice(0, 120), wo_type: type })
          .select("id")
          .single();
        if (error) throw error;
        return data.id;
      };
      const service = await mk("service", "SV");
      const production = needsProduction ? await mk("production", "SP") : null;
      const { error } = await supabase
        .from("service_tickets")
        .update({ work_order_id: service, production_wo_id: production, status: "scheduled" })
        .eq("id", t.id);
      if (error) throw error;
      return service;
    },
    onSuccess: (woId) => {
      toast.success("สร้างใบงานซ่อมแล้ว — ลงวันและช่างได้ในใบสั่งงาน");
      refresh();
      navigate({ to: "/work-orders/$woId", params: { woId } });
    },
    onError: (e: Error) => toast.error(friendly(e.message)),
  });

  const quote = useMutation({
    mutationFn: async () => {
      const p = t.projects;
      const { data, error } = await supabase
        .from("projects")
        .insert({
          code: `${p?.code ?? "SV"}-${t.ticket_no}`,
          name: `${p?.name ?? ""} (งานซ่อม ${t.ticket_no})`.trim(),
          customer_id: p?.customer_id ?? null,
          attn: p?.attn ?? null,
          site_address: p?.site_address ?? null,
          notes: `จากใบแจ้งซ่อม ${t.ticket_no}: ${t.problem}`,
        })
        .select("id")
        .single();
      if (error) throw error;
      const { error: e2 } = await supabase
        .from("service_tickets")
        .update({ quote_project_id: data.id, status: "quoted" })
        .eq("id", t.id);
      if (e2) throw e2;
      return data.id;
    },
    onSuccess: (id) => {
      toast.success("เปิดโปรเจกต์งานซ่อมแล้ว — ทำใบเสนอราคาได้ที่แท็บ BOQ");
      refresh();
      navigate({ to: "/projects/$projectId", params: { projectId: id } });
    },
    onError: (e: Error) => toast.error(friendly(e.message)),
  });

  const warranty =
    t.in_warranty === true ? (
      <span className="rounded bg-success/15 px-1.5 py-0.5 text-success">ในประกัน{t.warranty_ends_on ? ` ถึง ${formatDate(t.warranty_ends_on)}` : ""}</span>
    ) : t.in_warranty === false ? (
      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">หมดประกัน</span>
    ) : (
      <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">ไม่ได้ระบุ</span>
    );

  return (
    <li className="rounded-lg border border-border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">
            <span className="font-mono">{t.ticket_no}</span> ·{" "}
            <Link to="/projects/$projectId" params={{ projectId: t.project_id }} className="text-primary hover:underline">
              {t.projects?.code} — {t.projects?.name}
            </Link>
          </div>
          <div className="mt-0.5">{t.problem}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>แจ้ง {formatDate(t.reported_on)}</span>
            {t.reporter ? <span>· {t.reporter}</span> : null}
            {t.part_category ? <span>· {t.part_category}</span> : null}
            {warranty}
          </div>
        </div>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          value={t.status}
          disabled={!canPlanWork}
          onChange={(e) => update.mutate({ status: e.target.value })}
        >
          {TICKET_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {t.work_order_id ? (
          <Link to="/work-orders/$woId" params={{ woId: t.work_order_id }} className="rounded border border-border px-2 py-1 hover:bg-secondary">
            ใบงานซ่อม
          </Link>
        ) : null}
        {t.production_wo_id ? (
          <Link to="/work-orders/$woId" params={{ woId: t.production_wo_id }} className="rounded border border-border px-2 py-1 hover:bg-secondary">
            ใบผลิต (ซ่อม)
          </Link>
        ) : null}
        {t.quote_project_id ? (
          <Link to="/projects/$projectId" params={{ projectId: t.quote_project_id }} className="rounded border border-border px-2 py-1 hover:bg-secondary">
            โปรเจกต์เสนอราคาใหม่
          </Link>
        ) : null}
        {canPlanWork && !t.work_order_id && !t.quote_project_id ? (
          <>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={needsProduction} onChange={(e) => setNeedsProduction(e.target.checked)} />
              ต้องผลิตด้วย
            </label>
            <Button size="sm" variant={t.in_warranty === false ? "outline" : "default"} disabled={makeJobs.isPending} onClick={() => makeJobs.mutate()}>
              สร้างใบงานซ่อม
            </Button>
            <Button size="sm" variant={t.in_warranty === false ? "default" : "outline"} disabled={quote.isPending} onClick={() => quote.mutate()}>
              เสนอราคาใหม่
            </Button>
          </>
        ) : null}
      </div>
    </li>
  );
}
