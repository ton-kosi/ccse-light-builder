import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { productionSettingsKey, useProduction, type ProductionLine, type ProductionSettings } from "@/hooks/useProduction";
import { formatCutSpec } from "@/lib/cutSpec";
import { formatDate, formatQty } from "@/lib/format";

export const ASSEMBLY_OPTIONS = ["พับ LED", "เฉลี่ยกลาง"];
const n2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * ใบผลิต (production sheet): per LED line the site pieces → LED cut (cut step), profile cut,
 * difference, and the totals the workshop prepares (heat shrink, bars, clips, load, PSU).
 */
export function ProductionSheet({
  projectId,
  canEdit,
  print = false,
}: {
  projectId: string;
  canEdit: boolean;
  print?: boolean;
}) {
  const { lines, isLoading } = useProduction(projectId);
  if (isLoading) return <p className="text-sm text-muted-foreground">กำลังโหลด…</p>;
  if (!lines.length)
    return (
      <p className="text-sm text-muted-foreground">
        ยังไม่มีรายการไฟเส้นที่ต้องตัด — ใช้ได้กับรายการที่ผูก SKU “LED เส้น” (ตั้งระยะตัดที่หน้า SKU)
      </p>
    );
  const totalA = lines.reduce((s, l) => s + (l.totals.amps ?? 0), 0);

  return (
    <div className={print ? "space-y-3 text-[10.5px]" : "space-y-4 text-sm"}>
      {!print ? (
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/print/production/$projectId" params={{ projectId }} target="_blank">
              พิมพ์ใบผลิต (ตัดไฟ)
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link to="/print/stickers/$projectId" params={{ projectId }} target="_blank">
              พิมพ์สติ๊กเกอร์
            </Link>
          </Button>
        </div>
      ) : null}
      {lines.map((l) => (
        <LineBlock key={l.id} l={l} projectId={projectId} canEdit={canEdit && !print} print={print} />
      ))}
      <div className={print ? "text-right font-semibold" : "text-right text-xs font-semibold"}>
        โหลดรวมทุกรายการ {n2(totalA)} A @24V
      </div>
    </div>
  );
}

function LineBlock({ l, projectId, canEdit, print }: { l: ProductionLine; projectId: string; canEdit: boolean; print: boolean }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: async (patch: Partial<ProductionSettings>) => {
      const { error } = await supabase
        .from("production_line_settings")
        .upsert({ ...l.settings, ...patch, project_id: projectId, item_no: l.itemNo }, { onConflict: "project_id,item_no" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: productionSettingsKey(projectId) }),
    onError: (e: Error) =>
      toast.error(
        /production_line_settings|schema cache/i.test(e.message)
          ? "ยังบันทึกไม่ได้ — ให้ Lovable รันไฟล์ docs/sql/production_settings.sql ก่อน"
          : e.message,
      ),
  });
  const th = "border border-border px-1.5 py-1 text-left font-semibold whitespace-normal";
  const td = "border border-border px-1.5 py-0.5 tabular-nums";
  const s = l.settings;

  return (
    <section className="break-inside-avoid rounded-md border border-border p-2" data-pdf-keep>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold">
            {l.itemNo} {l.fixture ? <span className="font-mono">{l.fixture}</span> : null} · {l.name}
            {l.circuit ? <span className="text-muted-foreground"> · {l.circuit}</span> : null}
          </div>
          <div className="text-muted-foreground">
            LED {l.led.code} — {l.wattPerM ? `${l.wattPerM}W/m` : "W/m ?"} {l.colour ?? ""} · ระยะตัด{" "}
            {l.stepCm ? `${l.stepCm} ซม.` : <span className="text-destructive">ยังไม่ตั้ง (หน้า SKU)</span>}
            {l.profile ? ` · Profile ${l.profile.code}` : " · ไม่มี profile"}
            {l.runs.length ? ` · ${l.measured ? "ระยะวัดจริง" : "ระยะตาม BOQ"}: ${formatCutSpec(l.runs)}` : ""}
          </div>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <select
              className="h-8 rounded-md border border-input bg-background px-2"
              value={s.rounding}
              onChange={(e) => save.mutate({ rounding: e.target.value as ProductionSettings["rounding"] })}
              title="ตัด LED ให้สั้นกว่า หรือยาวกว่าระยะหน้างาน"
            >
              <option value="down">ตัดสั้นกว่า (ปัดลง)</option>
              <option value="up">ตัดยาวกว่า (ปัดขึ้น)</option>
            </select>
            <select
              className="h-8 rounded-md border border-input bg-background px-2"
              value={s.assembly ?? ""}
              onChange={(e) => save.mutate({ assembly: e.target.value || null })}
            >
              <option value="">— ประกอบ —</option>
              {ASSEMBLY_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <Input
              type="date"
              className="h-8 w-36"
              title="วันแจ้งผลิต"
              defaultValue={s.notified_on ?? ""}
              key={s.notified_on ?? ""}
              onBlur={(e) => e.target.value !== (s.notified_on ?? "") && save.mutate({ notified_on: e.target.value || null })}
            />
            <Input
              className="h-8 w-40"
              placeholder="Remark"
              defaultValue={s.remark ?? ""}
              key={s.remark ?? ""}
              onBlur={(e) => e.target.value.trim() !== (s.remark ?? "") && save.mutate({ remark: e.target.value.trim() || null })}
            />
          </div>
        ) : (
          <div className="text-right text-muted-foreground">
            {s.rounding === "up" ? "ตัดยาวกว่า" : "ตัดสั้นกว่า"}
            {s.assembly ? ` · ${s.assembly}` : ""}
            {s.notified_on ? ` · แจ้งผลิต ${formatDate(s.notified_on)}` : ""}
            {s.remark ? ` · ${s.remark}` : ""}
          </div>
        )}
      </div>

      {l.rows.length ? (
        <div className={print ? "" : "overflow-x-auto"}>
        <table className={"mt-2 w-full border-collapse whitespace-nowrap" + (print ? "" : " min-w-[720px]")}>
          <thead className="bg-muted">
            <tr>
              <th className={th}>ระยะหน้างาน (cm)</th>
              <th className={th + " text-right"}>จำนวนท่อน</th>
              <th className={th + " text-right"}>ระยะตัด LED (cm)</th>
              {l.profile ? <th className={th + " text-right"}>ระยะตัด Profile (cm)</th> : null}
              <th className={th + " text-right"}>ส่วนต่าง (cm)</th>
              <th className={th + " text-right"}>ตัวเลือก สั้น / ยาว</th>
              <th className={th + " text-right"}>ท่อหด (cm)</th>
              <th className={th + " text-right"}>Clip</th>
              <th className={th + " text-right"}>A</th>
            </tr>
          </thead>
          <tbody>
            {l.rows.map((r, i) => (
              <tr key={i}>
                <td className={td}>{n2(r.siteCm)}</td>
                <td className={td + " text-right"}>{r.sets}</td>
                <td className={td + " text-right font-semibold"}>{n2(r.ledCm)}</td>
                {l.profile ? <td className={td + " text-right"}>{r.profileCm !== null ? n2(r.profileCm) : ""}</td> : null}
                <td className={td + " text-right " + (Math.abs(r.diffCm) > (l.stepCm ?? 0) / 2 ? "text-warning" : "")}>
                  {n2(r.diffCm)}
                </td>
                <td className={td + " text-right text-muted-foreground"}>
                  {n2(r.shorter)} / {n2(r.longer)}
                </td>
                <td className={td + " text-right"}>{n2(r.shrinkCm)}</td>
                <td className={td + " text-right"}>{r.clips}</td>
                <td className={td + " text-right"}>{r.amps !== null ? n2(r.amps) : "-"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="font-semibold">
            <tr>
              <td className={td}>รวม</td>
              <td className={td + " text-right"}>{l.totals.pieces}</td>
              <td className={td + " text-right"}>{formatQty(l.totals.ledM)} m</td>
              {l.profile ? <td className={td + " text-right"}>{formatQty(l.totals.profileM)} m</td> : null}
              <td className={td} colSpan={2}>
                อลูมิเนียม {l.totals.bars} เส้น (6 ม.)
              </td>
              <td className={td + " text-right"}>{formatQty(l.totals.shrinkM)} m</td>
              <td className={td + " text-right"}>{l.totals.clips}</td>
              <td className={td + " text-right"}>
                {l.totals.amps !== null ? n2(l.totals.amps) : "-"}
                {l.psu ? (
                  <div className="text-[10px] font-normal text-muted-foreground">PSU แนะนำ 24V {l.psu}A</div>
                ) : l.totals.amps ? (
                  <div className="text-[10px] font-normal text-destructive">เกิน 18.8A — แบ่งวงจร</div>
                ) : null}
              </td>
            </tr>
          </tfoot>
        </table>
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">ยังไม่มีระยะ — ใส่ความยาวที่ “วัดหน้างาน” หรือในช่องตัดเส้นของ BOQ</p>
      )}
    </section>
  );
}
