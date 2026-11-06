import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMeasurements } from "@/hooks/useMeasurements";
import { useWorkSheet } from "@/components/work/WorkSheet";
import { CANOE_SIZES, parseCanoe, pieceCuts, planCanoe, runsFromSpec, ssSectionText, type CanoeConfig } from "@/lib/canoe";
import { parseCutSpec } from "@/lib/cutSpec";
import { formatQty } from "@/lib/format";

type Led = { id: string; code: string; name: string; notes: string | null };

/** Canoe blocks of the current quotation with their piece plan (measured lengths win over the BOQ). */
export function useCanoeProduction(projectId: string) {
  const { lines } = useWorkSheet(projectId);
  const { data: measured } = useMeasurements(projectId);
  const ids = lines.map((l) => l.id);
  const { data } = useQuery({
    queryKey: ["canoe_production", projectId, ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data: rec, error } = await supabase
        .from("line_recipes")
        .select("quote_line_id, note")
        .in("quote_line_id", ids)
        .like("note", "CNO %");
      if (error) throw error;
      const blocks: { lineId: string; config: CanoeConfig }[] = [];
      for (const r of rec ?? []) {
        const config = parseCanoe(r.note);
        if (config) blocks.push({ lineId: r.quote_line_id, config });
      }
      const ledIds = [...new Set(blocks.map((b) => b.config.ledSkuId).filter(Boolean))];
      const { data: leds, error: e2 } = ledIds.length
        ? await supabase.from("skus").select("id, code, name, notes").in("id", ledIds)
        : { data: [] as Led[], error: null };
      if (e2) throw e2;
      return { blocks, leds: new Map((leds ?? []).map((s) => [s.id, s as Led])) };
    },
  });
  const byLine = new Map(lines.map((l) => [l.id, l]));
  return (data?.blocks ?? [])
    .map((b) => {
      const line = byLine.get(b.lineId);
      const led = data?.leds.get(b.config.ledSkuId);
      const m = measured?.get(b.lineId);
      const spec = m?.cut_spec ? parseCutSpec(m.cut_spec) : null;
      const runs = spec && !("error" in spec) ? runsFromSpec(spec.runs) : b.config.runs;
      return {
        lineId: b.lineId,
        itemNo: line?.item_no ?? "",
        config: b.config,
        led,
        fromSite: runs !== b.config.runs,
        plan: planCanoe({ double: b.config.double, runs, ...(b.config.housingType ? { housingType: b.config.housingType } : {}), ...(b.config.manualFits ? { manualFits: b.config.manualFits } : {}) }, led),
        retrofit: b.config.housingType === "retrofit",
        cuts: led ? pieceCuts(led, b.config.double) : [],
        ss: b.config.housingType === "ss" ? (b.config.ss ?? null) : null,
      };
    })
    .sort((a, b) => a.itemNo.localeCompare(b.itemNo, undefined, { numeric: true }));
}

const cm = (m: number) => `${formatQty(Math.round(m * 1000) / 10)}`;

/** ใบผลิต Canoe: pieces per run, totals per size, LED cut per piece, LED metres. No prices. */
export function CanoeProduction({ projectId, print = false }: { projectId: string; print?: boolean }) {
  const blocks = useCanoeProduction(projectId);
  if (!blocks.length) return null;
  const grand = Object.fromEntries(CANOE_SIZES.map((k) => [k, blocks.reduce((n, b) => n + b.plan.totals[k], 0)]));
  return (
    <div className={print ? "mt-4 space-y-3 text-[10px]" : "space-y-4 text-sm"}>
      <div className={print ? "font-bold" : "text-sm font-semibold"}>
        Canoe — ท่อน L / M / S / SS (+2 มม. ต่อรอยต่อ)
      </div>
      {blocks.map((b) => (
        <div key={b.lineId} className={print ? "break-inside-avoid border border-foreground p-1" : "rounded-md border border-border p-3"}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-semibold">
              {b.itemNo ? `ข้อ ${b.itemNo} · ` : ""}
              {b.config.code ? `${b.config.code} : ` : ""}
              {b.config.title} · {b.config.double ? "Double" : "Single"}
              {b.ss ? ` · ${b.ss.grade} ${ssSectionText(b.ss)} · ${b.ss.diffuser}` : ""}
              {b.retrofit ? ` · เปลี่ยนไฟในตัวเรือนเดิม · ชุดอะคริลิก + สาย IP68 ${b.plan.pieces} ชุด` : ""}
            </div>
            <div className={print ? "" : "text-xs text-muted-foreground"}>
              {b.led ? `${b.led.code} — ${b.led.name}` : "ไม่พบไฟ"} ·{" "}
              {b.fromSite ? <b>ความยาววัดจริง</b> : "ความยาวตาม BOQ"}
            </div>
          </div>
          <div className="mt-2 grid gap-3 lg:grid-cols-[1fr_auto]">
            <table className="w-full">
              <thead className={print ? "" : "text-left text-xs text-muted-foreground"}>
                <tr>
                  <th className="py-0.5 text-left">ความยาว (ม.)</th>
                  <th className="text-left">ชุด</th>
                  {CANOE_SIZES.map((k) => (
                    <th key={k} className="text-right">
                      {k}
                    </th>
                  ))}
                  <th className="text-right">ต่อได้ (ม.)</th>
                  <th className="text-right">ต่าง</th>
                  {b.ss ? <th className="text-right">สแตนเลส / ฝา (เส้น)</th> : null}
                </tr>
              </thead>
              <tbody>
                {b.plan.runs.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="py-0.5 tabular-nums">
                      {r.label ? <span className={print ? "" : "text-muted-foreground"}>ด้าน {r.label} · </span> : null}
                      {formatQty(r.length)}
                    </td>
                    <td className="tabular-nums">× {r.sets}</td>
                    {CANOE_SIZES.map((k) => (
                      <td key={k} className="text-right tabular-nums">
                        {r.fit?.counts[k] || ""}
                      </td>
                    ))}
                    <td className="text-right tabular-nums">{r.fit ? formatQty(r.fit.totalM) : "—"}</td>
                    <td className={"text-right tabular-nums " + (r.fit && !r.fit.ok ? "font-bold text-destructive" : "")}>
                      {r.fit ? `${r.fit.diffM >= 0 ? "เหลือ" : "เกิน"} ${cm(Math.abs(r.fit.diffM))} ซม.${r.fit.manual ? " (กำหนดเอง)" : ""}` : ""}
                    </td>
                    {b.ss ? <td className="text-right tabular-nums">{r.bars} × {r.sets}</td> : null}
                  </tr>
                ))}
                <tr className="border-t border-foreground font-semibold">
                  <td className="py-0.5">รวม {formatQty(b.plan.runM)} ม.</td>
                  <td />
                  {CANOE_SIZES.map((k) => (
                    <td key={k} className="text-right tabular-nums">
                      {b.plan.totals[k] || ""}
                    </td>
                  ))}
                  <td colSpan={2} className="text-right">
                    LED {formatQty(b.plan.ledM)} ม. · ราง 4/8 {formatQty(b.plan.ledM)} ม.
                  </td>
                  {b.ss ? <td className="text-right tabular-nums">{b.plan.ssBars} / {b.plan.ssCovers}</td> : null}
                </tr>
              </tbody>
            </table>
            <table className="h-fit">
              <thead className={print ? "" : "text-xs text-muted-foreground"}>
                <tr>
                  <th className="px-1 text-left">ท่อน</th>
                  {b.ss || b.retrofit ? null : <th className="px-1 text-right">ท่อน Canoe (ซม.)</th>}
                  <th className="px-1 text-right">LED ด้านนอก</th>
                  {b.config.double ? <th className="px-1 text-right">LED ด้านใน</th> : null}
                  <th className="px-1 text-right">จำนวน</th>
                </tr>
              </thead>
              <tbody>
                {b.cuts.filter((c) => !b.retrofit || c.size !== "SS").map((c) => (
                  <tr key={c.size} className="border-t border-border">
                    <td className="px-1 font-semibold">{c.size}</td>
                    {b.ss || b.retrofit ? null : <td className="px-1 text-right tabular-nums">{cm(c.housingM)}</td>}
                    <td className="px-1 text-right tabular-nums">{formatQty(c.outerCm)}</td>
                    {b.config.double ? <td className="px-1 text-right tabular-nums">{formatQty(c.innerCm ?? 0)}</td> : null}
                    <td className="px-1 text-right tabular-nums">{b.plan.totals[c.size] || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {blocks.length > 1 ? (
        <div className="font-semibold">
          รวมทุกชุด: {CANOE_SIZES.filter((k) => grand[k]).map((k) => `${k} ${grand[k]} ท่อน`).join(" · ")}
        </div>
      ) : null}
    </div>
  );
}
