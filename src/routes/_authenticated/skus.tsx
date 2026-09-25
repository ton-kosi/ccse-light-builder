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
import { formatQty, formatTHB, toNumber } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/skus")({
  head: () => ({
    meta: [
      { title: "คลังสินค้า SKU | CCSE ERP" },
      { name: "description", content: "รายการสินค้าจริงที่เบิกจากคลัง พร้อมยอดคงเหลือ" },
      { property: "og:title", content: "คลังสินค้า SKU | CCSE ERP" },
      { property: "og:description", content: "รายการสินค้าจริงที่เบิกจากคลังของ CCSE" },
    ],
  }),
  component: SkusPage,
});

function SkusPage() {
  const { canEditProduction, canSeeMoney } = useMe();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    unit: "ชิ้น",
    category: "",
    stock_qty: "0",
    unit_cost: "",
  });

  const { data: skus, isLoading } = useQuery({
    queryKey: ["skus"],
    queryFn: async () => {
      const { data, error } = await supabase.from("skus").select("*").order("code");
      if (error) throw error;
      return data;
    },
  });

  const { data: costs } = useQuery({
    queryKey: ["sku_costs"],
    enabled: canSeeMoney,
    queryFn: async () => {
      const { data, error } = await supabase.from("sku_costs").select("*");
      if (error) throw error;
      return data;
    },
  });

  const costBySku = new Map((costs ?? []).map((c) => [c.sku_id, c]));

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("skus")
        .insert({
          code: form.code,
          name: form.name,
          unit: form.unit || "ชิ้น",
          category: form.category || null,
          stock_qty: toNumber(form.stock_qty) ?? 0,
        })
        .select("id")
        .single();
      if (error) throw error;
      const cost = toNumber(form.unit_cost);
      if (canSeeMoney && cost !== null) {
        const { error: cErr } = await supabase
          .from("sku_costs")
          .upsert({ sku_id: data.id, unit_cost: cost });
        if (cErr) throw cErr;
      }
    },
    onSuccess: () => {
      toast.success("บันทึกสินค้าแล้ว");
      setForm({ code: "", name: "", unit: "ชิ้น", category: "", stock_qty: "0", unit_cost: "" });
      queryClient.invalidateQueries({ queryKey: ["skus"] });
      queryClient.invalidateQueries({ queryKey: ["sku_costs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStock = useMutation({
    mutationFn: async ({ id, qty }: { id: string; qty: number }) => {
      const { error } = await supabase.from("skus").update({ stock_qty: qty }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("ปรับยอดคงเหลือแล้ว");
      queryClient.invalidateQueries({ queryKey: ["skus"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="คลังสินค้า (SKU)"
        description="สินค้าจริงที่เบิกออกจากคลัง เช่น LED strip 14.4W/m — ต่างจากชื่อที่ใช้ขาย"
        actions={
          canEditProduction ? (
            <Button size="sm" onClick={() => setOpen((v) => !v)}>
              {open ? "ปิดฟอร์ม" : "เพิ่มสินค้า"}
            </Button>
          ) : null
        }
      />

      {open && canEditProduction ? (
        <form
          className="mb-6 grid gap-4 rounded-lg border border-border bg-card p-4 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="รหัส SKU *">
            <Input
              required
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
          </Field>
          <Field label="ชื่อสินค้า *">
            <Input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="หน่วย">
            <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          </Field>
          <Field label="หมวด">
            <Input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </Field>
          <Field label="ยอดคงเหลือ">
            <Input
              value={form.stock_qty}
              onChange={(e) => setForm({ ...form, stock_qty: e.target.value })}
            />
          </Field>
          {canSeeMoney ? (
            <Field label="ต้นทุนต่อหน่วย (บาท)">
              <Input
                value={form.unit_cost}
                onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
              />
            </Field>
          ) : null}
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
              <Th>ชื่อสินค้า</Th>
              <Th>หมวด</Th>
              <Th>หน่วย</Th>
              <Th>คงเหลือ</Th>
              {canSeeMoney ? <Th>ต้นทุน/หน่วย</Th> : null}
              {canEditProduction ? <Th>ปรับยอด</Th> : null}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <Td colSpan={7}>กำลังโหลด...</Td>
              </tr>
            ) : skus?.length ? (
              skus.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <Td className="font-mono text-xs">{s.code}</Td>
                  <Td className="font-medium">{s.name}</Td>
                  <Td>{s.category ?? "-"}</Td>
                  <Td>{s.unit}</Td>
                  <Td>{formatQty(Number(s.stock_qty))}</Td>
                  {canSeeMoney ? (
                    <Td>{formatTHB(Number(costBySku.get(s.id)?.unit_cost ?? 0))}</Td>
                  ) : null}
                  {canEditProduction ? (
                    <Td>
                      <StockAdjust
                        current={Number(s.stock_qty)}
                        onSave={(qty) => updateStock.mutate({ id: s.id, qty })}
                      />
                    </Td>
                  ) : null}
                </tr>
              ))
            ) : (
              <tr>
                <Td colSpan={7}>ยังไม่มีสินค้าในคลัง</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StockAdjust({
  current,
  onSave,
}: {
  current: number;
  onSave: (qty: number) => void;
}) {
  const [value, setValue] = useState(String(current));
  return (
    <div className="flex items-center gap-2">
      <Input className="h-8 w-24" value={value} onChange={(e) => setValue(e.target.value)} />
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          const n = toNumber(value);
          if (n === null) return toast.error("กรุณากรอกตัวเลข");
          onSave(n);
        }}
      >
        บันทึก
      </Button>
    </div>
  );
}
