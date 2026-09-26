import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Field, Td, Th } from "@/routes/_authenticated/customers";
import { AddRecipeItem } from "@/routes/_authenticated/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/hooks/useMe";
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
      { name: "description", content: "สถานะงาน ใบเสนอราคา BOQ สูตรเฉพาะรายการ และใบสั่งงาน" },
      { property: "og:title", content: "รายละเอียดงาน | CCSE ERP" },
      { property: "og:description", content: "สถานะงาน BOQ สูตร และใบสั่งงานของโปรเจกต์" },
    ],
  }),
  component: ProjectDetail,
});

function ProjectDetail() {
  const { projectId } = Route.useParams();
  const { canSeeMoney, canEditSales, canEditProduction, isCeo } = useMe();
  const queryClient = useQueryClient();

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
    mutationFn: async (patch: Record<string, unknown>) => {
      const { error } = await supabase.from("projects").update(patch).eq("id", projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("อัปเดตโปรเจกต์แล้ว");
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>;
  if (!project) return <p className="text-sm text-muted-foreground">ไม่พบโปรเจกต์นี้</p>;

  const customer = project.customers as
    | { name: string; contact_person: string | null; phone: string | null }
    | null;

  return (
    <div className="space-y-8">
      <PageHeader
        title={`${project.code} — ${project.name}`}
        description={`ลูกค้า: ${customer?.name ?? "ไม่ระบุ"}${
          customer?.phone ? " · โทร " + customer.phone : ""
        }`}
        actions={
          <Link
            to="/projects"
            className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm"
          >
            กลับรายการงาน
          </Link>
        }
      />

      <section className="grid gap-4 rounded-lg border border-border bg-card p-4 md:grid-cols-3">
        <Field label="สถานะงาน">
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={project.status}
            disabled={!canEditProduction}
            onChange={(e) => updateProject.mutate({ status: Number(e.target.value) })}
          >
            {PROJECT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="เลข PO">
          <Input
            defaultValue={project.po_number ?? ""}
            disabled={!canEditSales}
            onBlur={(e) => {
              if (e.target.value !== (project.po_number ?? ""))
                updateProject.mutate({ po_number: e.target.value || null });
            }}
          />
        </Field>
        <Field label="สถานที่ติดตั้ง">
          <Input
            defaultValue={project.site_address ?? ""}
            disabled={!canEditSales}
            onBlur={(e) => {
              if (e.target.value !== (project.site_address ?? ""))
                updateProject.mutate({ site_address: e.target.value || null });
            }}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2 md:col-span-3">
          <Button
            size="sm"
            variant={project.deposit_received ? "default" : "outline"}
            disabled={!canEditSales}
            onClick={() => updateProject.mutate({ deposit_received: !project.deposit_received })}
          >
            {project.deposit_received ? "รับมัดจำแล้ว ✓" : "ยังไม่รับมัดจำ"}
          </Button>
          <Button
            size="sm"
            variant={project.ceo_approved ? "default" : "outline"}
            disabled={!isCeo}
            onClick={() => updateProject.mutate({ ceo_approved: !project.ceo_approved })}
          >
            {project.ceo_approved ? "CEO อนุมัติแล้ว ✓" : "CEO ยังไม่อนุมัติ"}
          </Button>
          <span className="text-xs text-muted-foreground">
            ปล่อยใบสั่งงานได้เมื่อสถานะถึงขั้น {RELEASE_MIN_STATUS} — ปัจจุบัน{" "}
            {statusLabel(project.status)}
          </span>
        </div>
        <Field label="หมายเหตุ" className="md:col-span-3">
          <Textarea
            defaultValue={project.notes ?? ""}
            disabled={!canEditSales}
            onBlur={(e) => {
              if (e.target.value !== (project.notes ?? ""))
                updateProject.mutate({ notes: e.target.value || null });
            }}
          />
        </Field>
      </section>

      {canSeeMoney ? <QuotationSection projectId={projectId} canEdit={canEditSales} /> : (
        <section className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          ใบเสนอราคาและราคาทั้งหมดถูกซ่อนไว้สำหรับสิทธิ์ของคุณ — ดูงานที่ต้องทำได้จากใบสั่งงาน
        </section>
      )}

      <WorkOrderSection
        projectId={projectId}
        projectStatus={project.status}
        canEdit={canEditProduction}
      />
    </div>
  );
}

/* ---------------- Quotation / BOQ ---------------- */

function QuotationSection({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const queryClient = useQueryClient();
  const [openLine, setOpenLine] = useState<string | null>(null);

  const { data: quotation } = useQuery({
    queryKey: ["quotation", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotations")
        .select("*")
        .eq("project_id", projectId)
        .order("revision", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: lines } = useQuery({
    queryKey: ["quotation_lines", quotation?.id],
    enabled: !!quotation?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotation_lines")
        .select("*, sales_components(sales_name, unit)")
        .eq("quotation_id", quotation!.id)
        .order("line_no");
      if (error) throw error;
      return data;
    },
  });

  const { data: components } = useQuery({
    queryKey: ["sales_components", "options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_components")
        .select("id, code, sales_name, unit")
        .order("code");
      if (error) throw error;
      return data;
    },
  });

  const createQuotation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("quotations").insert({
        project_id: projectId,
        doc_no: "QT-" + new Date().getTime().toString().slice(-6),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("สร้างใบเสนอราคาแล้ว");
      queryClient.invalidateQueries({ queryKey: ["quotation", projectId] });
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
    }) => {
      const nextNo = (lines?.length ?? 0) + 1;
      const { error } = await supabase.from("quotation_lines").insert({
        quotation_id: quotation!.id,
        line_no: nextNo,
        sales_name: payload.sales_name,
        description: payload.description || null,
        qty: payload.is_header ? null : payload.qty,
        unit: payload.is_header ? null : payload.unit || null,
        unit_price: payload.is_header ? null : payload.unit_price,
        sales_component_id: payload.sales_component_id,
        is_header: payload.is_header,
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
    mutationFn: async (patch: Record<string, unknown>) => {
      const { error } = await supabase.from("quotations").update(patch).eq("id", quotation!.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["quotation", projectId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!quotation) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">ใบเสนอราคา (BOQ)</h2>
        <p className="mt-1 text-sm text-muted-foreground">ยังไม่มีใบเสนอราคาสำหรับงานนี้</p>
        {canEdit ? (
          <Button size="sm" className="mt-3" onClick={() => createQuotation.mutate()}>
            สร้างใบเสนอราคา
          </Button>
        ) : null}
      </section>
    );
  }

  const subtotal = (lines ?? []).reduce(
    (sum, l) => sum + Number(l.qty ?? 0) * Number(l.unit_price ?? 0),
    0,
  );
  const afterDiscount = subtotal - Number(quotation.discount ?? 0);
  const vat = (afterDiscount * Number(quotation.vat_percent ?? 0)) / 100;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
            ใบเสนอราคา {quotation.doc_no} (แก้ไขครั้งที่ {quotation.revision})
          </h2>
          <p className="text-xs text-muted-foreground">
            วันที่ {formatDate(quotation.doc_date)} · เฉพาะรายการที่มีจำนวนและหน่วยจึงแสดงราคา
          </p>
        </div>
        <div className="flex gap-2">
          <Field label="ส่วนลด (บาท)">
            <Input
              className="h-8 w-28"
              defaultValue={String(quotation.discount ?? 0)}
              disabled={!canEdit}
              onBlur={(e) => updateQuotation.mutate({ discount: toNumber(e.target.value) ?? 0 })}
            />
          </Field>
          <Field label="VAT %">
            <Input
              className="h-8 w-20"
              defaultValue={String(quotation.vat_percent ?? 7)}
              disabled={!canEdit}
              onBlur={(e) => updateQuotation.mutate({ vat_percent: toNumber(e.target.value) ?? 0 })}
            />
          </Field>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <Th>ลำดับ</Th>
              <Th>ชื่อรายการ (ชื่อที่ลูกค้าเห็น)</Th>
              <Th>จำนวน</Th>
              <Th>หน่วย</Th>
              <Th>ราคา/หน่วย</Th>
              <Th>รวม</Th>
              <Th>สูตรเฉพาะรายการ</Th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((l) => {
              const total = Number(l.qty ?? 0) * Number(l.unit_price ?? 0);
              const hasPrice = l.qty !== null && l.unit_price !== null && !l.is_header;
              return (
                <>
                  <tr key={l.id} className="border-t border-border">
                    <Td>{l.line_no}</Td>
                    <Td className={l.is_header ? "font-semibold" : "font-medium"}>
                      {l.sales_name}
                      {l.description ? (
                        <div className="text-xs text-muted-foreground">{l.description}</div>
                      ) : null}
                    </Td>
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
                      <td colSpan={7} className="px-3 py-3">
                        <LineRecipeEditor
                          lineId={l.id}
                          componentId={l.sales_component_id}
                          canEdit={canEdit}
                        />
                      </td>
                    </tr>
                  ) : null}
                </>
              );
            })}
            {lines?.length === 0 ? (
              <tr>
                <Td colSpan={7}>ยังไม่มีรายการ BOQ</Td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="mt-4 ml-auto max-w-xs space-y-1 text-sm">
        <Row label="รวมเป็นเงิน" value={formatTHB(subtotal)} />
        <Row label="ส่วนลด" value={formatTHB(Number(quotation.discount ?? 0))} />
        <Row label={`VAT ${quotation.vat_percent}%`} value={formatTHB(vat)} />
        <Row label="ยอดสุทธิ (บาท)" value={formatTHB(afterDiscount + vat)} bold />
      </div>

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

  return (
    <form
      className="mt-6 grid gap-3 border-t border-border pt-4 md:grid-cols-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!salesName.trim()) return toast.error("กรุณากรอกชื่อรายการ");
        onAdd({
          sales_name: salesName,
          description,
          qty: toNumber(qty),
          unit,
          unit_price: toNumber(price),
          sales_component_id: componentId || null,
          is_header: isHeader,
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
      <Field label="ผูกกับส่วนประกอบขาย" className="md:col-span-3">
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
    queryKey: ["recipe_items", componentId],
    enabled: !!componentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_items")
        .select("id, qty_per_unit, note, skus(code, name, unit)")
        .eq("sales_component_id", componentId!);
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
                  {it.note ? ` · ${it.note}` : ""}
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
