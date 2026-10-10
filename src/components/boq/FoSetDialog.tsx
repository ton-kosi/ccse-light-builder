import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GridLine } from "@/components/boq/BoqGrid";
import {
  buildFoRecipes,
  buildFoText,
  foSkuGroups,
  illuminatorDisplayName,
  matchByWatt,
  parseFo,
  priceFo,
  totalPoints,
  type FoConfig,
} from "@/lib/fo";
import { formatQty, formatTHB, toNumber } from "@/lib/format";
import { saveSkuPrice, SKU_PRICES_KEY, useSkuPrices } from "@/lib/skuPrices";

export type Sku = { id: string; code: string; name: string; unit: string };
export type FoTarget = { mode: "new"; option: string | null } | { mode: "edit"; line: GridLine };

const LABELS = ["S", "M", "L", "XL", "XXL", "XXXL"];
const sel = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm";

export function FoSetDialog({
  target,
  quotationId,
  canSeeCost,
  createLine,
  onClose,
}: {
  target: FoTarget;
  quotationId: string;
  canSeeCost: boolean;
  /** Inserts a new BOQ line at the end and returns its id. */
  createLine: (fields: Partial<GridLine>) => Promise<string>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const editing = target.mode === "edit" ? target.line : null;

  const { data: skus } = useQuery({
    queryKey: ["skus", "options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("skus")
        .select("id, code, name, unit")
        .order("code");
      if (error) throw error;
      return data as Sku[];
    },
  });
  const { data: costs } = useQuery({
    queryKey: ["sku_costs"],
    enabled: canSeeCost,
    queryFn: async () => {
      const { data, error } = await supabase.from("sku_costs").select("sku_id, unit_cost");
      if (error) throw error;
      return new Map(data.map((c) => [c.sku_id, Number(c.unit_cost)]));
    },
  });
  const { data: saved, isLoading: loadingSaved } = useQuery({
    queryKey: ["line_recipes", editing?.id ?? "new"],
    enabled: !!editing,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("line_recipes")
        .select("sku_id, qty, note")
        .eq("quote_line_id", editing!.id);
      if (error) throw error;
      return data;
    },
  });

  const groups = useMemo(() => foSkuGroups(skus ?? []), [skus]);
  const byId = useMemo(() => new Map((skus ?? []).map((s) => [s.id, s])), [skus]);

  const [c, setC] = useState<FoConfig | null>(null);
  const [option, setOption] = useState(
    editing ? (editing.option_name ?? "") : target.mode === "new" ? (target.option ?? "") : "",
  );
  const [disc, setDisc] = useState(
    editing?.discount_percent != null ? String(Number(editing.discount_percent)) : "0",
  );

  // Selling price of each part = admin-set selling price of its SKU (SKU page).
  const { data: partPrices } = useSkuPrices();

  // Initialise once data is in: from the saved set, or from smart defaults.
  useEffect(() => {
    if (c || !skus) return;
    if (editing) {
      if (loadingSaved) return;
      const parsed = parseFo(saved ?? [], editing.customer_text);
      if (parsed) {
        setC(parsed);
        return;
      }
    }
    const ill = groups.illuminators[0];
    setC({
      title: editing?.customer_text?.split("\n")[0]?.trim() || "FIBER OPTICS STARRY SET",
      illuminatorSkuId: ill?.id ?? "",
      illuminatorName: illuminatorDisplayName(ill),
      locatedNote: "",
      machines: 1,
      lengthPerPoint: 0,
      sizes: groups.cables
        .slice(0, 3)
        .map((s, i) => ({ label: LABELS[i] ?? `#${i + 1}`, skuId: s.id, points: 0 })),
      endSkuId: groups.ends[0]?.id ?? null,
      harnessSkuId: matchByWatt(groups.harnesses, ill),
      portSkuId: matchByWatt(groups.ports, ill),
      wpSkuId: matchByWatt(groups.wps, ill),
      showWp: false,
    });
  }, [c, skus, editing, saved, loadingSaved, groups]);


  const rows = c ? buildFoRecipes(c) : [];
  const text = c ? buildFoText(c) : "";
  const cost = rows.reduce((s, r) => s + r.qty * (costs?.get(r.sku_id) ?? 0), 0);
  const missingCost = canSeeCost && costs ? rows.filter((r) => !costs.has(r.sku_id)) : [];
  const pricing = priceFo(rows, partPrices ?? new Map());
  const discNum = toNumber(disc) ?? 0;
  const net = Math.round(pricing.list * (1 - discNum / 100) * 100) / 100;
  const gp = canSeeCost && net > 0 ? ((net - cost) / net) * 100 : null;
  const discTooHigh = discNum > pricing.maxDiscount + 1e-9;

  /** Admin: set the selling price of one part (creates a one-SKU sales component the first time). */
  const setPartPrice = useMutation({
    mutationFn: async (p: { skuId: string; unitPrice?: number; maxDiscount?: number }) => {
      const sku = byId.get(p.skuId);
      if (!sku) throw new Error("ไม่พบ SKU");
      const cur = partPrices?.get(p.skuId);
      await saveSkuPrice(
        sku,
        p.unitPrice ?? cur?.unitPrice ?? 0,
        p.maxDiscount ?? cur?.maxDiscount ?? 0,
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SKU_PRICES_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const set = (patch: Partial<FoConfig>) => setC((old) => (old ? { ...old, ...patch } : old));
  const setIlluminator = (id: string) => {
    if (!c) return;
    const ill = byId.get(id);
    const prevAuto = illuminatorDisplayName(byId.get(c.illuminatorSkuId));
    set({
      illuminatorSkuId: id,
      illuminatorName:
        !c.illuminatorName || c.illuminatorName === prevAuto
          ? illuminatorDisplayName(ill)
          : c.illuminatorName,
      harnessSkuId: c.harnessSkuId ? matchByWatt(groups.harnesses, ill) : null,
      portSkuId: c.portSkuId ? matchByWatt(groups.ports, ill) : null,
      wpSkuId: c.wpSkuId ? matchByWatt(groups.wps, ill) : null,
    });
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!c) throw new Error("ยังโหลดข้อมูลไม่เสร็จ");
      if (!c.illuminatorSkuId) throw new Error("กรุณาเลือกเครื่องกำเนิดแสง");
      if (!(c.machines > 0)) throw new Error("จำนวนเครื่องต้องมากกว่า 0");
      if (totalPoints(c) <= 0) throw new Error("กรุณาใส่จำนวนจุดอย่างน้อย 1 ขนาด");
      if (c.sizes.some((z) => z.points > 0 && !z.skuId))
        throw new Error("กรุณาเลือกสายของทุกขนาดที่มีจุด");
      if (!(c.lengthPerPoint > 0)) throw new Error("กรุณากรอกความยาวสายต่อจุด");
      if (!partPrices) throw new Error("กำลังโหลดราคาขาย");
      if (pricing.missing.length)
        throw new Error(
          `ยังไม่มีราคาขายของ ${pricing.missing.map((id) => byId.get(id)?.code).join(", ")} — ให้ admin ตั้งราคาก่อน`,
        );
      if (discTooHigh) throw new Error(`ส่วนลดสูงสุดของชุดนี้คือ ${pricing.maxDiscount}%`);
      const fields = {
        kind: "priced",
        qty: 1,
        unit: "SET",
        customer_text: text,
        unit_price: pricing.list,
        discount_percent: discNum,
        component_id: null,
        option_name: option.trim() || null,
      };
      let lineId: string;
      if (editing) {
        const { error } = await supabase.from("quote_lines").update(fields).eq("id", editing.id);
        if (error) throw error;
        lineId = editing.id;
      } else {
        lineId = await createLine(fields);
      }
      const del = await supabase
        .from("line_recipes")
        .delete()
        .eq("quote_line_id", lineId)
        .like("note", "FO %");
      if (del.error) throw del.error;
      const ins = await supabase
        .from("line_recipes")
        .insert(rows.map((r) => ({ ...r, quote_line_id: lineId })));
      if (ins.error) throw ins.error;
    },
    onSuccess: () => {
      toast.success(editing ? "อัปเดตชุด FO แล้ว" : "เพิ่มชุด FO แล้ว");
      qc.invalidateQueries({ queryKey: ["quote_lines", quotationId] });
      qc.invalidateQueries({ queryKey: ["line_recipes"] });
      qc.invalidateQueries({ queryKey: ["boq_costs"] });
      qc.invalidateQueries({ queryKey: ["set_lines"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Warn when the saved description was edited by hand (it will be regenerated on save).
  const savedAuto = useMemo(() => {
    const p = editing ? parseFo(saved ?? [], editing.customer_text) : null;
    return p ? buildFoText(p) : null;
  }, [editing, saved]);
  const customised = !!savedAuto && (editing?.customer_text ?? "") !== savedAuto;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "แก้ชุด Fiber Optic" : "เพิ่มชุด Fiber Optic"}</DialogTitle>
        </DialogHeader>
        {!c ? (
          <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
            <div className="space-y-5">
              <Block title="หัวข้อในใบเสนอราคา">
                <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
                  <Input
                    value={c.title}
                    onChange={(e) => set({ title: e.target.value })}
                    placeholder="เช่น OPTION 1 :"
                  />
                  <Input
                    value={option}
                    onChange={(e) => setOption(e.target.value)}
                    placeholder="Option (ถ้ามี)"
                  />
                </div>
              </Block>

              <Block title="1. เครื่องกำเนิดแสง (Illuminator)">
                <div className="grid gap-2 sm:grid-cols-[1fr_110px]">
                  <SkuSelect
                    value={c.illuminatorSkuId}
                    onChange={setIlluminator}
                    preferred={groups.illuminators}
                    all={skus ?? []}
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <Input
                      className="w-16"
                      value={String(c.machines)}
                      onChange={(e) =>
                        set({ machines: Math.max(0, Math.round(toNumber(e.target.value) ?? 0)) })
                      }
                    />
                    เครื่อง
                  </label>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <Field label="ชื่อที่พิมพ์ในใบ">
                    <Input
                      value={c.illuminatorName}
                      onChange={(e) => set({ illuminatorName: e.target.value })}
                    />
                  </Field>
                  <Field label="ข้อความต่อท้าย (ถ้ามี)">
                    <Input
                      value={c.locatedNote}
                      placeholder="(LOCATED AS ATTACHED)"
                      onChange={(e) => set({ locatedNote: e.target.value })}
                    />
                  </Field>
                </div>
              </Block>

              <Block title="2. สาย Fiber แต่ละขนาด">
                <label className="mb-2 flex items-center gap-2 text-sm">
                  ความยาวสายต่อจุด (ภายใน)
                  <Input
                    className="w-20"
                    inputMode="decimal"
                    defaultValue={c.lengthPerPoint ? String(c.lengthPerPoint) : ""}
                    placeholder="เช่น 4"
                    onChange={(e) => set({ lengthPerPoint: toNumber(e.target.value) ?? 0 })}
                  />
                  เมตร · ใช้เท่ากันทุกขนาดในชุดนี้
                </label>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="w-20 pb-1 font-medium">ขนาด (ลูกค้าเห็น)</th>
                      <th className="pb-1 font-medium">สายจริงที่เบิก</th>
                      <th className="w-24 pb-1 font-medium">จำนวนจุด</th>
                      <th className="w-24 pb-1 text-right font-medium">เมตร (ภายใน)</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {c.sizes.map((z, i) => {
                      const upd = (p: Partial<typeof z>) =>
                        set({ sizes: c.sizes.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                      return (
                        <tr key={i} className="align-middle">
                          <td className="py-1 pr-2">
                            <Input
                              value={z.label}
                              onChange={(e) => upd({ label: e.target.value.toUpperCase() })}
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <SkuSelect
                              value={z.skuId}
                              onChange={(id) => upd({ skuId: id })}
                              preferred={groups.cables}
                              all={skus ?? []}
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <Input
                              inputMode="numeric"
                              value={z.points ? String(z.points) : ""}
                              placeholder="0"
                              onChange={(e) =>
                                upd({
                                  points: Math.max(0, Math.round(toNumber(e.target.value) ?? 0)),
                                })
                              }
                            />
                          </td>
                          <td className="py-1 text-right tabular-nums text-muted-foreground">
                            {z.points && c.lengthPerPoint
                              ? formatQty(z.points * c.lengthPerPoint)
                              : "—"}
                          </td>
                          <td className="py-1 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2"
                              onClick={() => set({ sizes: c.sizes.filter((_, j) => j !== i) })}
                            >
                              ลบ
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="mt-1 flex items-center justify-between text-sm">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      set({
                        sizes: [
                          ...c.sizes,
                          {
                            label: LABELS[c.sizes.length] ?? "",
                            skuId: groups.cables[c.sizes.length]?.id ?? "",
                            points: 0,
                          },
                        ],
                      })
                    }
                  >
                    + เพิ่มขนาด
                  </Button>
                  <span>
                    รวม <b className="tabular-nums">{formatQty(totalPoints(c))}</b> จุด
                  </span>
                </div>
              </Block>

              <Block title="3. อุปกรณ์ (คำนวณอัตโนมัติ)">
                <div className="grid gap-2 text-sm">
                  <AccessoryRow
                    label="End finishing"
                    qty={`${formatQty(totalPoints(c))} = จุดทั้งหมด`}
                    value={c.endSkuId}
                    onChange={(id) => set({ endSkuId: id })}
                    preferred={groups.ends}
                    all={skus ?? []}
                  />
                  <AccessoryRow
                    label="FO harness"
                    qty={`${c.machines} = จำนวนเครื่อง`}
                    value={c.harnessSkuId}
                    onChange={(id) => set({ harnessSkuId: id })}
                    preferred={groups.harnesses}
                    all={skus ?? []}
                  />
                  <AccessoryRow
                    label="Optical port"
                    qty={`${c.machines} = จำนวนเครื่อง`}
                    value={c.portSkuId}
                    onChange={(id) => set({ portSkuId: id })}
                    preferred={groups.ports}
                    all={skus ?? []}
                  />
                  <AccessoryRow
                    label="WP box"
                    qty={`${c.machines} = จำนวนเครื่อง`}
                    value={c.wpSkuId}
                    onChange={(id) => set({ wpSkuId: id })}
                    preferred={groups.wps}
                    all={skus ?? []}
                    noneLabel="— ไม่ใส่ WP box —"
                    extra={
                      c.wpSkuId ? (
                        <label className="flex items-center gap-1.5 text-xs">
                          <Checkbox
                            checked={c.showWp}
                            onCheckedChange={(v) => set({ showWp: v === true })}
                          />
                          แสดงในใบเสนอราคา
                        </label>
                      ) : null
                    }
                  />
                </div>
              </Block>

            </div>

            <div className="space-y-4">
              <Block title="ลูกค้าจะเห็น">
                <pre className="whitespace-pre-wrap rounded bg-secondary p-2 font-sans text-xs leading-relaxed">
                  {text}
                </pre>
                <p className="mt-1 text-xs text-muted-foreground">
                  1 SET · ราคาเดียว · ไม่แสดงความยาวสายและราคาย่อย
                </p>
                {customised ? (
                  <p className="mt-1 text-xs text-warning">
                    ข้อความเดิมที่แก้มือไว้จะถูกแทนที่เมื่อบันทึก
                  </p>
                ) : null}
              </Block>

              {canSeeCost ? (
                <Block title="ราคาขายแต่ละชิ้น (admin เท่านั้น)">
                  <table className="w-full text-xs">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="pb-1 font-medium">ชิ้น</th>
                        <th className="pb-1 text-right font-medium">ราคา/หน่วย</th>
                        <th className="pb-1 text-right font-medium">ลด≤%</th>
                        <th className="pb-1 text-right font-medium">รวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pricing.parts.map((pt, i) => {
                        const s = byId.get(pt.sku_id);
                        const u = costs?.get(pt.sku_id);
                        return (
                          <tr key={i} className="border-t border-border align-middle">
                            <td className="py-1 pr-1">
                              <div>{s?.code}</div>
                              <div className="text-muted-foreground">
                                {formatQty(pt.qty)} {s?.unit}
                                {u !== undefined ? ` · ทุน ${formatTHB(u)}` : " · ไม่มีทุน"}
                              </div>
                            </td>
                            <td className="py-1 pr-1">
                              <Input
                                key={`p${pt.sku_id}${pt.unitPrice}`}
                                className={
                                  "h-7 w-20 text-right text-xs " +
                                  (pt.unitPrice === null ? "border-destructive" : "")
                                }
                                defaultValue={pt.unitPrice === null ? "" : String(pt.unitPrice)}
                                placeholder="ตั้งราคา"
                                onBlur={(e) => {
                                  const v = toNumber(e.target.value);
                                  if (v !== null && v !== pt.unitPrice)
                                    setPartPrice.mutate({ skuId: pt.sku_id, unitPrice: v });
                                }}
                              />
                            </td>
                            <td className="py-1 pr-1">
                              <Input
                                key={`d${pt.sku_id}${pt.maxDiscount}`}
                                className="h-7 w-12 text-right text-xs"
                                defaultValue={String(pt.maxDiscount)}
                                disabled={pt.unitPrice === null}
                                onBlur={(e) => {
                                  const v = toNumber(e.target.value);
                                  if (v !== null && v !== pt.maxDiscount)
                                    setPartPrice.mutate({
                                      skuId: pt.sku_id,
                                      maxDiscount: Math.min(100, Math.max(0, v)),
                                    });
                                }}
                              />
                            </td>
                            <td className="py-1 text-right tabular-nums">
                              {pt.amount === null ? "?" : formatTHB(pt.amount)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="mt-1 text-xs text-muted-foreground">
                    ตั้งครั้งเดียว ใช้กับทุกชุด FO · ราคาต่อเครื่อง / ต่อเมตร / ต่อจุด ตามหน่วยของ
                    SKU
                  </p>
                  <div className="mt-2 space-y-0.5 border-t border-border pt-2 text-xs">
                    <div className="flex justify-between">
                      <span>ต้นทุนรวม</span>
                      <span className="tabular-nums">{formatTHB(cost)}</span>
                    </div>
                    {gp !== null ? (
                      <div
                        className={
                          "flex justify-between font-medium " + (gp < 20 ? "text-destructive" : "")
                        }
                      >
                        <span>กำไรขั้นต้น (หลังส่วนลด)</span>
                        <span className="tabular-nums">
                          {formatTHB(net - cost)} ({gp.toFixed(1)}%)
                        </span>
                      </div>
                    ) : null}
                    {missingCost.length ? (
                      <div className="text-warning">
                        ยังไม่มีต้นทุน:{" "}
                        {missingCost.map((r) => byId.get(r.sku_id)?.code).join(", ")}
                      </div>
                    ) : null}
                  </div>
                </Block>
              ) : null}

              <Block title="ราคาขายต่อชุด">
                {pricing.missing.length ? (
                  <p className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                    ยังไม่มีราคาขายของบางชิ้น (
                    {pricing.missing.map((id) => byId.get(id)?.code).join(", ")}) —
                    {canSeeCost ? " ตั้งราคาในตารางด้านบน" : " ติดต่อ admin ให้ตั้งราคาก่อน"}
                  </p>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-baseline justify-between">
                      <span className="text-muted-foreground">ราคาเต็ม</span>
                      <span className="text-base font-semibold tabular-nums">
                        {formatTHB(pricing.list)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        ส่วนลด (สูงสุด {pricing.maxDiscount}%)
                      </span>
                      <span className="flex items-center gap-1">
                        <Input
                          className={
                            "h-8 w-16 text-right " + (discTooHigh ? "border-destructive" : "")
                          }
                          inputMode="decimal"
                          value={disc}
                          onChange={(e) => setDisc(e.target.value)}
                        />
                        %
                      </span>
                    </div>
                    {discTooHigh ? (
                      <p className="text-xs text-destructive">
                        ลดได้ไม่เกิน {pricing.maxDiscount}%
                      </p>
                    ) : null}
                    <div className="flex items-baseline justify-between border-t border-border pt-2">
                      <span>ราคาสุทธิต่อชุด</span>
                      <span className="text-base font-semibold tabular-nums">{formatTHB(net)}</span>
                    </div>
                  </div>
                )}
              </Block>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button disabled={!c || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "กำลังบันทึก..." : "บันทึกชุด FO"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-muted-foreground">
      {label}
      <div className="mt-0.5 text-foreground">{children}</div>
    </label>
  );
}

export function SkuSelect({
  value,
  onChange,
  preferred,
  all,
  noneLabel,
}: {
  value: string | null;
  onChange: (id: string) => void;
  preferred: { id: string }[];
  all: Sku[];
  noneLabel?: string;
}) {
  const pref = new Set(preferred.map((p) => p.id));
  const top = all.filter((s) => pref.has(s.id));
  const rest = all.filter((s) => !pref.has(s.id));
  return (
    <select className={sel} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">{noneLabel ?? "— เลือก SKU —"}</option>
      {top.length ? (
        <optgroup label="แนะนำ">
          {top.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </optgroup>
      ) : null}
      <optgroup label="SKU ทั้งหมด">
        {rest.map((s) => (
          <option key={s.id} value={s.id}>
            {s.code} — {s.name}
          </option>
        ))}
      </optgroup>
    </select>
  );
}

function AccessoryRow({
  label,
  qty,
  value,
  onChange,
  preferred,
  all,
  noneLabel = "— ไม่ใช้ —",
  extra,
}: {
  label: string;
  qty: string;
  value: string | null;
  onChange: (id: string | null) => void;
  preferred: { id: string }[];
  all: Sku[];
  noneLabel?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[110px_1fr_150px]">
      <span className="font-medium">{label}</span>
      <SkuSelect
        value={value}
        onChange={(id) => onChange(id || null)}
        preferred={preferred}
        all={all}
        noneLabel={noneLabel}
      />
      <div className="text-xs text-muted-foreground">
        {value ? <>จำนวน {qty}</> : "ไม่ใส่"}
        {extra ? <div className="mt-0.5">{extra}</div> : null}
      </div>
    </div>
  );
}
