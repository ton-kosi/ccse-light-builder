import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CLAUSE_SECTIONS, sectionLabel } from "@/lib/clauses";

/** Notes & warranty clauses linked to one sales component (inside the component edit dialog). */
export function ComponentClauses({
  componentId,
  canEdit,
}: {
  componentId: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [pick, setPick] = useState("");

  const { data: all } = useQuery({
    queryKey: ["quote_clauses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_clauses")
        .select("*")
        .order("sort_order")
        .order("text");
      if (error) throw error;
      return data;
    },
  });
  const { data: linked } = useQuery({
    queryKey: ["component_clauses", "component", componentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("component_clauses")
        .select("clause_id")
        .eq("component_id", componentId);
      if (error) throw error;
      return new Set(data.map((d) => d.clause_id));
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ clauseId, on }: { clauseId: string; on: boolean }) => {
      const { error } = on
        ? await supabase
            .from("component_clauses")
            .insert({ component_id: componentId, clause_id: clauseId })
        : await supabase
            .from("component_clauses")
            .delete()
            .eq("component_id", componentId)
            .eq("clause_id", clauseId);
      if (error) throw error;
    },
    onSuccess: () => {
      setPick("");
      qc.invalidateQueries({ queryKey: ["component_clauses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mine = (all ?? []).filter((c) => linked?.has(c.id));
  const available = (all ?? []).filter((c) => c.active && !c.always_include && !linked?.has(c.id));

  return (
    <section className="mt-5">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">หมายเหตุและประกันของชิ้นส่วนนี้</h3>
        <Link to="/clauses" className="text-xs text-primary underline-offset-2 hover:underline">
          จัดการข้อความทั้งหมด
        </Link>
      </div>
      {mine.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          ยังไม่ได้ผูกข้อความ — ใบเสนอราคาที่มีชิ้นส่วนนี้จะไม่มีหมายเหตุหรือประกันเพิ่ม
        </p>
      ) : (
        <ul className="divide-y divide-border rounded border border-border text-sm">
          {mine.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 px-3 py-2">
              <span>
                <span className="mr-2 rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium">
                  {sectionLabel(c.section)}
                </span>
                <span className="whitespace-pre-line">{c.text}</span>
                {!c.active ? (
                  <span className="ml-2 text-xs text-muted-foreground">(ปิดใช้งาน)</span>
                ) : null}
              </span>
              {canEdit ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={() => toggle.mutate({ clauseId: c.id, on: false })}
                >
                  เอาออก
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <div className="mt-2 flex gap-2">
          <select
            className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            <option value="">— เลือกข้อความเพื่อผูก —</option>
            {CLAUSE_SECTIONS.map((s) => {
              const opts = available.filter((c) => c.section === s.value);
              return opts.length ? (
                <optgroup key={s.value} label={s.label}>
                  {opts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.text.length > 110 ? c.text.slice(0, 110) + "…" : c.text}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
          <Button
            size="sm"
            disabled={!pick || toggle.isPending}
            onClick={() => toggle.mutate({ clauseId: pick, on: true })}
          >
            ผูก
          </Button>
        </div>
      ) : null}
    </section>
  );
}
