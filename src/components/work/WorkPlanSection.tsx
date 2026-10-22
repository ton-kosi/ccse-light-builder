import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { Field } from "@/routes/_authenticated/customers";
import { Input } from "@/components/ui/input";
import { useStaff } from "@/hooks/useStaff";
import { ROLE_LABELS, WO_TYPES, woTypeLabel } from "@/lib/erp";
import { formatDate } from "@/lib/format";

export const assigneesKey = ["work_order_assignees"];

/** Assignees of every work order (small table; shared by the queue and work order pages). */
export function useAssignees() {
  return useQuery({
    queryKey: assigneesKey,
    queryFn: async () => {
      const { data, error } = await supabase.from("work_order_assignees").select("work_order_id, user_id");
      if (error) {
        // migration not applied yet: show jobs without people instead of failing the page
        if (/does not exist|schema cache/i.test(error.message)) return new Map<string, string[]>();
        throw error;
      }
      const map = new Map<string, string[]>();
      for (const a of data) map.set(a.work_order_id, [...(map.get(a.work_order_id) ?? []), a.user_id]);
      return map;
    },
  });
}

/** Type, start/end date and who does the job. Planners edit; everyone else reads. */
export function WorkPlanSection({
  wo,
  canPlan,
}: {
  wo: { id: string; wo_type: string; scheduled_date: string | null; end_date: string | null };
  canPlan: boolean;
}) {
  const qc = useQueryClient();
  const { data: staff } = useStaff();
  const { data: assignees } = useAssignees();
  const mine = assignees?.get(wo.id) ?? [];
  const nameOf = new Map((staff ?? []).map((s) => [s.id, s]));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["work_order", wo.id] });
    qc.invalidateQueries({ queryKey: ["work_orders"] });
    qc.invalidateQueries({ queryKey: assigneesKey });
  };

  const update = useMutation({
    mutationFn: async (patch: TablesUpdate<"work_orders">) => {
      const { error } = await supabase.from("work_orders").update(patch).eq("id", wo.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("บันทึกแผนงานแล้ว");
      refresh();
    },
    onError: (e: Error) => toast.error(friendly(e.message)),
  });

  const assign = useMutation({
    mutationFn: async ({ userId, on }: { userId: string; on: boolean }) => {
      const { error } = on
        ? await supabase.from("work_order_assignees").insert({ work_order_id: wo.id, user_id: userId })
        : await supabase
            .from("work_order_assignees")
            .delete()
            .eq("work_order_id", wo.id)
            .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(friendly(e.message)),
  });

  const sel = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
  const free = (staff ?? []).filter((s) => !mine.includes(s.id));

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Field label="ประเภทงาน">
        {canPlan ? (
          <select
            className={sel}
            value={wo.wo_type}
            onChange={(e) => update.mutate({ wo_type: e.target.value })}
          >
            {WO_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        ) : (
          <div className="text-sm">{woTypeLabel(wo.wo_type)}</div>
        )}
      </Field>
      <Field label="วันเริ่ม">
        {canPlan ? (
          <Input
            type="date"
            key={wo.scheduled_date ?? ""}
            defaultValue={wo.scheduled_date ?? ""}
            onBlur={(e) => {
              const v = e.target.value || null;
              if (v === wo.scheduled_date) return;
              // keep the end date valid when the start moves past it
              const end = wo.end_date && v && wo.end_date < v ? v : wo.end_date;
              update.mutate({ scheduled_date: v, end_date: v ? end : null });
            }}
          />
        ) : (
          <div className="text-sm">{wo.scheduled_date ? formatDate(wo.scheduled_date) : "-"}</div>
        )}
      </Field>
      <Field label="ถึงวันที่ (งานหลายวัน)">
        {canPlan ? (
          <Input
            type="date"
            key={wo.end_date ?? ""}
            min={wo.scheduled_date ?? undefined}
            disabled={!wo.scheduled_date}
            defaultValue={wo.end_date ?? ""}
            onBlur={(e) => {
              const v = e.target.value || null;
              if (v === wo.end_date) return;
              if (v && wo.scheduled_date && v < wo.scheduled_date) {
                toast.error("วันสิ้นสุดต้องไม่ก่อนวันเริ่ม");
                return;
              }
              update.mutate({ end_date: v });
            }}
          />
        ) : (
          <div className="text-sm">{wo.end_date ? formatDate(wo.end_date) : "-"}</div>
        )}
      </Field>
      <Field label="ผู้รับผิดชอบ (ช่าง / ฝ่ายผลิต)" className="md:col-span-4">
        <div className="flex flex-wrap items-center gap-2">
          {mine.length ? (
            mine.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs"
              >
                {nameOf.get(id)?.name ?? "ผู้ใช้"}
                {canPlan ? (
                  <button
                    type="button"
                    title="เอาออก"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => assign.mutate({ userId: id, on: false })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </span>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">ยังไม่ได้มอบหมาย</span>
          )}
          {canPlan && free.length ? (
            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value=""
              onChange={(e) => e.target.value && assign.mutate({ userId: e.target.value, on: true })}
            >
              <option value="">+ เพิ่มคน</option>
              {free.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.roles.map((r) => ROLE_LABELS[r]).join(", ")}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </Field>
    </div>
  );
}

function friendly(msg: string) {
  if (/end_date|work_order_assignees|schema cache|does not exist/i.test(msg))
    return "ยังบันทึกไม่ได้ — ให้ Lovable รันไฟล์ docs/sql/field_work_handover.sql ก่อน";
  if (/work_orders_dates_chk/.test(msg)) return "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม";
  return msg;
}
