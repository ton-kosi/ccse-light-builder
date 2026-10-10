import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AddRecipeItem } from "@/components/AddRecipeItem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatQty, toNumber } from "@/lib/format";

type Sku = { code: string; name: string; unit: string } | null;

export function LineRecipeEditor({
  lineId,
  componentId,
  lineQty,
  canEdit,
}: {
  lineId: string;
  componentId: string | null;
  lineQty: number;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["line_recipes", lineId] });
    queryClient.invalidateQueries({ queryKey: ["boq_costs"] });
  };

  const { data: lineItems } = useQuery({
    queryKey: ["line_recipes", lineId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("line_recipes")
        .select("id, qty, note, skus(code, name, unit)")
        .eq("quote_line_id", lineId)
        .order("created_at");
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
        quote_line_id: lineId,
        sku_id: p.sku_id,
        qty: p.qty,
        note: p.note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("เพิ่มรายการแล้ว");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async (p: { id: string; qty?: number; note?: string | null }) => {
      const patch: { qty?: number; note?: string | null } = {};
      if (p.qty !== undefined) patch.qty = p.qty;
      if (p.note !== undefined) patch.note = p.note;
      const { error } = await supabase.from("line_recipes").update(patch).eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("line_recipes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      {componentId ? (
      <section>
        <h3 className="text-sm font-semibold">สูตรมาตรฐาน (บรรทัดแบบเก่า · อ่านอย่างเดียว)</h3>
        {(
          <table className="mt-2 w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-1">SKU</th>
                <th className="px-2 py-1 text-right">ต่อหน่วย</th>
                <th className="px-2 py-1 text-right">× {formatQty(lineQty)} = รวม</th>
              </tr>
            </thead>
            <tbody>
              {(stdItems ?? []).map((it) => {
                const sku = it.skus as Sku;
                return (
                  <tr key={it.id} className="border-t border-border">
                    <td className="px-2 py-1">
                      {sku?.name} <span className="text-muted-foreground">({sku?.code})</span>
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatQty(Number(it.qty_per_unit))}</td>
                    <td className="px-2 py-1 text-right tabular-nums font-medium">
                      {formatQty(Number(it.qty_per_unit) * lineQty)} {sku?.unit}
                    </td>
                  </tr>
                );
              })}
              {stdItems?.length === 0 ? (
                <tr><td colSpan={3} className="px-2 py-1 text-muted-foreground">— ไม่มีสูตร —</td></tr>
              ) : null}
            </tbody>
          </table>
        )}
      </section>
      ) : null}

      <section>
        <h3 className="text-sm font-semibold">รายการเพิ่มเติมเฉพาะบรรทัดนี้ (จำนวนรวมทั้งบรรทัด)</h3>
        <table className="mt-2 w-full text-sm">
          <thead className="bg-muted text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-2 py-1">SKU</th>
              <th className="px-2 py-1 text-right">จำนวนรวม</th>
              <th className="px-2 py-1">หมายเหตุ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(lineItems ?? []).map((it) => {
              const sku = it.skus as Sku;
              return (
                <tr key={it.id} className="border-t border-border">
                  <td className="px-2 py-1">
                    {sku?.name} <span className="text-muted-foreground">({sku?.code})</span>
                  </td>
                  <td className="px-1 py-1">
                    {canEdit ? (
                      <div className="flex items-center gap-1">
                        <Input
                          key={`${it.id}-${it.qty}`}
                          className="h-8 w-24 text-right"
                          inputMode="decimal"
                          defaultValue={String(it.qty)}
                          onBlur={(e) => {
                            const n = toNumber(e.target.value);
                            if (n === null || n <= 0) {
                              toast.error("จำนวนต้องมากกว่า 0");
                              e.target.value = String(it.qty);
                              return;
                            }
                            if (n !== Number(it.qty)) update.mutate({ id: it.id, qty: n });
                          }}
                        />
                        <span className="text-xs text-muted-foreground">{sku?.unit}</span>
                      </div>
                    ) : (
                      <span className="tabular-nums">{formatQty(Number(it.qty))} {sku?.unit}</span>
                    )}
                  </td>
                  <td className="px-1 py-1">
                    {canEdit ? (
                      <Input
                        key={`${it.id}-n-${it.note ?? ""}`}
                        className="h-8"
                        defaultValue={it.note ?? ""}
                        onBlur={(e) => {
                          const v = e.target.value.trim() || null;
                          if (v !== (it.note ?? null)) update.mutate({ id: it.id, note: v });
                        }}
                      />
                    ) : (
                      it.note
                    )}
                  </td>
                  <td className="px-1 py-1 text-right">
                    {canEdit ? (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove.mutate(it.id)}>
                        ลบ
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {lineItems?.length === 0 ? (
              <tr><td colSpan={4} className="px-2 py-1 text-muted-foreground">— ไม่มี —</td></tr>
            ) : null}
          </tbody>
        </table>
        {canEdit ? (
          <AddRecipeItem
            skus={skus ?? []}
            onAdd={(p) => add.mutate(p)}
            pending={add.isPending}
            label="เพิ่มรายการ (จำนวนรวม)"
          />
        ) : null}
      </section>
    </div>
  );
}
