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
  totalPoints,
  type FoConfig,
} from "@/lib/fo";
import { formatQty, formatTHB, toNumber } from "@/lib/format";

type Sku = { id: string; code: string; name: string; unit: string };
type Comp = { id: string; code: string; name: string };
export type FoTarget = { mode: "new"; option: string | null } | { mode: "edit"; line: GridLine };

const LABELS = ["S", "M", "L", "XL", "XXL", "XXXL"];
const sel = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm";

export function FoSetDialog({
  target,
  quotationId,
  components,
  canSeeCost,
  createLine,
  onClose,
}: {
  target: FoTarget;
  quotationId: string;
  components: Comp[];
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
  const [price, setPrice] = useState(editing?.unit_price != null ? String(editing.unit_price) : "");
  const [factor, setFactor] = useState("2");
  const [componentId, setComponentId] = useState<string>(editing?.component_id ?? "");

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

  const { data: compRecipeCount } = useQuery({
    queryKey: ["recipes", "count", componentId],
    enabled: !!componentId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("recipes")
        .select("id", { count: "exact", head: true })
        .eq("component_id", componentId);
      if (error) throw error;
      return count ?? 0;
    },
  });

  const rows = c ? buildFoRecipes(c) : [];
  const text = c ? buildFoText(c) : "";
  const cost = rows.reduce((s, r) => s + r.qty * (costs?.get(r.sku_id) ?? 0), 0);
  const missingCost = canSeeCost && costs ? rows.filter((r) => !costs.has(r.sku_id)) : [];
  const priceNum = toNumber(price) ?? 0;
  const gp = priceNum > 0 ? ((priceNum - cost) / priceNum) * 100 : null;

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
      const fields = {
        kind: "priced",
        qty: 1,
        unit: "SET",
        customer_text: text,
        unit_price: priceNum || null,
        component_id: componentId || null,
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
      qc.invalidateQueries({ queryKey: ["fo_lines"] });
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

              <Block title="ผูกกับชิ้นส่วนขาย (ไม่บังคับ)">
                <select
                  className={sel}
                  value={componentId}
                  onChange={(e) => setComponentId(e.target.value)}
                >
                  <option value="">— ไม่ผูก —</option>
                  {components.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.code} — {x.name.split("\n")[0]}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  ผูกเพื่อให้หมายเหตุ/ประกันของชิ้นส่วนนั้นขึ้นท้ายใบอัตโนมัติ
                </p>
                {componentId && (compRecipeCount ?? 0) > 0 ? (
                  <p className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                    ชิ้นส่วนนี้มีสูตรมาตรฐาน {compRecipeCount} รายการ
                    ซึ่งจะถูกนับสต็อกและต้นทุนซ้ำกับชุดนี้ — ให้ลบสูตรของชิ้นส่วนนี้ออกที่หน้า
                    "ชิ้นส่วนขายและสูตร" (ใช้ชิ้นส่วนนี้เป็นแค่ชื่อชุดและที่ผูกหมายเหตุ) หรือเลือก
                    "ไม่ผูก"
                  </p>
                ) : null}
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
                <Block title="ต้นทุน (ภายใน)">
                  <table className="w-full text-xs">
                    <tbody>
                      {rows.map((r, i) => {
                        const s = byId.get(r.sku_id);
                        const u = costs?.get(r.sku_id);
                        return (
                          <tr key={i} className="border-t border-border">
                            <td className="py-1 pr-1">{s?.code}</td>
                            <td className="py-1 pr-1 text-right tabular-nums">
                              {formatQty(r.qty)} {s?.unit}
                            </td>
                            <td className="py-1 text-right tabular-nums">
                              {u === undefined ? "?" : formatTHB(r.qty * u)}
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="border-t-2 border-border font-semibold">
                        <td className="py-1" colSpan={2}>
                          ต้นทุนรวม
                        </td>
                        <td className="py-1 text-right tabular-nums">{formatTHB(cost)}</td>
                      </tr>
                    </tbody>
                  </table>
                  {missingCost.length ? (
                    <p className="mt-1 text-xs text-warning">
                      ยังไม่มีต้นทุน: {missingCost.map((r) => byId.get(r.sku_id)?.code).join(", ")}
                    </p>
                  ) : null}
                </Block>
              ) : null}

              <Block title="ราคาขายต่อชุด">
                <Input
                  className="text-right text-base tabular-nums"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                />
                {canSeeCost ? (
                  <>
                    <div className="mt-2 flex items-center gap-1.5 text-xs">
                      ต้นทุน ×
                      <Input
                        className="h-7 w-14 text-xs"
                        value={factor}
                        onChange={(e) => setFactor(e.target.value)}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        disabled={!cost}
                        onClick={() =>
                          setPrice(String(Math.ceil((cost * (toNumber(factor) ?? 1)) / 100) * 100))
                        }
                      >
                        ใช้ราคานี้
                      </Button>
                    </div>
                    {gp !== null ? (
                      <p className={"mt-2 text-sm " + (gp < 20 ? "text-destructive" : "")}>
                        กำไรขั้นต้น {formatTHB(priceNum - cost)} บาท ({gp.toFixed(1)}%)
                      </p>
                    ) : null}
                  </>
                ) : null}
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

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-muted-foreground">
      {label}
      <div className="mt-0.5 text-foreground">{children}</div>
    </label>
  );
}

function SkuSelect({
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
