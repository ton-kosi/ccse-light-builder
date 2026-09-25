import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Field, Td, Th } from "@/routes/_authenticated/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMe } from "@/hooks/useMe";
import { formatQty, toNumber } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/components")({
  head: () => ({
    meta: [
      { title: "ส่วนประกอบขายและสูตร | CCSE ERP" },
      {
        name: "description",
        content: "ส่วนประกอบที่ใช้ขาย (เช่น LED JEDI 13.8W/M) และสูตรว่าต้องเบิก SKU อะไรบ้าง",
      },
      { property: "og:title", content: "ส่วนประกอบขายและสูตร | CCSE ERP" },
      { property: "og:description", content: "สูตรภายในที่แปลงชื่อขายเป็นสินค้าในคลัง" },
    ],
  }),
  component: ComponentsPage,
});

function ComponentsPage() {
  const { canEditProduction } = useMe();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", sales_name: "", unit: "ม.", category: "" });

  const { data: components } = useQuery({
    queryKey: ["sales_components"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sales_components").select("*").order("code");
      if (error) throw error;
      return data;
    },
  });

  const { data: items } = useQuery({
    queryKey: ["recipe_items", selected],
    enabled: !!selected,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_items")
        .select("id, qty_per_unit, note, sku_id, skus(code, name, unit)")
        .eq("sales_component_id", selected!);
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

  const createComponent = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("sales_components").insert({
        code: form.code,
        sales_name: form.sales_name,
        unit: form.unit || "ม.",
        category: form.category || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("บันทึกส่วนประกอบแล้ว");
      setForm({ code: "", sales_name: "", unit: "ม.", category: "" });
      queryClient.invalidateQueries({ queryKey: ["sales_components"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addItem = useMutation({
    mutationFn: async (payload: { sku_id: string; qty: number; note: string }) => {
      const { error } = await supabase.from("recipe_items").insert({
        sales_component_id: selected!,
        sku_id: payload.sku_id,
        qty_per_unit: payload.qty,
        note: payload.note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("เพิ่มรายการในสูตรแล้ว");
      queryClient.invalidateQueries({ queryKey: ["recipe_items", selected] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("recipe_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["recipe_items", selected] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const current = (components ?? []).find((c) => c.id === selected);

  return (
    <div>
      <PageHeader
        title="ส่วนประกอบขาย & สูตร"
        description="ชื่อที่ใช้ขาย 1 หน่วย ต้องเบิกสินค้าในคลังอะไรบ้าง (สูตรมาตรฐานที่นำกลับมาใช้ซ้ำได้)"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          {canEditProduction ? (
            <form
              className="mb-4 grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2"
              onSubmit={(e) => {
                e.preventDefault();
                createComponent.mutate();
              }}
            >
              <Field label="รหัส *">
                <Input
                  required
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </Field>
              <Field label="ชื่อที่ใช้ขาย *">
                <Input
                  required
                  value={form.sales_name}
                  onChange={(e) => setForm({ ...form, sales_name: e.target.value })}
                />
              </Field>
              <Field label="หน่วย">
                <Input
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                />
              </Field>
              <Field label="หมวด">
                <Input
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                />
              </Field>
              <div className="sm:col-span-2">
                <Button size="sm" type="submit" disabled={createComponent.isPending}>
                  เพิ่มส่วนประกอบ
                </Button>
              </div>
            </form>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-left text-xs text-muted-foreground">
                <tr>
                  <Th>รหัส</Th>
                  <Th>ชื่อที่ใช้ขาย</Th>
                  <Th>หน่วย</Th>
                  <Th>สูตร</Th>
                </tr>
              </thead>
              <tbody>
                {(components ?? []).map((c) => (
                  <tr key={c.id} className="border-t border-border">
                    <Td className="font-mono text-xs">{c.code}</Td>
                    <Td className="font-medium">{c.sales_name}</Td>
                    <Td>{c.unit}</Td>
                    <Td>
                      <Button size="sm" variant="outline" onClick={() => setSelected(c.id)}>
                        ดู/แก้สูตร
                      </Button>
                    </Td>
                  </tr>
                ))}
                {components?.length === 0 ? (
                  <tr>
                    <Td colSpan={4}>ยังไม่มีส่วนประกอบ</Td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">
            {current ? `สูตรของ ${current.sales_name} (ต่อ 1 ${current.unit})` : "เลือกส่วนประกอบเพื่อดูสูตร"}
          </h2>
          {current ? (
            <>
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <Th>SKU</Th>
                    <Th>จำนวนต่อหน่วย</Th>
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
                          <div className="font-medium">{sku?.name}</div>
                          <div className="font-mono text-xs text-muted-foreground">{sku?.code}</div>
                        </Td>
                        <Td>
                          {formatQty(Number(it.qty_per_unit))} {sku?.unit}
                        </Td>
                        <Td>{it.note ?? "-"}</Td>
                        <Td>
                          {canEditProduction ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => removeItem.mutate(it.id)}
                            >
                              ลบ
                            </Button>
                          ) : null}
                        </Td>
                      </tr>
                    );
                  })}
                  {items?.length === 0 ? (
                    <tr>
                      <Td colSpan={4}>ยังไม่มีรายการในสูตร</Td>
                    </tr>
                  ) : null}
                </tbody>
              </table>

              {canEditProduction ? (
                <AddRecipeItem
                  skus={skus ?? []}
                  onAdd={(p) => addItem.mutate(p)}
                  pending={addItem.isPending}
                />
              ) : null}
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export function AddRecipeItem({
  skus,
  onAdd,
  pending,
  label = "เพิ่มรายการในสูตร",
}: {
  skus: { id: string; code: string; name: string; unit: string }[];
  onAdd: (p: { sku_id: string; qty: number; note: string }) => void;
  pending?: boolean;
  label?: string;
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
        if (!skuId) return toast.error("กรุณาเลือก SKU");
        if (n === null) return toast.error("กรุณากรอกจำนวนเป็นตัวเลข");
        onAdd({ sku_id: skuId, qty: n, note });
        setQty("1");
        setNote("");
      }}
    >
      <Field label="SKU" className="sm:col-span-2">
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
          {label}
        </Button>
      </div>
    </form>
  );
}
