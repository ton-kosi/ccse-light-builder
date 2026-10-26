import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCustomerNames } from "@/hooks/useCustomerNames";
import { PageHeader } from "@/components/AppLayout";
import { Field, Td, Th } from "@/routes/_authenticated/customers";
import { QuotationSection } from "@/components/boq/QuotationSection";
import { useCurrentQuotation } from "@/hooks/useCurrentQuotation";
import { WorkSheet } from "@/components/work/WorkSheet";
import { PaymentTermsSection } from "@/components/payments/PaymentTermsSection";
import { JobFiles } from "@/components/work/JobFiles";
import { MeasureSection } from "@/components/work/MeasureSection";
import { ProductionSheet } from "@/components/work/ProductionSheet";
import { MaterialSection } from "@/components/work/MaterialSection";
import { deleteProjectWithFiles } from "@/lib/projectDelete";
import { TicketRow, useTickets, WarrantyCard } from "@/components/repairs/Repairs";
import { adjustmentsOf, computeTotals, optionNames, quotationRevisionSuffix } from "@/lib/boq";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/hooks/useMe";
import type { Tables, TablesUpdate } from "@/integrations/supabase/types";
import {
  PROJECT_STATUSES,
  RELEASE_MIN_STATUS,
  WO_TYPES,
  statusLabel,
  woStatusLabel,
  woTypeLabel,
} from "@/lib/erp";
import { formatDate, formatQty, formatTHB, toNumber } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "รายละเอียดงาน | CCSE ERP" },
      { name: "description", content: "ภาพรวมงาน BOQ ใบสั่งงาน และงวดเงินของโปรเจกต์" },
      { property: "og:title", content: "รายละเอียดงาน | CCSE ERP" },
      { property: "og:description", content: "ภาพรวมงาน BOQ ใบสั่งงาน และงวดเงินของโปรเจกต์" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ProjectDetail,
});

type QLine = Tables<"quote_lines">;

function ProjectDetail() {
  const { projectId } = Route.useParams();
  const {
    canSeeMoney,
    canEditQuote,
    canViewQuote,
    canEditSales,
    canEditProduction,
    canEditProductionSheet,
    isAdmin,
    canManagePayments,
    canViewPayments,
  } = useMe();
  const queryClient = useQueryClient();
  const custName = useCustomerNames();
  const { quotation, lines } = useCurrentQuotation(projectId, canViewQuote);

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*, customers(name, contact_person, phone)")
        .eq("id", projectId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const updateProject = useMutation({
    mutationFn: async (patch: TablesUpdate<"projects">) => {
      const { error } = await supabase.from("projects").update(patch).eq("id", projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("อัปเดตโปรเจกต์แล้ว");
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["status_log", projectId] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>;
  if (!project) return <p className="text-sm text-muted-foreground">ไม่พบโปรเจกต์นี้</p>;

  const customer = { name: custName(project.customer_id, project.customers) };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${project.code} — ${project.name}`}
        description={`ลูกค้า: ${customer?.name ?? "ไม่ระบุ"}${
          project.attn ? " · เรียน " + project.attn : ""
        } · ${statusLabel(project.status)}`}
        actions={
          <Link
            to="/projects"
            className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm"
          >
            กลับรายการงาน
          </Link>
        }
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">ภาพรวม</TabsTrigger>
          <TabsTrigger value="boq">BOQ</TabsTrigger>
          <TabsTrigger value="work">ใบ Work</TabsTrigger>
          {canViewPayments ? <TabsTrigger value="payment">งวดเงิน</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-6">
          <OverviewTab
            project={project}
            lines={lines}
            quotation={quotation}
            canSeeMoney={canViewQuote}
            canEditSales={canEditSales}
            canEditStatus={canEditProduction}
            isAdmin={isAdmin}
            onUpdate={(p) => updateProject.mutate(p)}
          />
          <section className="space-y-6 rounded-lg border border-border bg-card p-4">
            <JobFiles
              projectId={project.id}
              workOrderId={null}
              kind="drawing"
              title="แบบ / drawing ของโปรเจกต์"
              hint="ช่างและฝ่ายผลิตเห็นแบบนี้ในทุกใบสั่งงานของโปรเจกต์"
            />
            <JobFiles projectId={project.id} workOrderId={null} kind="photo" title="รูปหน้างาน" />
          </section>
          <WarrantyCard projectId={project.id} />
          <ProjectTickets projectId={project.id} />
          {isAdmin ? <DeleteProject id={project.id} code={project.code} /> : null}
        </TabsContent>

        <TabsContent value="boq" className="mt-4">
          {canViewQuote ? (
            <QuotationSection
              projectId={projectId}
              projectCode={project.code}
              selectedOption={project.selected_option}
              canEdit={canEditQuote}
              canSeeCost={canSeeMoney}
              canManagePayments={canManagePayments}
            />
          ) : (
            <HiddenMoney />
          )}
        </TabsContent>

        <TabsContent value="work" className="mt-4 space-y-6">
          <WorkSheet projectId={projectId} />
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-1 text-sm font-semibold">วัดหน้างาน</h2>
            <MeasureSection projectId={projectId} workOrderId={null} canEdit={canEditProduction} />
          </section>
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-1 text-sm font-semibold">ใบผลิต (ตัดไฟ)</h2>
            <ProductionSheet projectId={projectId} canEdit={canEditProductionSheet} />
          </section>
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-1 text-sm font-semibold">เบิกของ / คืนของ</h2>
            <MaterialSection projectId={projectId} />
          </section>
          <WorkOrderSection
            projectId={projectId}
            projectStatus={project.status}
            canEdit={canEditProduction}
          />
        </TabsContent>

        <TabsContent value="payment" className="mt-4">
          {canViewPayments ? <PaymentTermsSection projectId={projectId} /> : <HiddenMoney />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function HiddenMoney() {
  return (
    <section className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
      ใบเสนอราคาและราคาทั้งหมดถูกซ่อนไว้สำหรับสิทธิ์ของคุณ — ดูงานที่ต้องทำได้จากแท็บใบ Work
    </section>
  );
}

/* ---------------- Overview ---------------- */

type ProjTextKey = "name" | "attn" | "po_number" | "site_address" | "site_contacts" | "schedule_note";
type ProjNumKey = "install_days_min" | "install_days_max" | "install_days_actual";

function OverviewTab({
  project,
  lines,
  quotation,
  canSeeMoney,
  canEditSales,
  canEditStatus,
  isAdmin,
  onUpdate,
}: {
  project: Tables<"projects">;
  lines: QLine[];
  quotation: Tables<"quotations"> | null;
  canSeeMoney: boolean;
  canEditSales: boolean;
  canEditStatus: boolean;
  isAdmin: boolean;
  onUpdate: (p: TablesUpdate<"projects">) => void;
}) {
  const opts = optionNames(lines);
  const totals = quotation
    ? computeTotals(
        lines,
        Number(quotation.discount ?? 0),
        Number(quotation.vat_percent ?? 0),
        project.selected_option,
        adjustmentsOf(quotation.adjustments),
      )
    : null;
  const max = project.install_days_max;
  const actual = project.install_days_actual;
  const { canManagePayments } = useMe();
  const qcFin = useQueryClient();
  const { data: finance } = useQuery({
    queryKey: ["project_finance", project.id],
    enabled: canManagePayments,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_finance")
        .select("*")
        .eq("project_id", project.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const saveRate = useMutation({
    mutationFn: async (v: number | null) => {
      const { error } = await supabase
        .from("project_finance")
        .upsert({ project_id: project.id, overrun_rate_per_day: v });
      if (error) throw error;
    },
    onSuccess: () => qcFin.invalidateQueries({ queryKey: ["project_finance", project.id] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const rate = finance?.overrun_rate_per_day ?? null;
  const overrunDays =
    actual !== null && max !== null ? Math.max(0, Number(actual) - Number(max)) : null;
  const overrun = overrunDays !== null ? overrunDays * Number(rate ?? 0) : null;

  const changeStatus = (next: number) => {
    if (next >= 4 && opts.length > 0 && !project.selected_option) {
      toast.error("ต้องเลือก Option ที่ลูกค้าเลือกก่อนเปลี่ยนสถานะเป็นขั้น 4 ขึ้นไป");
      return;
    }
    if (next >= 6 && !project.released_by) {
      toast.error('ต้องระบุ "ปล่อยงานโดย" ก่อนเปลี่ยนสถานะเป็นขั้น 6');
      return;
    }
    onUpdate({ status: next });
  };

  const textField = (label: string, key: ProjTextKey, className = "") => (
    <Field label={label} className={className}>
      <Input
        key={String(project[key] ?? "")}
        defaultValue={project[key] ?? ""}
        disabled={!canEditSales}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v === (project[key] ?? "")) return;
          if (key === "name" && !v) return;
          onUpdate({ [key]: v || null } as TablesUpdate<"projects">);
        }}
      />
    </Field>
  );

  const numField = (label: string, key: ProjNumKey) => (
    <Field label={label}>
      <Input
        key={String(project[key] ?? "")}
        inputMode="decimal"
        defaultValue={project[key] === null ? "" : String(project[key])}
        disabled={!canEditSales}
        onBlur={(e) => {
          let n = toNumber(e.target.value);
          if (n !== null && (key === "install_days_min" || key === "install_days_max"))
            n = Math.round(n);
          if (n !== (project[key] === null ? null : Number(project[key])))
            onUpdate({ [key]: n } as TablesUpdate<"projects">);
        }}
      />
    </Field>
  );

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-3">
        <Stat
          label={`ยอดใบเสนอราคาปัจจุบัน${quotation ? quotationRevisionSuffix(quotation.rev) : ""}`}
          value={
            !canSeeMoney ? "—" : totals ? formatTHB(totals.net) + " บาท" : "ยังไม่มีใบเสนอราคา"
          }
          hint={
            !canSeeMoney
              ? "ซ่อนราคาตามสิทธิ์"
              : opts.length && !project.selected_option
                ? "ยังไม่เลือก Option — นับเฉพาะรายการหลัก"
                : project.selected_option
                  ? `รวม Option ${project.selected_option}`
                  : undefined
          }
        />
        <Stat
          label="จำนวนวันติดตั้ง"
          value={
            project.install_days_min === null && project.install_days_max === null
              ? "-"
              : `${project.install_days_min ?? "-"} – ${project.install_days_max ?? "-"} วัน`
          }
          hint={actual !== null ? `ใช้จริง ${formatQty(Number(actual))} วัน` : undefined}
        />
        <Stat
          label="ค่าเกินวันติดตั้ง"
          value={!canManagePayments ? "—" : overrun === null ? "-" : formatTHB(overrun) + " บาท"}
          hint={
            !canManagePayments
              ? overrunDays !== null
                ? `เกิน ${formatQty(overrunDays)} วัน · ซ่อนจำนวนเงินตามสิทธิ์`
                : "ซ่อนจำนวนเงินตามสิทธิ์"
              : overrunDays !== null
                ? `เกิน ${formatQty(overrunDays)} วัน × ${formatTHB(Number(rate ?? 0))} บาท/วัน`
                : "คำนวณเมื่อกรอกวันติดตั้งจริงและวันสูงสุด"
          }
        />
      </section>

      <section className="grid gap-4 rounded-lg border border-border bg-card p-4 md:grid-cols-3">
        <Field label="สถานะงาน">
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={project.status}
            disabled={!canEditStatus}
            onChange={(e) => changeStatus(Number(e.target.value))}
          >
            {PROJECT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Option ที่ลูกค้าเลือก">
          {opts.length ? (
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={project.selected_option ?? ""}
              disabled={!canEditSales}
              onChange={(e) => onUpdate({ selected_option: e.target.value || null })}
            >
              <option value="">— ยังไม่เลือก —</option>
              {opts.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <Input
              key={project.selected_option ?? ""}
              defaultValue={project.selected_option ?? ""}
              disabled={!canEditSales}
              placeholder="ไม่มี Option"
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== (project.selected_option ?? "")) onUpdate({ selected_option: v || null });
              }}
            />
          )}
        </Field>
        <Field label="ปล่อยงานโดย">
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={project.released_by ?? ""}
            disabled={!canEditSales}
            onChange={(e) => onUpdate({ released_by: e.target.value || null })}
          >
            <option value="">— ยังไม่ระบุ —</option>
            <option value="deposit">รับมัดจำแล้ว</option>
            <option value="ceo" disabled={!isAdmin}>
              CEO อนุมัติ{isAdmin ? "" : " (เฉพาะผู้ดูแลระบบ)"}
            </option>
          </select>
        </Field>
        {textField("ชื่องาน", "name")}
        {textField("เรียน (Attn)", "attn")}
        {textField("เลข PO", "po_number")}
        {textField("สถานที่ติดตั้ง", "site_address", "md:col-span-3")}
        {textField("ติดต่อหน้างาน (ชื่อ : เบอร์)", "site_contacts", "md:col-span-2")}
        {textField("กำหนดการ (ประกอบ / ติดตั้ง / ส่ง)", "schedule_note")}
        {numField("วันติดตั้งต่ำสุด", "install_days_min")}
        {numField("วันติดตั้งสูงสุด", "install_days_max")}
        {canManagePayments ? (
          <Field label="ค่าเกินวัน (บาท/วัน)">
            <Input
              key={String(rate ?? "")}
              inputMode="decimal"
              defaultValue={rate === null ? "" : String(rate)}
              onBlur={(e) => {
                const n = toNumber(e.target.value);
                if (n !== (rate === null ? null : Number(rate))) saveRate.mutate(n);
              }}
            />
          </Field>
        ) : null}
        <Field label="วันเริ่มติดตั้ง">
          <Input
            type="date"
            key={project.install_start_date ?? ""}
            defaultValue={project.install_start_date ?? ""}
            disabled={!canEditSales}
            onBlur={(e) => {
              if (e.target.value !== (project.install_start_date ?? ""))
                onUpdate({ install_start_date: e.target.value || null });
            }}
          />
        </Field>
        {numField("วันติดตั้งจริง (วันทำงาน)", "install_days_actual")}
        <div className="flex items-end text-xs text-muted-foreground">
          ปล่อยใบ Work ได้เมื่อสถานะถึงขั้น {RELEASE_MIN_STATUS}
        </div>
        <Field label="หมายเหตุ" className="md:col-span-3">
          <Textarea
            defaultValue={project.notes ?? ""}
            disabled={!canEditSales}
            onBlur={(e) => {
              if (e.target.value !== (project.notes ?? ""))
                onUpdate({ notes: e.target.value || null });
            }}
          />
        </Field>
      </section>

      <StatusLog projectId={project.id} />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string | undefined }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function StatusLog({ projectId }: { projectId: string }) {
  const { data } = useQuery({
    queryKey: ["status_log", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_status_log")
        .select("*")
        .eq("project_id", projectId)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      const ids = Array.from(
        new Set(data.map((r) => r.changed_by).filter((x): x is string => !!x)),
      );
      const names = new Map<string, string>();
      if (ids.length) {
        const { data: profs } = await supabase.rpc("user_display_names", { _ids: ids });
        (profs ?? []).forEach((p) => names.set(p.id, p.display_name));
      }
      return data.map((r) => ({ ...r, who: (r.changed_by && names.get(r.changed_by)) || "-" }));
    },
  });
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">ประวัติการเปลี่ยนสถานะ</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <Th>วันที่</Th>
              <Th>เวลา</Th>
              <Th>จาก</Th>
              <Th>เป็น</Th>
              <Th>ผู้เปลี่ยน</Th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-border">
                <Td>{formatDate(r.changed_at)}</Td>
                <Td>
                  {new Date(r.changed_at).toLocaleTimeString("th-TH", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Td>
                <Td>{r.from_status === null ? "(สร้างงาน)" : statusLabel(r.from_status)}</Td>
                <Td>{statusLabel(r.to_status)}</Td>
                <Td>{r.who}</Td>
              </tr>
            ))}
            {data?.length === 0 ? (
              <tr>
                <Td colSpan={5}>ยังไม่มีประวัติ</Td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------------- Repair tickets of this project ---------------- */

function ProjectTickets({ projectId }: { projectId: string }) {
  const { data: tickets } = useTickets(projectId);
  if (!tickets?.length) return null;
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-2 text-sm font-semibold">ใบแจ้งซ่อมของงานนี้</h2>
      <ul className="space-y-2">
        {tickets.map((t) => (
          <TicketRow key={t.id} t={t} />
        ))}
      </ul>
    </section>
  );
}

/* ---------------- Delete (admin) ---------------- */

/** Removes the project with everything in it (quotations, work orders, bills, files). */
function DeleteProject({ id, code }: { id: string; code: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");
  const remove = useMutation({
    mutationFn: () => deleteProjectWithFiles(id),
    onSuccess: ({ left }) => {
      toast.success(left ? `ลบโปรเจกต์ ${code} แล้ว (ไฟล์ ${left} ไฟล์ลบไม่สำเร็จ)` : `ลบโปรเจกต์ ${code} และไฟล์ทั้งหมดแล้ว`);
      queryClient.removeQueries({ queryKey: ["project", id] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      navigate({ to: "/projects", replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
      <h2 className="text-sm font-semibold text-destructive">ลบโปรเจกต์ (ผู้ดูแลระบบ)</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        ลบใบเสนอราคา ใบสั่งงาน งวดเงิน รูป แบบ และลายเซ็นของโปรเจกต์นี้ทั้งหมด — กู้คืนไม่ได้ (โปรเจกต์ที่ออกใบเบิกเงินแล้วลบไม่ได้)
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          value={typed}
          placeholder={`พิมพ์ ${code} เพื่อยืนยัน`}
          onChange={(e) => setTyped(e.target.value)}
        />
        <Button
          variant="destructive"
          size="sm"
          disabled={typed.trim() !== code || remove.isPending}
          onClick={() => remove.mutate()}
        >
          {remove.isPending ? "กำลังลบ…" : "ลบโปรเจกต์นี้"}
        </Button>
      </div>
    </section>
  );
}

/* ---------------- Work orders ---------------- */

function WorkOrderSection({
  projectId,
  projectStatus,
  canEdit,
}: {
  projectId: string;
  projectStatus: number;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ title: "", wo_type: "production", scheduled_date: "", end_date: "" });

  const { data: workOrders } = useQuery({
    queryKey: ["work_orders", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("work_orders").insert({
        project_id: projectId,
        doc_no: "WO-" + new Date().getTime().toString().slice(-6),
        title: form.title,
        wo_type: form.wo_type,
        scheduled_date: form.scheduled_date || null,
        // end_date column comes with docs/sql/field_work_handover.sql; only sent when used
        ...(form.scheduled_date && form.end_date && form.end_date > form.scheduled_date
          ? { end_date: form.end_date }
          : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("สร้างใบสั่งงาน (ร่าง) แล้ว");
      setForm({ title: "", wo_type: "production", scheduled_date: "", end_date: "" });
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const release = useMutation({
    mutationFn: async (id: string) => {
      const { data: user } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("work_orders")
        .update({
          status: "released",
          released_at: new Date().toISOString(),
          released_by: user.user?.id ?? null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("ปล่อยใบสั่งงานแล้ว");
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canRelease = projectStatus >= RELEASE_MIN_STATUS;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">ใบสั่งงาน</h2>
      <p className="text-xs text-muted-foreground">
        ใบสั่งงานไม่แสดงราคาหรือต้นทุนใดๆ — ปล่อยงานได้เมื่อสถานะโปรเจกต์ถึงขั้น{" "}
        {RELEASE_MIN_STATUS}
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <Th>เลขที่</Th>
              <Th>เรื่อง</Th>
              <Th>ประเภท</Th>
              <Th>กำหนดวันที่</Th>
              <Th>สถานะ</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {(workOrders ?? []).map((w) => (
              <tr key={w.id} className="border-t border-border">
                <Td className="font-mono text-xs">
                  <Link
                    to="/work-orders/$woId"
                    params={{ woId: w.id }}
                    className="text-primary hover:underline"
                  >
                    {w.doc_no}
                  </Link>
                </Td>
                <Td className="font-medium">{w.title || "-"}</Td>
                <Td>{woTypeLabel(w.wo_type)}</Td>
                <Td>{w.scheduled_date ? formatDate(w.scheduled_date) : "-"}</Td>
                <Td>{woStatusLabel(w.status)}</Td>
                <Td>
                  {canEdit && w.status === "draft" ? (
                    <Button
                      size="sm"
                      disabled={!canRelease || release.isPending}
                      onClick={() => release.mutate(w.id)}
                    >
                      ปล่อยงาน
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
            {workOrders?.length === 0 ? (
              <tr>
                <Td colSpan={6}>ยังไม่มีใบสั่งงาน</Td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <form
          className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-3 lg:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="เรื่อง / งานที่ต้องทำ" className="sm:col-span-3 lg:col-span-2">
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="ประเภท">
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.wo_type}
              onChange={(e) => setForm({ ...form, wo_type: e.target.value })}
            >
              {WO_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="กำหนดวันที่">
            <Input
              type="date"
              value={form.scheduled_date}
              onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })}
            />
          </Field>
          <Field label="ถึงวันที่ (ถ้าหลายวัน)">
            <Input
              type="date"
              min={form.scheduled_date || undefined}
              disabled={!form.scheduled_date}
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            />
          </Field>
          <div className="sm:col-span-3 lg:col-span-5">
            <Button size="sm" type="submit" disabled={create.isPending}>
              สร้างใบสั่งงาน (ร่าง)
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
