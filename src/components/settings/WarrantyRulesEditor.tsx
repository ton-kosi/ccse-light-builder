import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { useWarrantyRules, warrantyRulesKey } from "@/hooks/useWarranty";
import { SKU_CATEGORIES } from "@/lib/skuCategory";

/** Warranty months per product type (SKU category), counted from handover. Admin only. */
export function WarrantyRulesEditor() {
  const qc = useQueryClient();
  const { data: rules } = useWarrantyRules();
  const byCat = new Map((rules ?? []).map((r) => [r.category, r]));

  const save = useMutation({
    mutationFn: async ({ category, months }: { category: string; months: number | null }) => {
      const { error } =
        months === null
          ? await supabase.from("warranty_rules").delete().eq("category", category)
          : await supabase.from("warranty_rules").upsert({ category, months }, { onConflict: "category" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("บันทึกระยะประกันแล้ว");
      qc.invalidateQueries({ queryKey: warrantyRulesKey });
      qc.invalidateQueries({ queryKey: ["project_warranty"] });
    },
    onError: (e: Error) =>
      toast.error(
        /warranty_rules|schema cache/i.test(e.message)
          ? "ยังบันทึกไม่ได้ — ให้ Lovable รันไฟล์ docs/sql/warranty_repairs.sql ก่อน"
          : e.message,
      ),
  });

  return (
    <section className="mt-6 max-w-2xl rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">ระยะรับประกันตามประเภทสินค้า</h2>
      <p className="text-xs text-muted-foreground">
        นับจากวันส่งมอบงาน · ว่าง = ไม่มีประกัน / ยังไม่กำหนด (เช่น CLIPSO 60 · LED 24 · POWER SUPPLY 12 เดือน)
      </p>
      <div className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {SKU_CATEGORIES.map((c) => {
          const r = byCat.get(c);
          return (
            <label key={c + (r?.months ?? "")} className="flex items-center justify-between gap-2 text-sm">
              <span>{c}</span>
              <span className="flex items-center gap-1">
                <Input
                  className="h-8 w-20 text-right"
                  inputMode="numeric"
                  defaultValue={r ? String(r.months) : ""}
                  placeholder="-"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    const months = v === "" ? null : Number(v);
                    if (months !== null && !(Number.isInteger(months) && months >= 0)) {
                      toast.error("ใส่จำนวนเดือนเป็นตัวเลขเต็ม");
                      return;
                    }
                    if (months !== (r ? r.months : null)) save.mutate({ category: c, months });
                  }}
                />
                <span className="w-8 text-xs text-muted-foreground">เดือน</span>
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
