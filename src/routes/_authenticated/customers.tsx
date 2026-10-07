import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/hooks/useMe";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "ลูกค้า | CCSE ERP" },
      { name: "description", content: "ทะเบียนลูกค้าและผู้ติดต่อของ CCSE" },
      { property: "og:title", content: "ลูกค้า | CCSE ERP" },
      { property: "og:description", content: "ทะเบียนลูกค้าและผู้ติดต่อ" },
    ],
  }),
  component: CustomersPage,
});

const EMPTY = {
  code: "",
  name: "",
  contact_person: "",
  phone: "",
  email: "",
  tax_id: "",
  address: "",
  notes: "",
};

function CustomersPage() {
  const { canEditSales } = useMe();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ ...EMPTY });
  const [open, setOpen] = useState(false);

  const { data: customers, isLoading } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("customers").insert({
        code: form.code || null,
        name: form.name,
        contact_person: form.contact_person || null,
        phone: form.phone || null,
        email: form.email || null,
        tax_id: form.tax_id || null,
        address: form.address || null,
        notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("บันทึกลูกค้าแล้ว");
      setForm({ ...EMPTY });
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="ลูกค้า"
        description="ข้อมูลลูกค้าและผู้ติดต่อ ใช้ผูกกับโปรเจกต์และใบเสนอราคา"
        actions={
          canEditSales ? (
            <Button size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? "ปิดฟอร์ม" : "เพิ่มลูกค้า"}
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
          <Field label="รหัสลูกค้า">
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </Field>
          <Field label="ชื่อลูกค้า *">
            <Input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="ผู้ติดต่อ">
            <Input
              value={form.contact_person}
              onChange={(e) => setForm({ ...form, contact_person: e.target.value })}
            />
          </Field>
          <Field label="โทรศัพท์">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="อีเมล">
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="เลขผู้เสียภาษี">
            <Input
              value={form.tax_id}
              onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
            />
          </Field>
          <Field label="ที่อยู่" className="md:col-span-2">
            <Textarea
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
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

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <Th>รหัส</Th>
              <Th>ชื่อลูกค้า</Th>
              <Th>ผู้ติดต่อ</Th>
              <Th>โทรศัพท์</Th>
              <Th>อีเมล</Th>
              <Th>สร้างเมื่อ</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <Td colSpan={6}>กำลังโหลด...</Td>
              </tr>
            ) : customers?.length ? (
              customers.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <Td>{c.code ?? "-"}</Td>
                  <Td className="font-medium">{c.name}</Td>
                  <Td>{c.contact_person ?? "-"}</Td>
                  <Td>{c.phone ?? "-"}</Td>
                  <Td>{c.email ?? "-"}</Td>
                  <Td>{formatDate(c.created_at)}</Td>
                </tr>
              ))
            ) : (
              <tr>
                <Td colSpan={6}>ยังไม่มีข้อมูลลูกค้า</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={"space-y-1.5 " + className}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

export function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

export function Td({
  children,
  colSpan,
  className = "",
}: {
  children?: React.ReactNode;
  colSpan?: number;
  className?: string;
}) {
  return (
    <td colSpan={colSpan} className={"px-3 py-2 align-top " + className}>
      {children}
    </td>
  );
}
