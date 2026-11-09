import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useWorkSheet } from "@/components/work/WorkSheet";
import { formatCutLengths } from "@/lib/boq";
import { formatDate, formatQty } from "@/lib/format";
import { isMeasurable, measurementFromInput } from "@/lib/measure";
import { measurementsKey, useMeasurements, type Measurement } from "@/hooks/useMeasurements";
import { decodeOpenings, encodeOpenings, formatOpeningInput, openingInputOf, openingLines } from "@/lib/wos";

/**
 * วัดหน้างาน: the current BOQ lines (no prices) with the measured quantity and cut lengths.
 * Saved per line; a new Rev carries the measurements over, and the final Rev uses them.
 */
export function MeasureSection({
  projectId,
  workOrderId,
  canEdit,
}: {
  projectId: string;
  workOrderId: string | null;
  canEdit: boolean;
}) {
  const { lines, header, isLoading } = useWorkSheet(projectId);
  const { data: measured } = useMeasurements(projectId);
  const rows = lines.filter((l) => isMeasurable(l.kind));
  const done = rows.filter((l) => measured?.has(l.id)).length;

  if (isLoading) return <p className="text-sm text-muted-foreground">กำลังโหลด…</p>;
  if (!rows.length)
    return <p className="text-sm text-muted-foreground">ใบเสนอราคาปัจจุบันยังไม่มีรายการให้วัด</p>;

  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">
        ตามใบเสนอราคา {header?.ref_no ?? ""} Rev {header?.rev ?? "-"} · วัดแล้ว {done}/{rows.length} รายการ ·
        ใส่ความยาวที่ตัดจริง เช่น 1.50+2.25 (เมตร) ระบบรวมเป็นจำนวนให้ถ้าหน่วยเป็นเมตร
      </p>
      <ul className="space-y-2">
        {rows.map((l) => (
          <MeasureRow
            key={l.id + (measured?.get(l.id)?.measured_at ?? "")}
            line={l}
            m={measured?.get(l.id)}
            projectId={projectId}
            workOrderId={workOrderId}
            canEdit={canEdit}
          />
        ))}
      </ul>
    </div>
  );
}

function MeasureRow({
  line: l,
  m,
  projectId,
  workOrderId,
  canEdit,
}: {
  line: ReturnType<typeof useWorkSheet>["lines"][number];
  m: Measurement | undefined;
  projectId: string;
  workOrderId: string | null;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    cuts: m?.cut_spec ?? (m?.cut_lengths?.length ? m.cut_lengths.map((n) => Number(n)).join("+") : ""),
    qty: m?.measured_qty != null ? String(Number(m.measured_qty)) : "",
    note: m?.note ?? "",
  });
  // Clipso fabric lines are measured as opening sizes, not cut lengths
  const openings = openingLines(l.component_name ?? l.heading_text ?? "");
  const savedOpenings = decodeOpenings(m?.cut_spec);
  const [open, setOpen] = useState<string[]>(openings.map((_, i) => (savedOpenings?.[i] ? openingInputOf(savedOpenings[i]!) : "")));
  const refresh = () => {
    qc.invalidateQueries({ queryKey: measurementsKey(projectId) });
    qc.invalidateQueries({ queryKey: ["wo_lines", projectId] });
  };

  const save = useMutation({
    mutationFn: async () => {
      let v: ReturnType<typeof measurementFromInput>;
      if (openings.length) {
        const sizes = open.map((t) => (t.trim() ? formatOpeningInput(t) : ""));
        const bad = sizes.find((s) => typeof s !== "string");
        if (bad) throw new Error((bad as { error: string }).error);
        if (sizes.every((s) => !s)) throw new Error("ใส่ขนาดช่องเปิดจริงอย่างน้อย 1 ช่อง");
        v = { measured_qty: null, cut_lengths: null, cut_spec: encodeOpenings(sizes as string[]) };
      } else v = measurementFromInput({ qty: f.qty, cuts: f.cuts, unit: l.unit });
      if ("error" in v) throw new Error(v.error);
      const { error } = await supabase.from("site_measurements").upsert(
        {
          quote_line_id: l.id,
          project_id: projectId,
          work_order_id: workOrderId,
          measured_qty: v.measured_qty,
          cut_lengths: v.cut_lengths,
          cut_spec: v.cut_spec,
          note: f.note.trim() || null,
        },
        { onConflict: "quote_line_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`บันทึกค่าที่วัด ${l.item_no ?? ""}`.trim());
      refresh();
    },
    onError: (e: Error) =>
      toast.error(
        /site_measurements|schema cache|does not exist/i.test(e.message)
          ? "ยังบันทึกไม่ได้ — ให้ Lovable รันไฟล์ docs/sql/measure_final_rev.sql ก่อน"
          : e.message,
      ),
  });

  const clear = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("site_measurements").delete().eq("quote_line_id", l.id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const name = l.component_name ?? l.heading_text ?? "—";
  const changed =
    m?.measured_qty != null && l.qty != null && Number(m.measured_qty) !== Number(l.qty);

  return (
    <li className={"rounded-md border p-3 " + (m ? "border-primary/40 bg-primary/5" : "border-border")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">
            {l.item_no ? <span className="mr-1 text-muted-foreground">{l.item_no}</span> : null}
            {name}
          </div>
          {l.zone || l.circuit_note ? (
            <div className="text-xs text-muted-foreground">
              {[l.zone, l.circuit_note].filter(Boolean).join(" · ")}
            </div>
          ) : null}
        </div>
        <div className="text-right text-xs">
          <div className="text-muted-foreground">ตามสัญญา</div>
          <div className="tabular-nums">
            {formatQty(Number(l.qty ?? 0))} {l.unit ?? ""}
            {l.cut_lengths?.length ? <span className="text-muted-foreground"> · {formatCutLengths(l.cut_lengths)}</span> : null}
          </div>
        </div>
      </div>
      {openings.length ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {openings.map((size, i) => (
            <label key={i} className="text-xs">
              <span className="text-muted-foreground">ขนาดจริงของช่อง {size} (กว้างxยาว หรือ กว้างxยาวxจำนวนช่อง)</span>
              <Input
                className="mt-0.5 h-9"
                value={open[i] ?? ""}
                disabled={!canEdit}
                placeholder="เช่น 1.96x1.60 หรือ 1.88x1.85x3"
                onChange={(e) => setOpen(open.map((t, j) => (j === i ? e.target.value : t)))}
              />
            </label>
          ))}
        </div>
      ) : null}
      <div className={"mt-2 grid gap-2 sm:items-start " + (openings.length ? "sm:grid-cols-[1fr_auto]" : "sm:grid-cols-[2fr_1fr_2fr_auto]")}>
        {openings.length ? null : (
        <>
        <label className="text-xs">
          <span className="text-muted-foreground">ความยาวที่วัด/ตัดจริง (ม.) · x = จำนวนชุด · [ ] = ต่อกัน</span>
          <Input
            className="mt-0.5 h-9"
            value={f.cuts}
            disabled={!canEdit}
            placeholder="เช่น 1.5+2.25 หรือ 0.682x2 + [3.015+3.515]x2"
            onChange={(e) => setF({ ...f, cuts: e.target.value })}
          />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">จำนวนที่วัด ({l.unit ?? "-"})</span>
          <Input
            className="mt-0.5 h-9"
            inputMode="decimal"
            value={f.qty}
            disabled={!canEdit}
            placeholder="รวมให้เอง"
            onChange={(e) => setF({ ...f, qty: e.target.value })}
          />
          {changed ? (
            <span className="mt-0.5 block text-[11px] font-semibold text-warning">
              {Number(m!.measured_qty) > Number(l.qty) ? "▲" : "▼"} ต่างจากสัญญา
            </span>
          ) : null}
        </label>
        </>
        )}
        <label className="text-xs">
          <span className="text-muted-foreground">หมายเหตุ</span>
          <Input
            className="mt-0.5 h-9"
            value={f.note}
            disabled={!canEdit}
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
          {m ? <span className="mt-0.5 block text-[10px] text-muted-foreground">วัดเมื่อ {formatDate(m.measured_at)}</span> : null}
        </label>
        {canEdit ? (
          <div className="flex gap-1 sm:pt-4">
            <Button size="sm" className="h-9" disabled={save.isPending} onClick={() => save.mutate()}>
              บันทึก
            </Button>
            {m ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-9 px-2 text-destructive"
                title="ล้างค่าที่วัด"
                onClick={() => {
                  if (confirm("ล้างค่าที่วัดของรายการนี้?")) clear.mutate();
                }}
              >
                ล้าง
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
