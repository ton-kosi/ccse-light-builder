import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/useMe";
import { formatQty } from "@/lib/format";

export function RollPlanSection({ projectId, print = false }: { projectId: string; print?: boolean }) {
  const { has } = useMe();
  const qc = useQueryClient();
  const canPlan = has("admin", "estimator", "stock", "production");

  const { data: plan } = useQuery({
    queryKey: ["roll_plans", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("roll_plans")
        .select("*, skus(code, name), remnants(code)")
        .eq("project_id", projectId)
        .order("roll_family")
        .order("seq");
      if (error) throw error;
      return data;
    },
  });
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const minR = Number(settings?.min_remnant_m ?? 1);

  const run = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("plan_rolls", { _project_id: projectId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("วางแผนตัดม้วนแล้ว");
      ["roll_plans", "wo_pick_list", "material_demand", "remnants"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = plan ?? [];
  const newRolls = rows.filter((r) => r.source === "new_roll");
  const td = "border border-border px-2 py-1 align-top";
  const th = "border border-border px-2 py-1 text-left text-xs font-semibold";

  return (
    <section className="mt-5 break-inside-avoid">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">แผนตัดม้วน</h3>
        {!print && canPlan ? (
          <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>
            วางแผนตัดม้วน
          </Button>
        ) : null}
        {rows.length ? (
          <span className="text-xs text-muted-foreground">
            ม้วนใหม่ {newRolls.length} ม้วน · ใช้เศษ {rows.length - newRolls.length} ชิ้น
          </span>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          ยังไม่ได้วางแผนตัด — ระหว่างนี้ความต้องการ LED neon flex คำนวณจากจำนวนในสูตรตามปกติ
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted">
            <tr>
              <th className={th}>ตระกูล</th><th className={th}>ม้วน / เศษ</th><th className={th}>SKU</th>
              <th className={th + " text-right"}>ยาว (ม.)</th><th className={th}>ชิ้นที่ตัด (ม.)</th>
              <th className={th + " text-right"}>เหลือ (ม.)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sku = r.skus as { code: string; name: string } | null;
              const rem = r.remnants as { code: string } | null;
              const keep = Number(r.leftover_m) >= minR;
              return (
                <tr key={r.id}>
                  <td className={td}>{r.roll_family}</td>
                  <td className={td}>{r.source === "new_roll" ? "ม้วนใหม่" : `เศษ ${rem?.code ?? ""}`}</td>
                  <td className={td + " font-mono"}>{sku?.code}</td>
                  <td className={td + " text-right tabular-nums"}>{formatQty(Number(r.roll_length_m))}</td>
                  <td className={td + " tabular-nums"}>{(r.pieces ?? []).map((p) => formatQty(Number(p))).join(" + ")}</td>
                  <td className={td + " text-right tabular-nums"}>
                    {formatQty(Number(r.leftover_m))}
                    {keep ? <span className="ml-1 text-xs text-success">เก็บเป็นเศษ</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
