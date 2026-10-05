import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { PageHeader } from "@/components/AppLayout";
import { Field, Td, Th } from "@/routes/_authenticated/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMe } from "@/hooks/useMe";
import { formatDate, formatQty, toNumber } from "@/lib/format";

type Search = { sku?: string | undefined; qty?: number | undefined; kind?: string | undefined };

export const Route = createFileRoute("/_authenticated/purchase-requests")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    sku: typeof s["sku"] === "string" ? s["sku"] : undefined,
    qty: s["qty"] !== undefined && !Number.isNaN(Number(s["qty"])) ? Number(s["qty"]) : undefined,
    kind: typeof s["kind"] === "string" ? s["kind"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "ใบขอซื้อ | CCSE ERP" },
      { name: "description", content: "สร้าง อนุมัติ สั่งซื้อ และรับของตามใบขอซื้อวัสดุ CCSE" },
      { property: "og:title", content: "ใบขอซื้อ | CCSE ERP" },
      { property: "og:description", content: "จัดการใบขอซื้อวัสดุ CCSE" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PurchaseRequestsPage,
});

export const PR_KINDS = [
  { value: "domestic", label: "ในประเทศ" },
  { value: "sundry", label: "จิปาถะ (ไม่อยู่ในใบ Work)" },
  { value: "import", label: "นำเข้า" },
];
const PR_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: "รอสั่ง", cls: "bg-muted text-foreground" },
  ordered: { label: "สั่งแล้ว", cls: "bg-warning text-foreground" },
  received: { label: "รับของแล้ว", cls: "bg-success text-primary-foreground" },
};
const kindLabel = (k: string) => PR_KINDS.find((x) => x.value === k)?.label ?? k;
const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function PurchaseRequestsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAdmin, has } = useMe();
  const canEdit = has("admin", "stock");
  const [filter, setFilter] = useState("open");
  const empty = { sku_id: "", qty: "", kind: "domestic", project_id: "", note: "" };
  const [form, setForm] = useState(empty);

  useEffect(() => {
    if (search.sku) {
      setForm((f) => ({
        ...f,
        sku_id: search.sku!,
        qty: search.qty !== undefined ? String(search.qty) : f.qty,
        kind: search.kind && (search.kind !== "import" || isAdmin) ? search.kind : "domestic",
      }));
    }
  }, [search.sku, search.qty, search.kind, isAdmin]);

  const { data: skus } = useQuery({
    queryKey: ["skus"],
    queryFn: async () => {
      const { data, error } = await supabase.from("skus").select("*").order("code");
      if (error) throw error;
      return data;
    },
  });
  const { data: projects } = useQuery({
    queryKey: ["projects", "pick"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("id, code, name").order("code");
      if (error) throw error;
      return data;
    },
  });
  const { data: prs } = useQuery({
    queryKey: ["purchase_requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_requests")
        .select("*, skus(code, name, unit), projects(code)")
        .order("date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const refresh = () => {
    ["purchase_requests", "sku_on_hand", "stock_movements"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  const create = useMutation({
    mutationFn: async (ordered: boolean) => {
      const qty = toNumber(form.qty);
      if (!form.sku_id) throw new Error("กรุณาเลือก SKU");
      if (!qty || qty <= 0) throw new Error("จำนวนต้องมากกว่า 0");
      const { error } = await supabase.from("purchase_requests").insert({
        sku_id: form.sku_id,
        qty,
        kind: form.kind,
        project_id: form.project_id || null,
        note: form.note || null,
        status: ordered ? "ordered" : "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("สร้างใบขอซื้อแล้ว");
      setForm(empty);
      navigate({ to: "/purchase-requests", search: {} });
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TablesUpdate<"purchase_requests"> }) => {
      const { error } = await supabase.from("purchase_requests").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.patch.status === "received" ? "รับของเข้าสต็อกแล้ว" : "อัปเดตแล้ว");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("purchase_requests").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const canOrderDirect =
    form.kind === "domestic" ? canEdit : isAdmin;
  const list = (prs ?? []).filter((p) =>
    filter === "all" ? true : filter === "open" ? p.status !== "received" : p.status === filter,
  );

  return (
    <div>
      <PageHeader title="ใบขอซื้อ" description="ในประเทศ: คลังสั่งได้ทันที · จิปาถะ: ต้องให้ผู้ดูแลระบบอนุมัติก่อนสั่ง · นำเข้า: เฉพาะผู้ดูแลระบบ" />

      {canEdit ? (
        <form
          className="mb-5 grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-6"
          onSubmit={(e) => { e.preventDefault(); create.mutate(false); }}
        >
          <Field label="SKU *" className="md:col-span-2">
            <select className={sel} value={form.sku_id} onChange={(e) => setForm({ ...form, sku_id: e.target.value })}>
              <option value="">— เลือก —</option>
              {(skus ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select>
          </Field>
          <Field label="จำนวน *">
            <Input value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
          </Field>
          <Field label="ประเภท">
            <select className={sel} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {PR_KINDS.map((k) => (
                <option key={k.value} value={k.value} disabled={k.value === "import" && !isAdmin}>{k.label}</option>
              ))}
            </select>
          </Field>
          <Field label="โปรเจกต์ (ถ้ามี)">
            <select className={sel} value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
              <option value="">— ไม่ระบุ —</option>
              {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </Field>
          <Field label="หมายเหตุ">
            <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <div className="flex flex-wrap items-end gap-2 md:col-span-6">
            <Button size="sm" type="submit" disabled={create.isPending}>สร้างใบขอซื้อ</Button>
            {canOrderDirect ? (
              <Button size="sm" type="button" variant="outline" disabled={create.isPending} onClick={() => create.mutate(true)}>
                สร้างและสั่งซื้อทันที
              </Button>
            ) : null}
          </div>
        </form>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-2">
        {[["open", "ยังไม่รับของ"], ["pending", "รอสั่ง"], ["ordered", "สั่งแล้ว"], ["received", "รับของแล้ว"], ["all", "ทั้งหมด"]].map(([v, l]) => (
          <Button key={v} size="sm" variant={filter === v ? "default" : "outline"} onClick={() => setFilter(v!)}>{l}</Button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <Th>วันที่</Th><Th>SKU</Th><Th>จำนวน</Th><Th>ประเภท</Th><Th>โปรเจกต์</Th>
              <Th>หมายเหตุ</Th><Th>อนุมัติ</Th><Th>สถานะ</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const sku = p.skus as { code: string; name: string; unit: string } | null;
              const proj = p.projects as { code: string } | null;
              const st = PR_STATUS[p.status] ?? { label: p.status, cls: "bg-muted" };
              const rowEdit = canEdit && (p.kind !== "import" || isAdmin);
              const needsApproval = p.kind === "sundry" && !p.approved_at;
              const canOrder = rowEdit && p.status === "pending" && (!needsApproval || isAdmin);
              return (
                <tr key={p.id} className="border-t border-border">
                  <Td>{formatDate(p.date)}</Td>
                  <Td><span className="font-mono">{sku?.code}</span> {sku?.name}</Td>
                  <Td className="text-right tabular-nums">{formatQty(Number(p.qty))} {sku?.unit}</Td>
                  <Td>{kindLabel(p.kind)}</Td>
                  <Td>{proj?.code ?? "—"}</Td>
                  <Td>{p.note}</Td>
                  <Td className="text-xs">
                    {p.kind !== "sundry" ? "—" : p.approved_at ? `อนุมัติแล้ว ${formatDate(p.approved_at)}` : "รออนุมัติ"}
                  </Td>
                  <Td><span className={"rounded-md px-2 py-0.5 text-xs font-semibold " + st.cls}>{st.label}</span></Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {isAdmin && p.status === "pending" && needsApproval ? (
                        <Button size="sm" variant="outline" onClick={() => update.mutate({ id: p.id, patch: { approved_at: new Date().toISOString() } })}>อนุมัติ</Button>
                      ) : null}
                      {canOrder ? (
                        <Button size="sm" variant="outline" onClick={() => update.mutate({ id: p.id, patch: { status: "ordered" } })}>สั่งซื้อแล้ว</Button>
                      ) : null}
                      {rowEdit && p.status === "ordered" ? (
                        <Button size="sm" onClick={() => {
                          if (confirm(`รับของ ${formatQty(Number(p.qty))} ${sku?.unit ?? ""} เข้าสต็อก?`))
                            update.mutate({ id: p.id, patch: { status: "received" } });
                        }}>รับของ</Button>
                      ) : null}
                      {rowEdit && p.status === "pending" ? (
                        <Button size="sm" variant="outline" onClick={() => remove.mutate(p.id)}>ลบ</Button>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              );
            })}
            {list.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-4 text-muted-foreground">ไม่มีรายการ</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
