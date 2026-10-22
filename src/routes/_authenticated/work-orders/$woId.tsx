import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCustomerNames } from "@/hooks/useCustomerNames";
import { PageHeader } from "@/components/AppLayout";
import { Field, Td, Th } from "@/routes/_authenticated/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/hooks/useMe";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { RELEASE_MIN_STATUS, WO_STATUSES, statusLabel, woStatusLabel, woTypeLabel } from "@/lib/erp";
import { formatDate, formatQty, toNumber } from "@/lib/format";
import { WorkPlanSection } from "@/components/work/WorkPlanSection";
import { JobFiles } from "@/components/work/JobFiles";
import { HandoverSection } from "@/components/work/HandoverSection";

export const Route = createFileRoute("/_authenticated/work-orders/$woId")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "ใบสั่งงาน | CCSE ERP" },
      { name: "description", content: "รายละเอียดใบสั่งงานและรายการของที่ต้องเบิก (ไม่แสดงราคา)" },
      { property: "og:title", content: "ใบสั่งงาน | CCSE ERP" },
      { property: "og:description", content: "รายละเอียดงานและของที่ต้องเบิกสำหรับฝ่ายผลิตและช่าง" },
    ],
  }),
  component: WorkOrderDetail,
});

function WorkOrderDetail() {
  const { woId } = Route.useParams();
  const { canEditProduction, canPlanWork, roles } = useMe();
  const queryClient = useQueryClient();
  const custName = useCustomerNames();
  const isTechnician = roles.includes("technician") && !canEditProduction;

  const { data: wo, isLoading } = useQuery({
    queryKey: ["work_order", woId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select("*, projects(id, code, name, status, site_address, customer_id, customers(name, phone))")
        .eq("id", woId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: items } = useQuery({
    queryKey: ["work_order_items", woId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_order_items")
        .select("*, skus(code, name, unit)")
        .eq("work_order_id", woId)
        .order("created_at");
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

  const updateWo = useMutation({
    mutationFn: async (patch: TablesUpdate<"work_orders">) => {
      const { error } = await supabase.from("work_orders").update(patch).eq("id", woId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("อัปเดตใบสั่งงานแล้ว");
      queryClient.invalidateQueries({ queryKey: ["work_order", woId] });
      queryClient.invalidateQueries({ queryKey: ["work_orders"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addItem = useMutation({
    mutationFn: async (p: { sku_id: string; qty: number; note: string }) => {
      const sku = (skus ?? []).find((s) => s.id === p.sku_id);
      const { error } = await supabase.from("work_order_items").insert({
        work_order_id: woId,
        sku_id: p.sku_id,
        item_name: sku ? `${sku.name}` : "รายการ",
        unit: sku?.unit ?? null,
        qty: p.qty,
        note: p.note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("เพิ่มรายการของที่ต้องเบิกแล้ว");
      queryClient.invalidateQueries({ queryKey: ["work_order_items", woId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("work_order_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work_order_items", woId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const setIssued = useMutation({
    mutationFn: async ({ id, qty }: { id: string; qty: number }) => {
      const { error } = await supabase.from("work_order_items").update({ issued_qty: qty }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("บันทึกจำนวนที่เบิกแล้ว");
      queryClient.invalidateQueries({ queryKey: ["work_order_items", woId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">กำลังโหลด...</p>;
  if (!wo) return <p className="text-sm text-muted-foreground">ไม่พบใบสั่งงานนี้</p>;

  const project = wo.projects as
    | {
        id: string;
        code: string;
        name: string;
        status: number;
        site_address: string | null;
        customer_id: string | null;
        customers: { name: string; phone: string | null } | null;
      }
    | null;
  const canRelease = (project?.status ?? 0) >= RELEASE_MIN_STATUS;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`ใบสั่งงาน ${wo.doc_no}`}
        description={`${project?.code ?? ""} — ${project?.name ?? ""} · ${woTypeLabel(wo.wo_type)} · ${woStatusLabel(wo.status)}`}
        actions={
          <Link
            to="/work-orders"
            className="inline-flex h-9 items-center rounded-md border border-input px-3 text-sm"
          >
            กลับรายการใบสั่งงาน
          </Link>
        }
      />

      <section className="grid gap-4 rounded-lg border border-border bg-card p-4 md:grid-cols-3">
        <InfoRow label="งาน">
          {project ? (
            <Link
              to="/projects/$projectId"
              params={{ projectId: project.id }}
              className="text-primary hover:underline"
            >
              {project.code} — {project.name}
            </Link>
          ) : (
            "-"
          )}
        </InfoRow>
        <InfoRow label="ลูกค้า / สถานที่">
          {custName(project?.customer_id, project?.customers) ?? "-"}
          {project?.site_address ? ` · ${project.site_address}` : ""}
        </InfoRow>
        <InfoRow label="สถานะโปรเจกต์">{statusLabel(project?.status ?? 1)}</InfoRow>
        <InfoRow label="ปล่อยงานเมื่อ">{wo.released_at ? formatDate(wo.released_at) : "-"}</InfoRow>
        <InfoRow label="สถานะใบสั่งงาน">
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={wo.status}
            onChange={(e) => {
              if (e.target.value !== "draft" && !canRelease)
                { toast.error(
                  `ปล่อยงานไม่ได้: สถานะโปรเจกต์ต้องถึงขั้น ${RELEASE_MIN_STATUS} ก่อน`,
                ); return; }
              const patch: TablesUpdate<"work_orders"> = { status: e.target.value };
              if (e.target.value !== "draft" && !wo.released_at)
                patch["released_at"] = new Date().toISOString();
              updateWo.mutate(patch);
            }}
          >
            {WO_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </InfoRow>
        <Field label="คำสั่งงาน / วิธีทำ" className="md:col-span-3">
          <Textarea
            defaultValue={wo.instructions ?? ""}
            disabled={!canEditProduction}
            onBlur={(e) => {
              if (e.target.value !== (wo.instructions ?? ""))
                updateWo.mutate({ instructions: e.target.value || null });
            }}
          />
        </Field>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">แผนงาน</h2>
        <WorkPlanSection wo={wo} canPlan={canPlanWork} />
      </section>

      {project ? (
        <section className="space-y-6 rounded-lg border border-border bg-card p-4">
          <JobFiles
            projectId={project.id}
            workOrderId={wo.id}
            kind="drawing"
            title="แบบ / drawing"
            hint="แบบของโปรเจกต์แสดงด้วย — เพิ่มแบบเฉพาะงานนี้ได้"
            includeProjectFiles
          />
          <JobFiles
            projectId={project.id}
            workOrderId={wo.id}
            kind="photo"
            title="รูปหน้างาน"
            hint="รูปก่อนเริ่ม ระหว่างทำ หรือจุดที่วัด"
          />
        </section>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">รายการของที่ต้องเบิก</h2>
        <p className="text-xs text-muted-foreground">ไม่แสดงราคาหรือต้นทุนในหน้านี้</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left text-xs text-muted-foreground">
              <tr>
                <Th>สินค้า (SKU)</Th>
                <Th>จำนวนที่ต้องใช้</Th>
                <Th>เบิกแล้ว</Th>
                <Th>หมายเหตุ</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {(items ?? []).map((it) => {
                const sku = it.skus as { code: string; name: string; unit: string } | null;
                return (
                  <tr key={it.id} className="border-t border-border">
                    <Td>
                      <div className="font-medium">{it.item_name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{sku?.code ?? ""}</div>
                    </Td>
                    <Td>
                      {formatQty(Number(it.qty))} {it.unit ?? ""}
                    </Td>
                    <Td>
                      <IssuedInput
                        current={Number(it.issued_qty)}
                        disabled={!canEditProduction && !isTechnician}
                        onSave={(qty) => setIssued.mutate({ id: it.id, qty })}
                      />
                    </Td>
                    <Td>{it.note ?? "-"}</Td>
                    <Td>
                      {canEditProduction ? (
                        <Button size="sm" variant="outline" onClick={() => removeItem.mutate(it.id)}>
                          ลบ
                        </Button>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
              {items?.length === 0 ? (
                <tr>
                  <Td colSpan={5}>ยังไม่มีรายการของที่ต้องเบิก</Td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {canEditProduction ? (
          <AddWoItem skus={skus ?? []} onAdd={(p) => addItem.mutate(p)} pending={addItem.isPending} />
        ) : null}
      </section>

      {project && wo.wo_type !== "production" ? (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">ส่งมอบงาน</h2>
          <HandoverSection woId={wo.id} projectId={project.id} woStatus={wo.status} />
        </section>
      ) : null}
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

function IssuedInput({
  current,
  onSave,
  disabled,
}: {
  current: number;
  onSave: (qty: number) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(String(current));
  return (
    <div className="flex items-center gap-2">
      <Input
        className="h-8 w-24"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
      />
      {!disabled ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const n = toNumber(value);
            if (n === null) { toast.error("กรุณากรอกตัวเลข"); return; }
            onSave(n);
          }}
        >
          บันทึก
        </Button>
      ) : null}
    </div>
  );
}

function AddWoItem({
  skus,
  onAdd,
  pending,
}: {
  skus: { id: string; code: string; name: string; unit: string }[];
  onAdd: (p: { sku_id: string; qty: number; note: string }) => void;
  pending?: boolean;
}) {
  const [skuId, setSkuId] = useState("");
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");

  return (
    <form
      className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const n = toNumber(qty);
        if (!skuId) { toast.error("กรุณาเลือกสินค้า"); return; }
        if (n === null) { toast.error("กรุณากรอกจำนวนเป็นตัวเลข"); return; }
        onAdd({ sku_id: skuId, qty: n, note });
        setQty("1");
        setNote("");
      }}
    >
      <Field label="สินค้า (SKU)" className="sm:col-span-2">
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={skuId}
          onChange={(e) => setSkuId(e.target.value)}
        >
          <option value="">— เลือกสินค้า —</option>
          {skus.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="จำนวน">
        <Input value={qty} onChange={(e) => setQty(e.target.value)} />
      </Field>
      <Field label="หมายเหตุ">
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="sm:col-span-4">
        <Button size="sm" type="submit" disabled={pending}>
          เพิ่มรายการ
        </Button>
      </div>
    </form>
  );
}
