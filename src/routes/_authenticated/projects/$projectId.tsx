import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Field, Td, Th } from "@/routes/_authenticated/customers";
import { AddRecipeItem } from "@/components/AddRecipeItem";
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

type QLine = Tables<"quotation_lines">;

/** Base lines (no option) + lines of the chosen option. */
function computeTotals(
  lines: Pick<QLine, "qty" | "unit_price" | "is_header" | "option_name">[],
  discount: number,
  vatPercent: number,
  option: string | null,
) {
  const subtotal = lines
    .filter((l) => !l.option_name?.trim() || l.option_name.trim() === option)
    .reduce((s, l) => s + (l.is_header ? 0 : Number(l.qty ?? 0) * Number(l.unit_price ?? 0)), 0);
  const afterDiscount = subtotal - discount;
  const vat = (afterDiscount * vatPercent) / 100;
  return { subtotal, afterDiscount, vat, net: afterDiscount + vat };
}

function optionNames(lines: Pick<QLine, "option_name">[]): string[] {
  return Array.from(
    new Set(lines.map((l) => l.option_name?.trim() ?? "").filter((x) => x !== "")),
  ).sort();
}

function useCurrentQuotation(projectId: string, enabled: boolean) {
  const quotation = useQuery({
    queryKey: ["quotation", projectId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotations")
        .select("*")
        .eq("project_id", projectId)
        .eq("is_current", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const qid = quotation.data?.id;
  const lines = useQuery({
    queryKey: ["quotation_lines", qid],
    enabled: enabled && !!qid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotation_lines")
        .select("*, sales_components(name, unit)")
        .eq("quotation_id", qid!)
        .order("line_no");
      if (error) throw error;
      return data;
    },
  });
  return { quotation: quotation.data ?? null, lines: lines.data ?? [] };
}

function ProjectDetail() {
  const { projectId } = Route.useParams();
  const { canSeeMoney, canEditSales, canEditProduction, isAdmin } = useMe();
  const queryClient = useQueryClient();
  const { quotation, lines } = useCurrentQuotation(projectId, canSeeMoney);

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

  const customer = project.customers as { name: string } | null;
  const net = quotation
    ? computeTotals(
        lines,
        Number(quotation.discount ?? 0),
        Number(quotation.vat_percent ?? 0),
        project.selected_option,
      ).net
    : 0;

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
          <TabsTrigger value="payment">งวดเงิน</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab
            project={project}
            lines={lines}
            quotation={quotation}
            canSeeMoney={canSeeMoney}
            canEditSales={canEditSales}
            canEditStatus={canEditProduction}
            isAdmin={isAdmin}
            onUpdate={(p) => updateProject.mutate(p)}
          />
        </TabsContent>

        <TabsContent value="boq" className="mt-4">
          {canSeeMoney ? (
            <QuotationSection
              projectId={projectId}
              projectCode={project.code}
              selectedOption={project.selected_option}
              canEdit={canSeeMoney}
            />
          ) : (
            <HiddenMoney />
          )}
        </TabsContent>

        <TabsContent value="work" className="mt-4">
          <WorkOrderSection
            projectId={projectId}
            projectStatus={project.status}
            canEdit={canEditProduction}
          />
        </TabsContent>

        <TabsContent value="payment" className="mt-4">
          {canSeeMoney ? <PaymentTermsSection quotation={quotation} net={net} /> : <HiddenMoney />}
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

type ProjTextKey = "name" | "attn" | "po_number" | "site_address";
type ProjNumKey =
  | "install_days_min"
  | "install_days_max"
  | "overrun_rate_per_day"
  | "install_days_actual";

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
      )
    : null;
  const max = project.install_days_max;
  const actual = project.install_days_actual;
  const rate = project.overrun_rate_per_day;
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
          label={`ยอดใบเสนอราคาปัจจุบัน${quotation ? ` (Rev ${quotation.rev})` : ""}`}
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
          value={overrun === null ? "-" : formatTHB(overrun) + " บาท"}
          hint={
            overrunDays !== null
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
        {numField("วันติดตั้งต่ำสุด", "install_days_min")}
        {numField("วันติดตั้งสูงสุด", "install_days_max")}
        {numField("ค่าเกินวัน (บาท/วัน)", "overrun_rate_per_day")}
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
        {numField("วันติดตั้งจริง", "install_days_actual")}
        <div className="flex items-end text-xs text-muted-foreground">
          ปล่อยใบ Work ได้เมื่อสถานะถึงขั้น {RELEASE_MIN_STATUS}
        </div>
        <Field label="หมายเหตุ" className="md:col-span-3">
          <Textarea
            defaultValue={project.notes ?? ""}
            disabled={!canEditSales}
            onBlur={(e) => {
              if (e.target.value !== (project.notes ?? "")) onUpdate({ notes: e.target.value || null });
            }}
          />
        </Field>
      </section>

      <StatusLog projectId={project.id} />
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
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
        const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", ids);
        (profs ?? []).forEach((p) => names.set(p.id, p.full_name));
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

/* ---------------- Payment terms ---------------- */

function PaymentTermsSection({
  quotation,
  net,
}: {
  quotation: Tables<"quotations"> | null;
  net: number;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", percent: "", note: "" });
  const qid = quotation?.id;
  const { data: terms } = useQuery({
    queryKey: ["payment_terms", qid],
    enabled: !!qid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payment_terms")
        .select("*")
        .eq("quotation_id", qid!)
        .order("seq");
      if (error) throw error;
      return data;
    },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["payment_terms", qid] });
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("payment_terms").insert({
        quotation_id: qid!,
        seq: (terms?.length ?? 0) + 1,
        name: form.name.trim(),
        percent: toNumber(form.percent) ?? 0,
        note: form.note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm({ name: "", percent: "", note: "" });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TablesUpdate<"payment_terms"> }) => {
      const { error } = await supabase.from("payment_terms").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("payment_terms").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  if (!quotation)
    return (
      <section className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        สร้างใบเสนอราคาในแท็บ BOQ ก่อน จึงจะกำหนดงวดเงินได้
      </section>
    );

  const totalPct = (terms ?? []).reduce((s, t) => s + Number(t.percent), 0);
  const pctWrong = !!terms?.length && totalPct !== 100;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">
        งวดเงิน — {quotation.ref_no} Rev {quotation.rev}
      </h2>
      <p className="text-xs text-muted-foreground">ยอดสุทธิ {formatTHB(net)} บาท</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <Th>งวด</Th>
              <Th>ชื่องวด</Th>
              <Th>%</Th>
              <Th>จำนวนเงิน (บาท)</Th>
              <Th>หมายเหตุ</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {(terms ?? []).map((t) => (
              <tr key={t.id} className="border-t border-border">
                <Td>{t.seq}</Td>
                <Td>
                  <Input
                    className="h-8"
                    defaultValue={t.name}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== t.name) update.mutate({ id: t.id, patch: { name: v } });
                    }}
                  />
                </Td>
                <Td>
                  <Input
                    className="h-8 w-20"
                    defaultValue={String(t.percent)}
                    onBlur={(e) => {
                      const n = toNumber(e.target.value) ?? 0;
                      if (n !== Number(t.percent)) update.mutate({ id: t.id, patch: { percent: n } });
                    }}
                  />
                </Td>
                <Td>{formatTHB((net * Number(t.percent)) / 100)}</Td>
                <Td>
                  <Input
                    className="h-8"
                    defaultValue={t.note ?? ""}
                    onBlur={(e) => {
                      if (e.target.value !== (t.note ?? ""))
                        update.mutate({ id: t.id, patch: { note: e.target.value || null } });
                    }}
                  />
                </Td>
                <Td>
                  <Button size="sm" variant="outline" onClick={() => remove.mutate(t.id)}>
                    ลบ
                  </Button>
                </Td>
              </tr>
            ))}
            <tr className="border-t border-border font-semibold">
              <Td colSpan={2}>รวม</Td>
              <Td className={pctWrong ? "text-destructive" : ""}>{formatQty(totalPct)}%</Td>
              <Td>{formatTHB((net * totalPct) / 100)}</Td>
              <Td colSpan={2}>
                {pctWrong ? (
                  <span className="text-xs font-normal text-destructive">ผลรวมควรเท่ากับ 100%</span>
                ) : null}
              </Td>
            </tr>
          </tbody>
        </table>
      </div>
      <form
        className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!form.name.trim()) {
            toast.error("กรุณากรอกชื่องวด");
            return;
          }
          add.mutate();
        }}
      >
        <Field label="ชื่องวด *" className="md:col-span-2">
          <Input
            value={form.name}
            placeholder="เช่น มัดจำ"
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="%">
          <Input value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} />
        </Field>
        <Field label="หมายเหตุ">
          <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        <div className="flex items-end">
          <Button size="sm" type="submit" disabled={add.isPending}>
            เพิ่มงวด
          </Button>
        </div>
      </form>
    </section>
  );
}

/* ---------------- Quotation / BOQ ---------------- */

function QuotationSection({
  projectId,
  projectCode,
  selectedOption,
  canEdit,
}: {
  projectId: string;
  projectCode: string;
  selectedOption: string | null;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [openLine, setOpenLine] = useState<string | null>(null);
  const { quotation, lines } = useCurrentQuotation(projectId, true);

  const { data: revisions } = useQuery({
    queryKey: ["quotation_revs", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotations")
        .select("id, rev, date, is_current")
        .eq("project_id", projectId)
        .order("rev");
      if (error) throw error;
      return data;
    },
  });

  const { data: components } = useQuery({
    queryKey: ["sales_components", "options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_components")
        .select("id, code, sales_name:name, unit")
        .order("code");
      if (error) throw error;
      return data;
    },
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["quotation", projectId] });
    queryClient.invalidateQueries({ queryKey: ["quotation_revs", projectId] });
    queryClient.invalidateQueries({ queryKey: ["quotation_lines"] });
    queryClient.invalidateQueries({ queryKey: ["payment_terms"] });
  };

  const createQuotation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("quotations").insert({
        project_id: projectId,
        ref_no: projectCode,
        rev: "A",
        is_current: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("สร้างใบเสนอราคาแล้ว");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const newRev = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("create_quotation_revision", { _project_id: projectId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("สร้าง Rev ใหม่แล้ว");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addLine = useMutation({
    mutationFn: async (payload: {
      sales_name: string;
      description: string;
      qty: number | null;
      unit: string;
      unit_price: number | null;
      sales_component_id: string | null;
      is_header: boolean;
      option_name: string;
    }) => {
      const { error } = await supabase.from("quotation_lines").insert({
        quotation_id: quotation!.id,
        line_no: lines.length + 1,
        sales_name: payload.sales_name,
        description: payload.description || null,
        qty: payload.is_header ? null : payload.qty,
        unit: payload.is_header ? null : payload.unit || null,
        unit_price: payload.is_header ? null : payload.unit_price,
        sales_component_id: payload.sales_component_id,
        is_header: payload.is_header,
        option_name: payload.option_name.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("เพิ่มรายการ BOQ แล้ว");
      queryClient.invalidateQueries({ queryKey: ["quotation_lines", quotation?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeLine = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("quotation_lines").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["quotation_lines", quotation?.id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const updateQuotation = useMutation({
    mutationFn: async (patch: TablesUpdate<"quotations">) => {
      const { error } = await supabase.from("quotations").update(patch).eq("id", quotation!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quotation", projectId] });
      queryClient.invalidateQueries({ queryKey: ["quotation_revs", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!quotation) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">ใบเสนอราคา (BOQ)</h2>
        <p className="mt-1 text-sm text-muted-foreground">ยังไม่มีใบเสนอราคาสำหรับงานนี้</p>
        {canEdit ? (
          <Button size="sm" className="mt-3" onClick={() => createQuotation.mutate()}>
            สร้างใบเสนอราคา (Rev A)
          </Button>
        ) : null}
      </section>
    );
  }

  const discount = Number(quotation.discount ?? 0);
  const vatPct = Number(quotation.vat_percent ?? 0);
  const opts = optionNames(lines);
  const totalsFor = (o: string | null) => computeTotals(lines, discount, vatPct, o);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
            ใบเสนอราคา {quotation.ref_no} · Rev {quotation.rev} (ฉบับปัจจุบัน)
          </h2>
          <p className="text-xs text-muted-foreground">
            Rev ทั้งหมด:{" "}
            {(revisions ?? [])
              .map((r) => `${r.rev} (${formatDate(r.date)})${r.is_current ? " ✓" : ""}`)
              .join(" · ")}{" "}
            · เฉพาะรายการที่มีจำนวนและหน่วยจึงแสดงราคา
          </p>
        </div>
        {canEdit ? (
          <Button size="sm" variant="outline" disabled={newRev.isPending} onClick={() => newRev.mutate()}>
            สร้าง Rev ใหม่
          </Button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-6" key={quotation.id}>
        <Field label="เลขที่อ้างอิง">
          <Input
            defaultValue={quotation.ref_no}
            disabled={!canEdit}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== quotation.ref_no) updateQuotation.mutate({ ref_no: v });
            }}
          />
        </Field>
        <Field label="วันที่">
          <Input
            type="date"
            defaultValue={quotation.date}
            disabled={!canEdit}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== quotation.date)
                updateQuotation.mutate({ date: e.target.value });
            }}
          />
        </Field>
        <Field label="ยืนราคา (วัน)">
          <Input
            defaultValue={quotation.validity_days === null ? "" : String(quotation.validity_days)}
            disabled={!canEdit}
            onBlur={(e) => {
              const n = toNumber(e.target.value);
              const v = n === null ? null : Math.round(n);
              if (v !== quotation.validity_days) updateQuotation.mutate({ validity_days: v });
            }}
          />
        </Field>
        <Field label="การส่งมอบ" className="md:col-span-3">
          <Input
            defaultValue={quotation.delivery_text ?? ""}
            disabled={!canEdit}
            onBlur={(e) => {
              if (e.target.value !== (quotation.delivery_text ?? ""))
                updateQuotation.mutate({ delivery_text: e.target.value || null });
            }}
          />
        </Field>
        <Field label="ส่วนลด (บาท)">
          <Input
            defaultValue={String(quotation.discount ?? 0)}
            disabled={!canEdit}
            onBlur={(e) => updateQuotation.mutate({ discount: toNumber(e.target.value) ?? 0 })}
          />
        </Field>
        <Field label="VAT %">
          <Input
            defaultValue={String(quotation.vat_percent ?? 7)}
            disabled={!canEdit}
            onBlur={(e) => updateQuotation.mutate({ vat_percent: toNumber(e.target.value) ?? 0 })}
          />
        </Field>
        <Field label="หมายเหตุ" className="md:col-span-4">
          <Input
            defaultValue={quotation.notes ?? ""}
            disabled={!canEdit}
            onBlur={(e) => {
              if (e.target.value !== (quotation.notes ?? ""))
                updateQuotation.mutate({ notes: e.target.value || null });
            }}
          />
        </Field>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <Th>ลำดับ</Th>
              <Th>ชื่อรายการ (ชื่อที่ลูกค้าเห็น)</Th>
              <Th>Option</Th>
              <Th>จำนวน</Th>
              <Th>หน่วย</Th>
              <Th>ราคา/หน่วย</Th>
              <Th>รวม</Th>
              <Th>สูตรเฉพาะรายการ</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const total = Number(l.qty ?? 0) * Number(l.unit_price ?? 0);
              const hasPrice = l.qty !== null && l.unit_price !== null && !l.is_header;
              return (
                <Fragment key={l.id}>
                  <tr className="border-t border-border">
                    <Td>{l.line_no}</Td>
                    <Td className={l.is_header ? "font-semibold" : "font-medium"}>
                      {l.sales_name}
                      {l.description ? (
                        <div className="text-xs text-muted-foreground">{l.description}</div>
                      ) : null}
                    </Td>
                    <Td>{l.option_name ?? ""}</Td>
                    <Td>{l.is_header ? "" : formatQty(l.qty === null ? null : Number(l.qty))}</Td>
                    <Td>{l.unit ?? ""}</Td>
                    <Td>{hasPrice ? formatTHB(Number(l.unit_price)) : ""}</Td>
                    <Td>{hasPrice ? formatTHB(total) : ""}</Td>
                    <Td>
                      <div className="flex gap-2">
                        {!l.is_header ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setOpenLine(openLine === l.id ? null : l.id)}
                          >
                            {openLine === l.id ? "ปิด" : "สูตร"}
                          </Button>
                        ) : null}
                        {canEdit ? (
                          <Button size="sm" variant="outline" onClick={() => removeLine.mutate(l.id)}>
                            ลบ
                          </Button>
                        ) : null}
                      </div>
                    </Td>
                  </tr>
                  {openLine === l.id ? (
                    <tr className="border-t border-border bg-secondary/40">
                      <td colSpan={8} className="px-3 py-3">
                        <LineRecipeEditor
                          lineId={l.id}
                          componentId={l.sales_component_id}
                          canEdit={canEdit}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {lines.length === 0 ? (
              <tr>
                <Td colSpan={8}>ยังไม่มีรายการ BOQ</Td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {opts.length === 0 || selectedOption ? (
        <TotalsBox
          title={selectedOption ? `รวม Option ${selectedOption} (ลูกค้าเลือก)` : undefined}
          t={totalsFor(selectedOption)}
          discount={discount}
          vatPct={vatPct}
        />
      ) : (
        <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {opts.map((o) => (
            <TotalsBox key={o} title={`Option ${o}`} t={totalsFor(o)} discount={discount} vatPct={vatPct} />
          ))}
        </div>
      )}

      {canEdit ? (
        <AddBoqLine
          components={components ?? []}
          pending={addLine.isPending}
          onAdd={(p) => addLine.mutate(p)}
        />
      ) : null}
    </section>
  );
}

function TotalsBox({
  title,
  t,
  discount,
  vatPct,
}: {
  title?: string;
  t: ReturnType<typeof computeTotals>;
  discount: number;
  vatPct: number;
}) {
  return (
    <div className="mt-4 ml-auto w-full max-w-xs space-y-1 text-sm">
      {title ? <div className="font-semibold">{title}</div> : null}
      <Row label="รวมเป็นเงิน" value={formatTHB(t.subtotal)} />
      <Row label="ส่วนลด" value={formatTHB(discount)} />
      <Row label={`VAT ${vatPct}%`} value={formatTHB(t.vat)} />
      <Row label="ยอดสุทธิ (บาท)" value={formatTHB(t.net)} bold />
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={"flex justify-between " + (bold ? "border-t border-border pt-1 font-semibold" : "")}>
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function AddBoqLine({
  components,
  onAdd,
  pending,
}: {
  components: { id: string; code: string; sales_name: string; unit: string }[];
  onAdd: (p: {
    sales_name: string;
    description: string;
    qty: number | null;
    unit: string;
    unit_price: number | null;
    sales_component_id: string | null;
    is_header: boolean;
    option_name: string;
  }) => void;
  pending?: boolean;
}) {
  const [salesName, setSalesName] = useState("");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [price, setPrice] = useState("");
  const [componentId, setComponentId] = useState("");
  const [isHeader, setIsHeader] = useState(false);
  const [optionName, setOptionName] = useState("");

  return (
    <form
      className="mt-6 grid gap-3 border-t border-border pt-4 md:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!salesName.trim()) { toast.error("กรุณากรอกชื่อรายการ"); return; }
        onAdd({
          sales_name: salesName,
          description,
          qty: toNumber(qty),
          unit,
          unit_price: toNumber(price),
          sales_component_id: componentId || null,
          is_header: isHeader,
          option_name: optionName,
        });
        setSalesName("");
        setDescription("");
        setQty("");
        setUnit("");
        setPrice("");
        setComponentId("");
      }}
    >
      <Field label="ชื่อรายการ *" className="md:col-span-2">
        <Input value={salesName} onChange={(e) => setSalesName(e.target.value)} />
      </Field>
      <Field label="รายละเอียด" className="md:col-span-2">
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="จำนวน">
        <Input value={qty} onChange={(e) => setQty(e.target.value)} disabled={isHeader} />
      </Field>
      <Field label="หน่วย">
        <Input value={unit} onChange={(e) => setUnit(e.target.value)} disabled={isHeader} />
      </Field>
      <Field label="ราคา/หน่วย (บาท)">
        <Input value={price} onChange={(e) => setPrice(e.target.value)} disabled={isHeader} />
      </Field>
      <Field label="Option (เว้นว่าง = รายการหลัก)">
        <Input value={optionName} placeholder="เช่น A" onChange={(e) => setOptionName(e.target.value)} />
      </Field>
      <Field label="ผูกกับส่วนประกอบขาย" className="md:col-span-2">
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={componentId}
          onChange={(e) => setComponentId(e.target.value)}
        >
          <option value="">— ไม่ผูก (ใช้สูตรเฉพาะรายการ) —</option>
          {components.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.sales_name}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex items-end gap-3 md:col-span-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={isHeader}
            onChange={(e) => setIsHeader(e.target.checked)}
          />
          เป็นหัวข้อ (ไม่มีราคา)
        </label>
        <Button size="sm" type="submit" disabled={pending}>
          เพิ่มรายการ
        </Button>
      </div>
    </form>
  );
}

function LineRecipeEditor({
  lineId,
  componentId,
  canEdit,
}: {
  lineId: string;
  componentId: string | null;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();

  const { data: lineItems } = useQuery({
    queryKey: ["line_recipes", lineId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("line_recipes")
        .select("id, qty_per_unit, note, skus(code, name, unit)")
        .eq("quotation_line_id", lineId);
      if (error) throw error;
      return data;
    },
  });

  const { data: stdItems } = useQuery({
    queryKey: ["recipes", componentId],
    enabled: !!componentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select("id, qty_per_unit, skus(code, name, unit)")
        .eq("component_id", componentId!);
      if (error) throw error;
      return data;
    },
  });

  const { data: skus } = useQuery({
    queryKey: ["skus", "options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("skus").select("id, code, name, unit").order("code");
      if (error) throw error;
      return data;
    },
  });

  const add = useMutation({
    mutationFn: async (p: { sku_id: string; qty: number; note: string }) => {
      const { error } = await supabase.from("line_recipes").insert({
        quotation_line_id: lineId,
        sku_id: p.sku_id,
        qty_per_unit: p.qty,
        note: p.note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("เพิ่มรายการในสูตรเฉพาะแล้ว");
      queryClient.invalidateQueries({ queryKey: ["line_recipes", lineId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("line_recipes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["line_recipes", lineId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3">
      {componentId ? (
        <div>
          <div className="text-xs font-semibold text-muted-foreground">
            สูตรมาตรฐานจากส่วนประกอบ (ต่อ 1 หน่วย)
          </div>
          <ul className="mt-1 text-sm">
            {(stdItems ?? []).map((it) => {
              const sku = it.skus as { code: string; name: string; unit: string } | null;
              return (
                <li key={it.id}>
                  • {sku?.name} ({sku?.code}) — {formatQty(Number(it.qty_per_unit))} {sku?.unit}
                </li>
              );
            })}
            {stdItems?.length === 0 ? <li className="text-muted-foreground">— ไม่มี —</li> : null}
          </ul>
        </div>
      ) : null}

      <div>
        <div className="text-xs font-semibold text-muted-foreground">
          สูตรเฉพาะรายการนี้ (ต่อ 1 หน่วย)
        </div>
        <ul className="mt-1 space-y-1 text-sm">
          {(lineItems ?? []).map((it) => {
            const sku = it.skus as { code: string; name: string; unit: string } | null;
            return (
              <li key={it.id} className="flex items-center gap-3">
                <span>
                  • {sku?.name} ({sku?.code}) — {formatQty(Number(it.qty_per_unit))} {sku?.unit}
                  {"note" in it && it.note ? ` · ${it.note}` : ""}
                </span>
                {canEdit ? (
                  <Button size="sm" variant="outline" onClick={() => remove.mutate(it.id)}>
                    ลบ
                  </Button>
                ) : null}
              </li>
            );
          })}
          {lineItems?.length === 0 ? <li className="text-muted-foreground">— ไม่มี —</li> : null}
        </ul>
      </div>

      {canEdit ? (
        <AddRecipeItem
          skus={skus ?? []}
          onAdd={(p) => add.mutate(p)}
          pending={add.isPending}
          label="เพิ่มเข้าสูตรเฉพาะรายการ"
        />
      ) : null}
    </div>
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
  const [form, setForm] = useState({ title: "", wo_type: "production", scheduled_date: "" });

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
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("สร้างใบสั่งงาน (ร่าง) แล้ว");
      setForm({ title: "", wo_type: "production", scheduled_date: "" });
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
        ใบสั่งงานไม่แสดงราคาหรือต้นทุนใดๆ — ปล่อยงานได้เมื่อสถานะโปรเจกต์ถึงขั้น {RELEASE_MIN_STATUS}
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
          className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="เรื่อง / งานที่ต้องทำ" className="md:col-span-2">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
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
          <div className="md:col-span-4">
            <Button size="sm" type="submit" disabled={create.isPending}>
              สร้างใบสั่งงาน (ร่าง)
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
