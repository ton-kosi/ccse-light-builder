import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, Td, Th } from "@/routes/_authenticated/customers";
import { useMe } from "@/hooks/useMe";
import { fetchAll, matchesSearch } from "@/lib/fetchAll";
import { db, tableMissing, type Supplier } from "@/lib/purchaseOrders";

export const Route = createFileRoute("/_authenticated/suppliers")({
  head: () => ({
    meta: [
      { title: "ผู้ขาย | CCSE ERP" },
      { name: "description", content: "รายชื่อผู้ขาย / ร้านค้า ผู้ติดต่อ เบอร์โทร ที่อยู่ เลขภาษี" },
      { property: "og:title", content: "ผู้ขาย | CCSE ERP" },
      { property: "og:description", content: "รายชื่อผู้ขายของ CCSE และ One Engineering" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SuppliersPage,
});

const EMPTY = { code: "", name: "", contact_person: "", phone: "", fax: "", email: "", tax_id: "", branch: "", credit_days: "", address: "", notes: "" };
const SHOW = 200;

export function useSuppliers() {
  return useQuery({
    queryKey: ["suppliers"],
    retry: false,
    queryFn: () =>
      fetchAll<Supplier>((f, t) => db("suppliers").select("*").order("name").range(f, t)),
  });
}

function SuppliersPage() {
  const { has } = useMe();
  const canEdit = has("admin", "stock");
  const qc = useQueryClient();
  const [form, setForm] = useState({ ...EMPTY });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { data: suppliers, isLoading, error } = useSuppliers();

  const save = useMutation({
    mutationFn: async () => {
      const row = {
        code: form.code.trim() || null,
        name: form.name.trim(),
        contact_person: form.contact_person.trim() || null,
        phone: form.phone.trim() || null,
        fax: form.fax.trim() || null,
        email: form.email.trim() || null,
        tax_id: form.tax_id.trim() || null,
        branch: form.branch.trim() || null,
        credit_days: form.credit_days.trim() ? Number(form.credit_days) : null,
        address: form.address.trim() || null,
        notes: form.notes.trim() || null,
        updated_at: new Date().toISOString(),
      };
      if (!row.name) throw new Error("กรอกชื่อผู้ขาย");
      if (row.credit_days !== null && !(row.credit_days >= 0)) throw new Error("เครดิต (วัน) ต้องเป็นตัวเลข");
      const { error: e } = editing ? await db("suppliers").update(row).eq("id", editing) : await db("suppliers").insert(row);
      if (e) throw new Error(e.message);
    },
    onSuccess: () => {
      toast.success("บันทึกผู้ขายแล้ว");
      setForm({ ...EMPTY });
      setOpen(false);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (error && tableMissing((error as Error).message))
    return <p className="text-sm text-muted-foreground">ยังใช้ไม่ได้ — ให้ Lovable รันไฟล์ docs/sql/suppliers_purchase_orders.sql ก่อน</p>;

  const found = (suppliers ?? []).filter((s) => matchesSearch(search, [s.code, s.name, s.contact_person, s.phone, s.tax_id, s.notes]));
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div>
      <PageHeader
        title="ผู้ขาย"
        description="ร้านค้า / ผู้ขาย ใช้ในใบสั่งซื้อ (PO) และการซื้อของ"
        actions={
          canEdit ? (
            <Button
              size="sm"
              onClick={() => {
                setOpen((v) => !v);
                setEditing(null);
                setForm({ ...EMPTY });
              }}
            >
              {open ? "ปิดฟอร์ม" : "เพิ่มผู้ขาย"}
            </Button>
          ) : null
        }
      />
      {open && canEdit ? (
        <form
          className="mb-6 grid gap-4 rounded-lg border border-border bg-card p-4 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="รหัสผู้ขาย">
            <Input value={form.code} onChange={set("code")} />
          </Field>
          <Field label="ชื่อผู้ขาย *">
            <Input required value={form.name} onChange={set("name")} />
          </Field>
          <Field label="ผู้ติดต่อ">
            <Input value={form.contact_person} onChange={set("contact_person")} />
          </Field>
          <Field label="โทรศัพท์">
            <Input value={form.phone} onChange={set("phone")} />
          </Field>
          <Field label="แฟกซ์">
            <Input value={form.fax} onChange={set("fax")} />
          </Field>
          <Field label="อีเมล">
            <Input value={form.email} onChange={set("email")} />
          </Field>
          <Field label="เลขผู้เสียภาษี">
            <Input value={form.tax_id} onChange={set("tax_id")} />
          </Field>
          <Field label="สาขา">
            <Input value={form.branch} placeholder="สำนักงานใหญ่" onChange={set("branch")} />
          </Field>
          <Field label="เครดิต (วัน)">
            <Input inputMode="numeric" value={form.credit_days} onChange={set("credit_days")} />
          </Field>
          <Field label="ที่อยู่" className="md:col-span-2">
            <Textarea value={form.address} onChange={set("address")} />
          </Field>
          <Field label="หมายเหตุ">
            <Textarea value={form.notes} onChange={set("notes")} />
          </Field>
          <div className="md:col-span-3">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {editing ? "บันทึกการแก้ไข" : "บันทึก"}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input className="max-w-sm" placeholder="ค้นหา รหัส ชื่อ ผู้ติดต่อ โทร เลขภาษี" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="text-xs text-muted-foreground">
          {suppliers ? (found.length > SHOW ? `แสดง ${SHOW} จาก ${found.length.toLocaleString()} ราย` : `${found.length.toLocaleString()} ราย`) : ""}
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <Th>รหัส</Th>
              <Th>ชื่อผู้ขาย</Th>
              <Th>ผู้ติดต่อ</Th>
              <Th>โทร / แฟกซ์</Th>
              <Th>เครดิต</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <Td colSpan={5}>กำลังโหลด…</Td>
              </tr>
            ) : found.length ? (
              found.slice(0, SHOW).map((s) => (
                <tr
                  key={s.id}
                  className={"border-t border-border " + (canEdit ? "cursor-pointer hover:bg-secondary/60" : "")}
                  onClick={() => {
                    if (!canEdit) return;
                    setEditing(s.id);
                    setOpen(true);
                    setForm({
                      code: s.code ?? "",
                      name: s.name,
                      contact_person: s.contact_person ?? "",
                      phone: s.phone ?? "",
                      fax: s.fax ?? "",
                      email: s.email ?? "",
                      tax_id: s.tax_id ?? "",
                      branch: s.branch ?? "",
                      credit_days: s.credit_days == null ? "" : String(s.credit_days),
                      address: s.address ?? "",
                      notes: s.notes ?? "",
                    });
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  <Td>{s.code ?? "-"}</Td>
                  <Td className="font-medium">{s.name}</Td>
                  <Td>{s.contact_person ?? "-"}</Td>
                  <Td>
                    {s.phone ?? "-"}
                    {s.fax ? <div className="text-xs text-muted-foreground">แฟกซ์ {s.fax}</div> : null}
                  </Td>
                  <Td>{s.credit_days != null ? `${s.credit_days} วัน` : "-"}</Td>
                </tr>
              ))
            ) : (
              <tr>
                <Td colSpan={5}>{suppliers?.length ? "ไม่พบผู้ขายที่ค้นหา" : "ยังไม่มีผู้ขาย"}</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
