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
import { PROJECT_STATUSES, statusLabel } from "@/lib/erp";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/projects/")({
  head: () => ({
    meta: [
      { title: "โปรเจกต์ | CCSE ERP" },
      { name: "description", content: "รายการงานทั้งหมดพร้อมสถานะ 1–11" },
      { property: "og:title", content: "โปรเจกต์ | CCSE ERP" },
      { property: "og:description", content: "รายการงานทั้งหมดของ CCSE พร้อมสถานะงาน" },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { canEditSales } = useMe();
  const queryClient = useQueryClient();
  const custName = useCustomerNames();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [form, setForm] = useState({
    code: "",
    name: "",
    customer_id: "",
    attn: "",
    site_address: "",
    notes: "",
  });

  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects", "all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, code, name, status, po_number, updated_at, customer_id, customers(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: customers } = useQuery({
    queryKey: ["customers", "options"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("projects").insert({
        code: form.code,
        name: form.name,
        customer_id: form.customer_id || null,
        attn: form.attn || null,
        site_address: form.site_address || null,
        notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("สร้างโปรเจกต์แล้ว");
      setForm({ code: "", name: "", customer_id: "", attn: "", site_address: "", notes: "" });
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = (projects ?? []).filter((p) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return (
      p.code.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      (custName(p.customer_id, p.customers) ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div>
      <PageHeader
        title="โปรเจกต์"
        description="งานทั้งหมด พร้อมสถานะ 1–11 (ปล่อยใบสั่งงานได้เมื่อสถานะ ≥ 6)"
        actions={
          canEditSales ? (
            <Button size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? "ปิดฟอร์ม" : "สร้างโปรเจกต์"}
            </Button>
          ) : null
        }
      />

      {open && canEditSales ? (
        <form
          className="mb-6 grid gap-4 rounded-lg border border-border bg-card p-4 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="รหัสงาน * (เช่น P-PANO)">
            <Input
              required
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </Field>
          <Field label="ชื่องาน *">
            <Input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="ลูกค้า">
            <select
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.customer_id}
              onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
            >
              <option value="">— ไม่ระบุ —</option>
              {(customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="เรียน (Attn)">
            <Input value={form.attn} onChange={(e) => setForm({ ...form, attn: e.target.value })} />
          </Field>
          <Field label="สถานที่ติดตั้ง">
            <Input
              value={form.site_address}
              onChange={(e) => setForm({ ...form, site_address: e.target.value })}
            />
          </Field>
          <Field label="หมายเหตุ">
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
          <div className="md:col-span-3">
            <Button type="submit" size="sm" disabled={create.isPending}>
              บันทึก
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mb-3 max-w-xs">
        <Input
          placeholder="ค้นหารหัสงาน / ชื่องาน / ลูกค้า"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <Th>รหัสงาน</Th>
              <Th>ชื่องาน</Th>
              <Th>ลูกค้า</Th>
              <Th>สถานะ</Th>
              <Th>เลข PO</Th>
              <Th>แก้ไขล่าสุด</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <Td colSpan={6}>กำลังโหลด...</Td>
              </tr>
            ) : rows.length ? (
              rows.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <Td className="font-mono text-xs">
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: p.id }}
                      className="text-primary hover:underline"
                    >
                      {p.code}
                    </Link>
                  </Td>
                  <Td className="font-medium">{p.name}</Td>
                  <Td>{custName(p.customer_id, p.customers) ?? "-"}</Td>
                  <Td>{statusLabel(p.status)}</Td>
                  <Td>{p.po_number ?? "-"}</Td>
                  <Td>{formatDate(p.updated_at)}</Td>
                </tr>
              ))
            ) : (
              <tr>
                <Td colSpan={6}>ยังไม่มีโปรเจกต์</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        สถานะงาน: {PROJECT_STATUSES.map((s) => s.label).join(" · ")}
      </p>
    </div>
  );
}
