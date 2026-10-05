import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AddRecipeItem } from "@/components/AddRecipeItem";
import { Button } from "@/components/ui/button";
import { formatQty } from "@/lib/format";

export function LineRecipeEditor({
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
        .eq("quote_line_id", lineId);
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
        qty_per_unit: p.qty,
        note: p.note || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("เพิ่มรายการในสูตรเฉพาะแล้ว");
      queryClient.invalidateQueries({ queryKey: ["line_recipes", lineId] }); queryClient.invalidateQueries({ queryKey: ["boq_costs"] });
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
