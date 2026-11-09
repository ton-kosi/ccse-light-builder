import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useMeasurements } from "@/hooks/useMeasurements";
import { useProduction } from "@/hooks/useProduction";
import { formatCutLengths } from "@/lib/boq";
import { findBlocks, rebuildBlock, splitDiffs, type DiffItem, type FrRecipe, type FrSku, type MaterialDiff, type RebuiltBlock } from "@/lib/finalRev";
import { formatQty, formatTHB } from "@/lib/format";
import { compareLine, finalQty, isMeasurable } from "@/lib/measure";
import { useSkuPrices } from "@/lib/skuPrices";

type Line = {
  id: string;
  sort_order: number;
  kind: string;
  item_no: string | null;
  zone: string | null;
  customer_text: string | null;
  option_name: string | null;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  discount_percent: number;
  cut_lengths: number[] | null;
  sales_components: { name: string; unit: string } | null;
};

/** One choice in the comparison: a measured line, or a whole rebuilt builder block. */
type Group = {
  key: string;
  title: string;
  itemNo: string | null;
  note: string | null;
  items: DiffItem[];
  materials: MaterialDiff[];
  amountDiff: number;
  counted: boolean;
  /** rows of the current Rev it covers */
  rows: Line[];
  block: RebuiltBlock | null;
  /** plain line: quantity to bill and what was typed on site */
  finalQty?: number;
  typedQty?: number;
};

/**
 * What the measurements add and reduce against the contract. Each line can be taken as measured or
 * kept as in the contract; the chosen result becomes the final Rev, and its last payment term the balance.
 */
export function FinalRevPanel({
  projectId,
  lines,
  selectedOption,
  vatPercent,
  canEdit,
  canSeeMoney,
}: {
  projectId: string;
  lines: Line[];
  selectedOption: string | null;
  vatPercent: number;
  canEdit: boolean;
  canSeeMoney: boolean;
}) {
  const qc = useQueryClient();
  const { data: measured } = useMeasurements(projectId);
  const { lines: production, ready: productionReady } = useProduction(projectId);
  const { data: prices } = useSkuPrices(canSeeMoney);
  const [open, setOpen] = useState(false);
  /** lines kept as in the contract; everything else takes the measurement */
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const ordered = useMemo(() => [...lines].sort((a, b) => a.sort_order - b.sort_order), [lines]);
  const ids = ordered.map((l) => l.id);

  const { data: parts } = useQuery({
    queryKey: ["final_rev_parts", projectId, ids.join(",")],
    enabled: ids.length > 0 && !!measured?.size,
    queryFn: async () => {
      const { data: rec, error } = await supabase.from("line_recipes").select("quote_line_id, sku_id, qty, note").in("quote_line_id", ids);
      if (error) throw error;
      const { data: sk, error: e2 } = await supabase.from("skus").select("id, code, name, unit, notes");
      if (e2) throw e2;
      return { recipes: rec as FrRecipe[], skus: new Map((sk ?? []).map((s) => [s.id, s as FrSku])) };
    },
  });

  const cutOf = useMemo(() => new Map(production.filter((p) => p.stepCm).map((p) => [p.id, p.totals.ledM])), [production]);
  const included = (l: Line) => !(l.option_name ?? "").trim() || (l.option_name ?? "").trim() === (selectedOption ?? "").trim();

  const groups = useMemo<Group[]>(() => {
    if (!measured || !parts || !prices) return [];
    const recipesOf = (id: string) => parts.recipes.filter((r) => r.quote_line_id === id);
    const billedOf = (id: string, m: { measured_qty: number | null; cut_lengths: number[] | null }) =>
      finalQty(m.measured_qty != null ? Number(m.measured_qty) : Number(lines.find((l) => l.id === id)?.qty ?? 0), cutOf.get(id), !!m.cut_lengths?.length);
    const out: Group[] = [];
    const inBlock = new Set<string>();
    for (const b of findBlocks(ordered, parts.recipes)) {
      const rebuilt = rebuildBlock(b.type, b.config, b.rows, {
        recipesOf,
        measureOf: (id) => measured.get(id),
        billedOf,
        prices,
        skuOf: (id) => parts.skus.get(id),
        newId: () => crypto.randomUUID(),
      });
      if (!rebuilt) continue;
      const rows = b.rows as Line[];
      rows.forEach((l) => inBlock.add(l.id));
      out.push({
        key: `block:${(b.config as { blockId: string }).blockId}:${rows[0]?.id}`,
        title: (rows[0]?.customer_text ?? "").split("\n")[0] ?? "",
        itemNo: rows[0]?.item_no ?? null,
        note: null,
        items: rebuilt.items,
        materials: rebuilt.materials,
        amountDiff: rebuilt.amountDiff,
        counted: rows[0] ? included(rows[0]) : false,
        rows,
        block: rebuilt,
      });
    }
    for (const l of ordered) {
      const m = measured.get(l.id);
      if (!m || inBlock.has(l.id) || !isMeasurable(l.kind)) continue;
      const typed = m.measured_qty != null ? Number(m.measured_qty) : Number(l.qty ?? 0);
      const mq = finalQty(typed, cutOf.get(l.id), !!m.cut_lengths?.length);
      const cmp = { contractQty: Number(l.qty ?? 0), measuredQty: mq, unitPrice: Number(l.unit_price ?? 0), discountPercent: Number(l.discount_percent ?? 0) };
      const diff = compareLine(cmp);
      const ratio = cmp.contractQty > 0 ? mq / cmp.contractQty : 1;
      const counted = included(l) && l.kind === "priced";
      out.push({
        key: l.id,
        title: l.customer_text?.split("\n")[0] || l.sales_components?.name || "—",
        itemNo: l.item_no,
        note: [m.cut_lengths?.length ? `ตัด ${m.cut_spec || formatCutLengths(m.cut_lengths)}` : "", m.note ?? ""].filter(Boolean).join(" · ") || null,
        items: diff.qtyDiff || diff.amountDiff
          ? [{ text: l.customer_text?.split("\n")[0] || "", oldQty: cmp.contractQty, newQty: mq, unit: l.unit ?? l.sales_components?.unit ?? null, oldAmount: 0, newAmount: diff.amountDiff }]
          : [],
        materials: recipesOf(l.id)
          .filter(() => ratio !== 1)
          .map((r) => ({ skuId: r.sku_id, oldQty: Number(r.qty), newQty: Math.round(Number(r.qty) * ratio * 1000) / 1000 })),
        amountDiff: diff.amountDiff,
        counted,
        rows: [l],
        block: null,
        finalQty: mq,
        typedQty: typed,
      });
    }
    const at = (g: Group) => ordered.findIndex((l) => l.id === g.rows[0]?.id);
    return out.sort((a, b) => at(a) - at(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measured, parts, prices, ordered, cutOf, selectedOption]);

  const final = useMutation({
    mutationFn: async () => {
      // the final Rev takes measured_qty: LED lines bill what production really cuts
      for (const g of groups) {
        if (g.block || keep.has(g.key) || g.finalQty === g.typedQty) continue;
        const { error } = await supabase.from("site_measurements").update({ measured_qty: g.finalQty ?? null }).eq("quote_line_id", g.rows[0]!.id);
        if (error) throw error;
      }
      const { data: newId, error } = await supabase.rpc("create_final_revision", { _project_id: projectId });
      if (error) throw error;
      const { data: fresh, error: e2 } = await supabase.from("quote_lines").select("id, sort_order").eq("quotation_id", newId).order("sort_order");
      if (e2) throw e2;
      if (fresh.length !== ordered.length) throw new Error("จำนวนบรรทัดของ Rev ใหม่ไม่ตรง — หยุดก่อน กรุณาตรวจ Rev ล่าสุด");
      const copyOf = new Map(ordered.map((l, i) => [l.id, fresh[i]!.id]));

      // kept as in the contract: the new Rev goes back to the contract quantity
      for (const g of groups.filter((x) => keep.has(x.key))) {
        for (const l of g.rows) {
          const { error: e } = await supabase.from("quote_lines").update({ qty: l.qty, cut_lengths: l.cut_lengths }).eq("id", copyOf.get(l.id)!);
          if (e) throw e;
        }
      }
      // measured plain line: its own materials follow the quantity
      for (const g of groups.filter((x) => !keep.has(x.key) && !x.block)) {
        const contract = Number(g.rows[0]!.qty ?? 0);
        if (!(contract > 0) || g.finalQty === contract) continue;
        const ratio = Number(g.finalQty) / contract;
        const { data: rec, error: e } = await supabase.from("line_recipes").select("id, qty").eq("quote_line_id", copyOf.get(g.rows[0]!.id)!);
        if (e) throw e;
        for (const r of rec) {
          const { error: e3 } = await supabase.from("line_recipes").update({ qty: Math.round(Number(r.qty) * ratio * 1000) / 1000 }).eq("id", r.id);
          if (e3) throw e3;
        }
      }
      // measured builder block: rebuilt rows take the place of the copied ones
      const seq: string[] = [];
      const done = new Set<string>();
      const chosen = groups.filter((g) => g.block && !keep.has(g.key));
      for (const l of ordered) {
        const g = chosen.find((x) => x.rows.some((r) => r.id === l.id));
        if (!g) seq.push(copyOf.get(l.id)!);
        else if (!done.has(g.key)) {
          done.add(g.key);
          seq.push(...g.block!.rows.map((r) => r.id));
        }
      }
      for (const g of chosen) {
        const b = g.block!;
        const { error: eDel } = await supabase.from("quote_lines").delete().in("id", g.rows.map((r) => copyOf.get(r.id)!));
        if (eDel) throw eDel;
        const { error: eIns } = await supabase.from("quote_lines").insert(
          b.rows.map((r) => ({
            id: r.id,
            quotation_id: newId,
            sort_order: (seq.indexOf(r.id) + 1) * 10,
            kind: r.kind,
            item_no: r.item_no ?? null,
            customer_text: r.customer_text,
            qty: r.qty,
            unit: r.unit,
            unit_price: r.unit_price,
            discount_percent: r.discount_percent,
            option_name: r.option_name,
            zone: r.zone,
            component_id: null,
            circuit_note: null,
            cut_lengths: r.cut_lengths ?? null,
          })),
        );
        if (eIns) throw eIns;
        const recipes = b.rows.flatMap((r) => r.recipes.map((x) => ({ ...x, quote_line_id: r.id })));
        if (recipes.length) {
          const { error: eRec } = await supabase.from("line_recipes").insert(recipes);
          if (eRec) throw eRec;
        }
        if (b.carry.length) {
          const { error: eM } = await supabase.from("site_measurements").insert(
            b.carry.map((c) => ({
              quote_line_id: c.rowId,
              project_id: projectId,
              measured_qty: c.measuredQty,
              cut_lengths: c.measure.cut_lengths,
              // the size is now in the line's text: nothing left to cross out
              cut_spec: c.measure.cut_spec?.startsWith("OPEN ") ? null : (c.measure.cut_spec ?? null),
              note: c.measure.note,
              measured_at: c.measure.measured_at,
            })),
          );
          if (eM) throw eM;
        }
      }
      if (chosen.length) {
        const sortOf = new Map(fresh.map((x) => [x.id, x.sort_order]));
        for (const [i, id] of seq.entries()) {
          const so = (i + 1) * 10;
          if (!sortOf.has(id) || sortOf.get(id) === so) continue;
          const { error: eS } = await supabase.from("quote_lines").update({ sort_order: so }).eq("id", id);
          if (eS) throw eS;
        }
      }
    },
    onSuccess: () => {
      toast.success("สร้าง Rev สุดท้ายแล้ว — งวดสุดท้ายเป็นยอดคงเหลือ");
      setKeep(new Set());
      ["quotation", "quotation_revs", "quote_lines", "payment_terms", "payment_schedule", "site_measurements", "wo_lines", "wo_header", "line_recipes", "set_lines"].forEach(
        (k) => qc.invalidateQueries({ queryKey: [k] }),
      );
    },
    onError: (e: Error) =>
      toast.error(
        /create_final_revision|schema cache/i.test(e.message)
          ? "ยังสร้างไม่ได้ — ให้ Lovable รันไฟล์ docs/sql/measure_final_rev.sql ก่อน"
          : `สร้าง Rev ไม่สำเร็จ กรุณาตรวจ Rev ล่าสุด: ${e.message}`,
      ),
  });

  if (!groups.length) return null;
  const sign = (n: number) => (n > 0 ? "+" : "");
  const changedGroups = groups.filter((g) => g.items.length || g.materials.length);
  const chosenDiffs = groups.filter((g) => g.counted && !keep.has(g.key)).map((g) => g.amountDiff);
  const all = splitDiffs(groups.filter((g) => g.counted).map((g) => g.amountDiff));
  const { add, cut, net } = splitDiffs(chosenDiffs);
  const withVat = Math.round(net * (1 + vatPercent / 100) * 100) / 100;
  const skuCode = (id: string) => parts?.skus.get(id)?.code ?? id;
  const skuUnit = (id: string) => parts?.skus.get(id)?.unit ?? "";
  const toggle = (key: string) =>
    setKeep((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">สรุปส่วนเพิ่ม / ส่วนลด สำหรับงวดสุดท้าย</div>
          <div className="text-xs text-muted-foreground">
            เปลี่ยนจากสัญญา {changedGroups.length} รายการ
            {canSeeMoney ? (
              <>
                {" · "}ตามที่เลือก: เพิ่ม <b className="text-success">{sign(add)}{formatTHB(add)}</b> · ลด{" "}
                <b className="text-destructive">{formatTHB(cut)}</b> · สุทธิ <b>{sign(net)}{formatTHB(net)}</b> บาท ก่อน VAT ({sign(withVat)}
                {formatTHB(withVat)} รวม VAT)
              </>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>
            {open ? "ซ่อนรายละเอียด" : "เทียบและเลือกรายการ"}
          </Button>
          {canEdit ? (
            <Button
              size="sm"
              disabled={final.isPending || !productionReady}
              onClick={() => {
                const kept = keep.size ? `\nคงตามสัญญา ${keep.size} รายการ` : "";
                if (confirm(`สร้าง Rev สุดท้ายตามที่เลือก?${kept}\nงวดสุดท้ายจะถูกตั้งเป็น “ยอดคงเหลือ” เพื่อเบิกส่วนที่เหลือทั้งหมด`)) final.mutate();
              }}
            >
              {productionReady ? "สร้าง Rev สุดท้ายตามที่เลือก" : "กำลังโหลดใบผลิต..."}
            </Button>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="mt-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setKeep(new Set())}>
              ใช้ค่าวัดทุกรายการ
            </Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setKeep(new Set(groups.map((g) => g.key)))}>
              คงตามสัญญาทุกรายการ
            </Button>
            {canSeeMoney ? (
              <span className="text-muted-foreground">
                ถ้าใช้ค่าวัดทั้งหมด: เพิ่ม {sign(all.add)}{formatTHB(all.add)} · ลด {formatTHB(all.cut)} · สุทธิ {sign(all.net)}{formatTHB(all.net)}
              </span>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-1 pr-2">ใช้ค่าวัด</th>
                  <th className="py-1 pr-2">ITEM</th>
                  <th className="py-1 pr-2">รายการ</th>
                  <th className="py-1 pr-2 text-right">ตามสัญญา</th>
                  <th className="py-1 pr-2 text-right">วัดจริง</th>
                  {canSeeMoney ? <th className="py-1 text-right">เพิ่ม / ลด (บาท)</th> : null}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <GroupRows
                    key={g.key}
                    g={g}
                    on={!keep.has(g.key)}
                    disabled={!canEdit}
                    onToggle={() => toggle(g.key)}
                    canSeeMoney={canSeeMoney}
                    skuCode={skuCode}
                    skuUnit={skuUnit}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function GroupRows({
  g,
  on,
  disabled,
  onToggle,
  canSeeMoney,
  skuCode,
  skuUnit,
}: {
  g: Group;
  on: boolean;
  disabled: boolean;
  onToggle: () => void;
  canSeeMoney: boolean;
  skuCode: (id: string) => string;
  skuUnit: (id: string) => string;
}) {
  const sign = (n: number) => (n > 0 ? "+" : "");
  const money = (n: number) => (n ? sign(n) + formatTHB(n) : "—");
  const tone = (n: number) => (n > 0 ? "text-success" : n < 0 ? "text-destructive" : "text-muted-foreground");
  const span = canSeeMoney ? 3 : 2;
  return (
    <>
      <tr className={"border-t border-border align-top font-medium" + (on ? "" : " opacity-50")}>
        <td className="py-1 pr-2">
          <Checkbox checked={on} disabled={disabled} onCheckedChange={onToggle} aria-label={`ใช้ค่าวัด ${g.title}`} />
        </td>
        <td className="py-1 pr-2">{g.itemNo}</td>
        <td className="py-1 pr-2" colSpan={span}>
          {g.title}
          {g.note ? <div className="font-normal text-muted-foreground">{g.note}</div> : null}
          {g.block?.noPrice && canSeeMoney ? (
            <div className="font-normal text-warning">ยังไม่ได้ตั้งราคาขาย SKU — ของเปลี่ยน แต่ยอดเงินยังคงตามสัญญา ตรวจก่อนวางบิล</div>
          ) : null}
          {!g.counted ? <div className="font-normal text-muted-foreground">(ไม่นับในยอด)</div> : null}
          {!g.items.length && !g.materials.length ? <div className="font-normal text-muted-foreground">ตรงกับสัญญา</div> : null}
        </td>
        {canSeeMoney ? <td className={"py-1 text-right tabular-nums " + tone(g.amountDiff)}>{money(g.amountDiff)}</td> : null}
      </tr>
      {g.items.map((x, i) => (
        <tr key={i} className={"align-top" + (on ? "" : " opacity-50")}>
          <td />
          <td />
          <td className="py-0.5 pr-2 text-muted-foreground">{x.text}</td>
          <td className="py-0.5 pr-2 text-right tabular-nums">{x.oldQty != null ? `${formatQty(x.oldQty)} ${x.unit ?? ""}` : "ไม่มี"}</td>
          <td className="py-0.5 pr-2 text-right font-semibold tabular-nums">{x.newQty != null ? `${formatQty(x.newQty)} ${x.unit ?? ""}` : "ตัดออก"}</td>
          {canSeeMoney ? <td className={"py-0.5 text-right tabular-nums " + tone(x.newAmount - x.oldAmount)}>{money(Math.round((x.newAmount - x.oldAmount) * 100) / 100)}</td> : null}
        </tr>
      ))}
      {g.materials.map((x) => (
        <tr key={x.skuId} className={"align-top text-muted-foreground" + (on ? "" : " opacity-50")}>
          <td />
          <td />
          <td className="py-0.5 pr-2 pl-3">ของ: {skuCode(x.skuId)}</td>
          <td className="py-0.5 pr-2 text-right tabular-nums">{formatQty(x.oldQty)} {skuUnit(x.skuId)}</td>
          <td className="py-0.5 pr-2 text-right tabular-nums">{formatQty(x.newQty)} {skuUnit(x.skuId)}</td>
          {canSeeMoney ? <td /> : null}
        </tr>
      ))}
    </>
  );
}
