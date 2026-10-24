import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useWorkSheet } from "@/components/work/WorkSheet";
import { useMeasurements } from "@/hooks/useMeasurements";
import { parseCutSpec, runsFromPieces, type CutRun } from "@/lib/cutSpec";
import { isMeasurable } from "@/lib/measure";
import {
  colourFromText,
  fixtureCode,
  lineRows,
  lineTotals,
  suggestPsu,
  wattFromText,
  type PieceRow,
  type Rounding,
} from "@/lib/production";
import { categoryOf } from "@/lib/skuCategory";
import { attrsOf } from "@/lib/skuAttrs";

type Sku = { id: string; code: string; name: string; unit: string; notes: string | null; is_roll: boolean; cut_step_cm: number | null };
export type ProductionSettings = {
  item_no: string;
  rounding: Rounding;
  assembly: string | null;
  notified_on: string | null;
  remark: string | null;
};

export const productionSettingsKey = (projectId: string) => ["production_line_settings", projectId];

export type ProductionLine = {
  id: string;
  itemNo: string;
  name: string;
  fixture: string | null;
  circuit: string | null;
  led: Sku;
  profile: Sku | null;
  stepCm: number | null;
  wattPerM: number | null;
  colour: string | null;
  measured: boolean;
  runs: CutRun[];
  rows: PieceRow[];
  totals: ReturnType<typeof lineTotals>;
  psu: number | null;
  settings: ProductionSettings;
};

/**
 * Production sheet data: every current BOQ line made with a cut-to-length LED strip
 * (Neon flex rolls have their own roll plan). No prices are read.
 */
export function useProduction(projectId: string) {
  const { lines, isLoading } = useWorkSheet(projectId);
  const { data: measured } = useMeasurements(projectId);
  const ids = lines.map((l) => l.id);
  const codes = [...new Set(lines.map((l) => l.component_code).filter(Boolean) as string[])];

  const skus = useQuery({
    queryKey: ["production_skus", projectId, ids.join(","), codes.join(",")],
    enabled: lines.length > 0,
    queryFn: async () => {
      const [lr, comps] = await Promise.all([
        supabase.from("line_recipes").select("quote_line_id, sku_id").in("quote_line_id", ids),
        codes.length
          ? supabase.from("sales_components").select("id, code").in("code", codes)
          : Promise.resolve({ data: [] as { id: string; code: string }[], error: null }),
      ]);
      if (lr.error) throw lr.error;
      if (comps.error) throw comps.error;
      const compIds = (comps.data ?? []).map((c) => c.id);
      const rec = compIds.length
        ? await supabase.from("recipes").select("component_id, sku_id").in("component_id", compIds)
        : { data: [] as { component_id: string; sku_id: string }[], error: null };
      if (rec.error) throw rec.error;
      const skuIds = [...new Set([...(lr.data ?? []).map((r) => r.sku_id), ...(rec.data ?? []).map((r) => r.sku_id)])];
      const sk = skuIds.length
        ? await supabase.from("skus").select("id, code, name, unit, notes, is_roll, cut_step_cm").in("id", skuIds)
        : { data: [] as Sku[], error: null };
      if (sk.error) throw sk.error;
      const byId = new Map((sk.data ?? []).map((s) => [s.id, s as Sku]));
      const codeToComp = new Map((comps.data ?? []).map((c) => [c.code, c.id]));
      const perLine = new Map<string, Sku[]>();
      for (const r of lr.data ?? []) {
        const s = byId.get(r.sku_id);
        if (s) perLine.set(r.quote_line_id, [...(perLine.get(r.quote_line_id) ?? []), s]);
      }
      const perComp = new Map<string, Sku[]>();
      for (const r of rec.data ?? []) {
        const s = byId.get(r.sku_id);
        if (s) perComp.set(r.component_id, [...(perComp.get(r.component_id) ?? []), s]);
      }
      return { perLine, perComp, codeToComp };
    },
  });

  const settings = useQuery({
    queryKey: productionSettingsKey(projectId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_line_settings")
        .select("item_no, rounding, assembly, notified_on, remark")
        .eq("project_id", projectId);
      if (error) {
        if (/does not exist|schema cache/i.test(error.message)) return new Map<string, ProductionSettings>();
        throw error;
      }
      return new Map(data.map((s) => [s.item_no, s as ProductionSettings]));
    },
  });

  const out: ProductionLine[] = [];
  let heading: (typeof lines)[number] | null = null;
  for (const l of lines) {
    if (l.kind === "heading") {
      heading = l;
      continue;
    }
    if (!isMeasurable(l.kind) || !skus.data) continue;
    const comp = l.component_code ? skus.data.codeToComp.get(l.component_code) : undefined;
    const all = skus.data.perLine.get(l.id) ?? (comp ? skus.data.perComp.get(comp) : undefined) ?? [];
    const led = all.find((s) => !s.is_roll && (s.cut_step_cm !== null || categoryOf(s) === "LED ribbon"));
    if (!led) continue;
    const profile = all.find((s) => categoryOf(s) === "LED profile") ?? null;
    const m = measured?.get(l.id);
    const spec = m?.cut_spec ? parseCutSpec(m.cut_spec) : null;
    const pieces = m?.cut_lengths?.length ? m.cut_lengths : l.cut_lengths;
    const runs = spec && !("error" in spec) ? spec.runs : pieces?.length ? runsFromPieces(pieces.map(Number)) : [];
    const name = l.component_name ?? l.heading_text ?? "";
    const headText = heading?.heading_text ?? heading?.component_name ?? "";
    const wattAttr = Number(attrsOf(led.notes)["W/m"]);
    const wattPerM = wattAttr > 0 ? wattAttr : wattFromText(led.name) ?? wattFromText(headText) ?? wattFromText(name);
    const itemNo = l.item_no ?? l.id.slice(0, 6);
    const st: ProductionSettings = settings.data?.get(itemNo) ?? {
      item_no: itemNo,
      rounding: "down",
      assembly: null,
      notified_on: null,
      remark: null,
    };
    const rows = lineRows(runs, { stepCm: led.cut_step_cm, wattPerM, hasProfile: !!profile, rounding: st.rounding });
    const totals = lineTotals(rows);
    out.push({
      id: l.id,
      itemNo,
      name,
      fixture: fixtureCode(headText) ?? fixtureCode(name),
      circuit: l.circuit_note,
      led,
      profile,
      stepCm: led.cut_step_cm,
      wattPerM,
      colour: colourFromText(led.name) ?? colourFromText(headText) ?? colourFromText(name),
      measured: !!m,
      runs,
      rows,
      totals,
      psu: suggestPsu(totals.amps),
      settings: st,
    });
  }
  return { lines: out, isLoading: isLoading || skus.isLoading };
}
