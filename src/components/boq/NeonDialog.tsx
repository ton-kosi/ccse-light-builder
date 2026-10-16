import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GridLine } from "@/components/boq/BoqGrid";
import { Block, Field, SkuSelect, type Sku } from "@/components/boq/FoSetDialog";
import { Choice, Row } from "@/components/boq/LinearDialog";
import { inCategory } from "@/lib/skuCategory";
import { DIM_TYPES, linearSkuGroups, parseLengths, pickPsu, type DimType } from "@/lib/linear";
import {
  buildNeon,
  configItems,
  defaultNeonName,
  familyPrice,
  runLength,
  type NeonConfig,
} from "@/lib/neon";
import { itemsFromLines, loadNeonFamilies, loadQuotationRuns, NEON_SKU_COLUMNS, NEON_SKU_KEY, rebalanceNeon } from "@/lib/neonSync";
import { ensureRollComponent, useSkuPrices } from "@/lib/skuPrices";
import { formatQty, formatTHB, toNumber } from "@/lib/format";

export type NeonTarget =
  | { mode: "new"; option: string | null }
  | { mode: "edit"; config: NeonConfig; option: string | null; zone: string | null; discount: number };

export function NeonDialog({
  target,
  quotationId,
  canSeeCost,
  replaceRows,
  onClose,
}: {
  target: NeonTarget;
  quotationId: string;
  canSeeCost: boolean;
  replaceRows: (oldIds: string[], rows: Partial<GridLine>[]) => Promise<void>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const editing = target.mode === "edit" ? target : null;
  const { data: skus } = useQuery({
    queryKey: NEON_SKU_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from("skus").select(NEON_SKU_COLUMNS).order("code");
      if (error) throw error;
      return data as (Sku & { is_roll: boolean; roll_family: string | null })[];
    },
  });
  const { data: families, refetch: refetchFamilies } = useQuery({
    queryKey: ["neon_families"],
    queryFn: loadNeonFamilies,
  });
  const { data: runs } = useQuery({
    queryKey: ["neon_runs", quotationId],
    queryFn: () => loadQuotationRuns(quotationId),
  });
  const { data: prices } = useSkuPrices();
  const lin = useMemo(() => linearSkuGroups(skus ?? []), [skus]);
  const accessories = useMemo(() => (skus ? inCategory(skus, "LED accessory") : []), [skus]);

  const [c, setC] = useState<NeonConfig | null>(editing?.config ?? null);
  const [option, setOption] = useState(target.option ?? "");
  const [zone, setZone] = useState(editing?.zone ?? "");
  const [disc, setDisc] = useState(editing ? String(editing.discount) : "0");
  const [lenText, setLenText] = useState<string[]>(
    editing ? editing.config.runs.map((r) => r.lengths.map((x) => x.toFixed(2)).join("+")) : [""],
  );

  useEffect(() => {
    if (c || !families || !skus) return;
    const f = families[0];
    setC({
      v: 1,
      blockId: crypto.randomUUID().slice(0, 8),
      typeCode: "",
      family: f?.family ?? "",
      name: f ? defaultNeonName(f) : "",
      wattPerM: f?.wattPerM ?? 0,
      dim: "NON-DIM",
      psuOptions: lin.psuFor("NON-DIM"),
      loadFactor: 0.8,
      endCapSkuId: null,
      mountSkuId: null,
      mountPerM: 0,
      runs: [{ ckt: "", lengths: [] }],
      rowIds: [],
    });
  }, [c, families, skus, lin]);

  // PSU choices follow the dimming type
  useEffect(() => {
    if (!c || !skus) return;
    const opts = lin.psuFor(c.dim);
    if (JSON.stringify(opts) !== JSON.stringify(c.psuOptions)) setC({ ...c, psuOptions: opts });
  }, [c, skus, lin]);

  const set = (p: Partial<NeonConfig>) => setC((o) => (o ? { ...o, ...p } : o));
  const family = families?.find((f) => f.family === c?.family) ?? null;

  // other run lines of the same family in this quotation (not this block's own rows)
  const others = useMemo(() => {
    if (!family?.componentId || !runs || !c) return [];
    return itemsFromLines(family.componentId, runs.lines, runs.recipes, new Set(editing?.config.rowIds ?? []));
  }, [family, runs, c, editing]);
  const fp = useMemo(
    () => (c && family && prices ? familyPrice(family, [...others, ...configItems(c, family)], prices) : null),
    [c, family, prices, others],
  );
  const built = useMemo(
    () => (c && family && prices && fp ? buildNeon(c, family, fp.perM, prices, () => crypto.randomUUID()) : null),
    [c, family, prices, fp],
  );
  // discount limit: Jedi flex part (rolls + accessories) and PSUs, by value
  const maxDiscount = useMemo(() => {
    if (!built || !fp || !(built.list > 0)) return 0;
    const meters = c ? c.runs.reduce((s, r) => s + runLength(r), 0) : 0;
    const neonPart = meters * fp.perM;
    const allowed = (neonPart * fp.maxDiscount) / 100 + built.psuAllowed;
    return Math.floor((allowed / built.list) * 1000) / 10;
  }, [built, fp, c]);
  const discNum = toNumber(disc) ?? 0;
  const tooHigh = discNum > maxDiscount + 1e-9;
  const net = built ? Math.round(built.list * (1 - discNum / 100) * 100) / 100 : 0;
  const missing = [...new Set([...(fp?.missing ?? []), ...(built?.missing ?? [])])];
  const byId = useMemo(() => new Map((skus ?? []).map((s) => [s.id, s])), [skus]);

  const save = useMutation({
    mutationFn: async () => {
      if (!c || !family || !built) throw new Error("เลือกรุ่น Jedi flex ก่อน");
      if (!c.runs.some((r) => runLength(r) > 0)) throw new Error("ใส่ความยาวอย่างน้อย 1 วงจร");
      if (missing.length)
        throw new Error(`ยังไม่มีราคาขายของ ${missing.map((id) => byId.get(id)?.code ?? id).join(", ")}`);
      if (tooHigh) throw new Error(`ส่วนลดสูงสุดของชุดนี้คือ ${maxDiscount}%`);
      let componentId = family.componentId;
      if (!componentId) {
        const roll = family.rolls[family.rolls.length - 1]!;
        try {
          componentId = await ensureRollComponent(family.family, { id: roll.skuId, length: roll.length });
        } catch {
          throw new Error(
            `ตระกูลม้วน ${family.family} ยังไม่พร้อม — ให้ admin หรือคลัง เปิดแก้ไข SKU ม้วนของตระกูลนี้แล้วกดบันทึก 1 ครั้ง`,
          );
        }
        await refetchFamilies();
      }
      const ready = buildNeon(c, { ...family, componentId }, fp!.perM, prices!, () => crypto.randomUUID());
      if (!ready.hasCarrier)
        throw new Error("ต้องมีหม้อแปลงหรืออุปกรณ์อย่างน้อย 1 รายการ (ใช้เก็บข้อมูลชุด)");
      const rows = ready.rows.map((r, i) => ({
        id: r.id,
        kind: r.kind,
        customer_text: r.customer_text,
        qty: r.qty,
        unit: r.unit,
        unit_price: r.unit_price,
        discount_percent: r.kind === "priced" ? discNum : 0,
        option_name: option.trim() || null,
        zone: i === 0 ? zone.trim() || null : null,
        component_id: r.component_id,
        circuit_note: null,
        cut_lengths: r.cut_lengths,
      }));
      await replaceRows(editing?.config.rowIds ?? [], rows);
      const recipes = ready.rows.flatMap((r) => r.recipes.map((x) => ({ ...x, quote_line_id: r.id })));
      if (recipes.length) {
        const { error } = await supabase.from("line_recipes").insert(recipes);
        if (error) throw error;
      }
      // other lines of the same model now share the new roll plan → same price per metre
      return rebalanceNeon(quotationId);
    },
    onSuccess: (changed) => {
      toast.success(
        `${editing ? "อัปเดต" : "เพิ่ม"}ชุด Jedi flex แล้ว${changed ? ` · ปรับราคาต่อเมตรรุ่นเดียวกันในใบนี้ ${changed} บรรทัด` : ""}`,
      );
      ["line_recipes", "boq_costs", "set_lines", "neon_runs"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: ["quote_lines", quotationId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "แก้ชุด Jedi flex" : "เพิ่มชุด Jedi flex (Neon flex)"}</DialogTitle>
        </DialogHeader>
        {!c || !families ? (
          <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
        ) : !families.length ? (
          <p className="text-sm text-destructive">
            ยังไม่มีม้วน Neon flex — ที่หน้า SKU ตั้งหมวด Neon flex, ติ๊ก "เป็นสินค้าม้วน", ใส่ตระกูลม้วน (รุ่น+สี) และความยาวม้วน 5/10 ม.
          </p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
            <div className="space-y-5">
              <Block title="1. รุ่น (ตระกูลม้วน)">
                <div className="grid gap-2 text-sm">
                  <Row label="รุ่น / สี">
                    <div className="flex flex-wrap gap-1.5">
                      {families.map((f) => (
                        <Choice
                          key={f.family}
                          on={c.family === f.family}
                          onClick={() => set({ family: f.family, name: defaultNeonName(f), wattPerM: f.wattPerM ?? c.wattPerM })}
                        >
                          {f.family}
                        </Choice>
                      ))}
                    </div>
                    {family ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        ม้วน {family.rolls.map((r) => `${r.length} ม.`).join(" / ")} · ตัดทุก {family.stepCm} ซม. · ชิ้นยาวสุด{" "}
                        {family.maxPieceM} ม.
                      </p>
                    ) : null}
                  </Row>
                  <div className="grid gap-2 sm:grid-cols-[100px_1fr_90px]">
                    <Field label="รหัสแบบ">
                      <Input value={c.typeCode} placeholder="NF1" onChange={(e) => set({ typeCode: e.target.value.toUpperCase() })} />
                    </Field>
                    <Field label="ชื่อที่ลูกค้าเห็น">
                      <Input value={c.name} onChange={(e) => set({ name: e.target.value })} />
                    </Field>
                    <Field label="วัตต์/เมตร">
                      <Input
                        inputMode="decimal"
                        value={c.wattPerM ? String(c.wattPerM) : ""}
                        onChange={(e) => set({ wattPerM: toNumber(e.target.value) ?? 0 })}
                      />
                    </Field>
                  </div>
                </div>
              </Block>

              <Block title="2. ระบบดิม และอุปกรณ์">
                <div className="grid gap-2 text-sm">
                  <Row label="ระบบดิม">
                    <div className="flex flex-wrap gap-1.5">
                      {DIM_TYPES.map((d) => (
                        <Choice key={d} on={c.dim === d} onClick={() => set({ dim: d as DimType })}>
                          {d}
                        </Choice>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {c.psuOptions.length
                        ? `หม้อแปลงต่อวงจร โหลด ≤ 80% จาก ${c.psuOptions.map((o) => `${o.watt}W`).join(", ")}`
                        : `ไม่มีหม้อแปลง ${c.dim} ในหมวด Power supply`}
                    </p>
                  </Row>
                  <Row label="ชุดปิดปลาย (ต่อชิ้น)">
                    <SkuSelect
                      value={c.endCapSkuId}
                      preferred={accessories}
                      category="LED accessory"
                      all={skus ?? []}
                      noneLabel="— ไม่ใส่ —"
                      onChange={(id) => set({ endCapSkuId: id || null })}
                    />
                  </Row>
                  <Row label="ขายึด / ราง (ต่อเมตร)">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <SkuSelect
                          value={c.mountSkuId}
                          preferred={accessories}
                          category="LED accessory"
                          all={skus ?? []}
                          noneLabel="— ไม่ใส่ —"
                          onChange={(id) => set({ mountSkuId: id || null, mountPerM: id ? c.mountPerM || 1 : 0 })}
                        />
                      </div>
                      {c.mountSkuId ? (
                        <Input
                          className="w-20"
                          inputMode="decimal"
                          title="จำนวนต่อเมตร"
                          value={String(c.mountPerM)}
                          onChange={(e) => set({ mountPerM: toNumber(e.target.value) ?? 0 })}
                        />
                      ) : null}
                    </div>
                  </Row>
                  <p className="text-xs text-muted-foreground">
                    ค่าม้วน + อุปกรณ์ เฉลี่ยเป็นราคาต่อเมตรเดียวกันทุกบรรทัดของรุ่นนี้ในใบ · หม้อแปลงแยกบรรทัด
                  </p>
                </div>
              </Block>

              <Block title="3. วงจรและความยาว (แต่ละท่อนตัดจากม้วนเดียว ต่อเศษไม่ได้)">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="w-28 pb-1 font-medium">CKT. NO.</th>
                      <th className="pb-1 font-medium">ความยาวแต่ละท่อน (ม.) เช่น 1.50+1.40</th>
                      <th className="w-16 pb-1 text-right font-medium">รวม ม.</th>
                      <th className="w-16 pb-1 text-right font-medium">วัตต์</th>
                      <th className="w-24 pb-1 text-right font-medium">หม้อแปลง</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {c.runs.map((r, i) => {
                      const L = runLength(r);
                      const psu = pickPsu(L * c.wattPerM, c.psuOptions, c.loadFactor);
                      return (
                        <tr key={i}>
                          <td className="py-1 pr-2">
                            <Input
                              value={r.ckt}
                              placeholder="ไม่แสดง"
                              onChange={(e) =>
                                set({ runs: c.runs.map((x, j) => (j === i ? { ...x, ckt: e.target.value.toUpperCase() } : x)) })
                              }
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <Input
                              value={lenText[i] ?? ""}
                              placeholder="1.50+1.40"
                              onChange={(e) => {
                                const t = e.target.value;
                                setLenText((x) => x.map((v, j) => (j === i ? t : v)));
                                set({ runs: c.runs.map((x, j) => (j === i ? { ...x, lengths: parseLengths(t) } : x)) });
                              }}
                            />
                          </td>
                          <td className="py-1 text-right tabular-nums">{L ? formatQty(L) : "—"}</td>
                          <td className="py-1 text-right tabular-nums">{L ? formatQty(L * c.wattPerM) : "—"}</td>
                          <td className="py-1 text-right text-xs tabular-nums">{psu ? `${psu.count} × ${psu.watt}W` : "—"}</td>
                          <td className="py-1 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                set({ runs: c.runs.length > 1 ? c.runs.filter((_, j) => j !== i) : [{ ckt: "", lengths: [] }] });
                                setLenText((x) => (x.length > 1 ? x.filter((_, j) => j !== i) : [""]));
                              }}
                            >
                              ลบ
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    set({ runs: [...c.runs, { ckt: "", lengths: [] }] });
                    setLenText((x) => [...x, ""]);
                  }}
                >
                  + เพิ่มวงจร
                </Button>
              </Block>

              <Block title="4. การตัดม้วน (รวมทุกบรรทัดรุ่นนี้ในใบเสนอราคา)">
                {fp && fp.rolls.length ? (
                  <div className="space-y-1 text-xs">
                    {others.length ? (
                      <p className="text-muted-foreground">รวมกับรุ่นเดียวกันที่มีอยู่ในใบแล้ว {others.length} บรรทัด</p>
                    ) : null}
                    <ul className="space-y-0.5">
                      {fp.rolls.map((r, i) => (
                        <li key={i}>
                          ม้วน {r.length} ม.: {r.pieces.map((p) => p.toFixed(2)).join(" + ")}{" "}
                          <span className={r.left >= 1 ? "text-primary" : "text-muted-foreground"}>
                            (เหลือ {r.left.toFixed(2)} ม.{r.left >= 1 ? " → เก็บเข้าสต๊อกเป็นเศษม้วน" : ""})
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p>
                      ใช้ {fp.rolls.length} ม้วน · ความยาวที่ลูกค้าจ่าย {formatQty(fp.meters)} ม. ·{" "}
                      <b>ราคาต่อเมตร {formatTHB(fp.perM)}</b>
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">ใส่ความยาว</p>
                )}
              </Block>
            </div>

            <div className="space-y-5">
              <Block title="ลูกค้าจะเห็น">
                <div className="max-h-96 overflow-y-auto rounded bg-secondary p-2 text-xs">
                  <div className="mb-1 grid grid-cols-[110px_1fr] gap-2">
                    <Input className="h-7 text-xs" placeholder="Option (ถ้ามี)" value={option} onChange={(e) => setOption(e.target.value)} />
                    <Input className="h-7 text-xs" placeholder="โซน" value={zone} onChange={(e) => setZone(e.target.value.toUpperCase())} />
                  </div>
                  {zone ? <div className="font-bold">{zone}</div> : null}
                  {(built?.rows ?? []).map((r) => (
                    <div key={r.id} className={"flex gap-2 " + (r.kind === "heading" ? "pt-1 font-semibold" : "")}>
                      <span className="flex-1">
                        {r.customer_text}
                        {r.cut_lengths?.length ? (
                          <span className="block text-[11px] text-muted-foreground">
                            - {r.cut_lengths.map((x) => `${x.toFixed(2)}m`).join(" + ")}
                          </span>
                        ) : null}
                      </span>
                      {r.kind === "priced" ? (
                        <span className="whitespace-nowrap tabular-nums">
                          {formatQty(r.qty ?? 0)} {r.unit} @{formatTHB(r.unit_price ?? 0)}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Block>
              <Block title="ราคา">
                {missing.length ? (
                  <p className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                    ยังไม่มีราคาขายของ {missing.map((id) => byId.get(id)?.code ?? id).join(", ")} —{" "}
                    {canSeeCost ? "ตั้งราคาที่หน้าทะเบียน SKU" : "ติดต่อ admin ให้ตั้งราคา"}
                  </p>
                ) : built ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-baseline justify-between">
                      <span className="text-muted-foreground">ราคาเต็มทั้งชุด</span>
                      <span className="text-base font-semibold tabular-nums">{formatTHB(built.list)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">ส่วนลด (สูงสุด {maxDiscount}%)</span>
                      <span className="flex items-center gap-1">
                        <Input
                          className={"h-8 w-16 text-right " + (tooHigh ? "border-destructive" : "")}
                          inputMode="decimal"
                          value={disc}
                          onChange={(e) => setDisc(e.target.value)}
                        />
                        %
                      </span>
                    </div>
                    {tooHigh ? <p className="text-xs text-destructive">ลดได้ไม่เกิน {maxDiscount}%</p> : null}
                    <div className="flex items-baseline justify-between border-t border-border pt-2">
                      <span>ราคาสุทธิ</span>
                      <span className="text-base font-semibold tabular-nums">{formatTHB(net)}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">กำลังโหลดราคา...</p>
                )}
              </Block>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button disabled={!c || !built || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "กำลังบันทึก..." : "บันทึกชุด Jedi flex"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
