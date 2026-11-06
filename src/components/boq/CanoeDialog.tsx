import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { GridLine } from "@/components/boq/BoqGrid";
import { Block, SkuSelect, type Sku } from "@/components/boq/FoSetDialog";
import { Choice, Row } from "@/components/boq/LinearDialog";
import {
  buildCanoe,
  CANOE_SIZES,
  canoeLengths,
  defaultRetro,
  defaultSs,
  DIFFUSERS,
  runsFromSpec,
  SS_GRADES,
  SS_MODELS,
  type CanoeConfig,
  type CanoeSize,
  type RetroOptions,
  type SsOptions,
} from "@/lib/canoe";
import { parseCutSpec } from "@/lib/cutSpec";
import { formatQty, formatTHB, toNumber } from "@/lib/format";
import { CANOE_RAIL, railOf } from "@/lib/profiles";
import { categoryOf, SKU_OPTIONS_KEY } from "@/lib/skuCategory";
import { useSkuPrices } from "@/lib/skuPrices";

export type CanoeTarget =
  | { mode: "new"; option: string | null }
  | { mode: "edit"; config: CanoeConfig; option: string | null; zone: string | null; discount: number };

const cm = (m: number) => `${Math.round(m * 1000) / 10} ซม.`;

/** Canoe builder: LED + single / double + run lengths → pieces L/M/S/SS, LED metres, price per metre. */
export function CanoeDialog({
  target,
  quotationId,
  canSeeCost,
  replaceRows,
  onClose,
}: {
  target: CanoeTarget;
  quotationId: string;
  canSeeCost: boolean;
  replaceRows: (oldIds: string[], rows: Partial<GridLine>[]) => Promise<void>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const editing = target.mode === "edit" ? target : null;
  const { data: skus } = useQuery({
    queryKey: SKU_OPTIONS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.from("skus").select("id, code, name, unit, notes").order("code");
      if (error) throw error;
      return data as Sku[];
    },
  });
  const { data: prices } = useSkuPrices();
  const byId = useMemo(() => new Map((skus ?? []).map((s) => [s.id, s])), [skus]);
  // LEDs that come as Canoe pieces (others have no piece table)
  const leds = useMemo(
    () => (skus ?? []).filter((s) => categoryOf(s) === "LED ribbon" && canoeLengths(s, false)),
    [skus],
  );

  // housing SKUs: anything named Canoe
  const housings = useMemo(() => (skus ?? []).filter((s) => /canoe/i.test(`${s.code} ${s.name}`)), [skus]);
  const [c, setC] = useState<CanoeConfig>(
    editing?.config ?? {
      v: 1,
      blockId: crypto.randomUUID().slice(0, 8),
      code: "",
      title: "CANOE LIGHT",
      ledSkuId: "",
      double: false,
      housing: {},
      runs: [],
      spec: "",
      rowIds: [],
    },
  );
  const [spec, setSpec] = useState(editing?.config.spec ?? "");
  const [option, setOption] = useState(target.option ?? "");
  const [zone, setZone] = useState(editing?.zone ?? "");
  const [disc, setDisc] = useState(editing ? String(editing.discount) : "0");
  const set = (p: Partial<CanoeConfig>) => setC((o) => ({ ...o, ...p }));
  const isSS = c.housingType === "ss";
  const isRetro = c.housingType === "retrofit";
  const retro = c.retro ?? defaultRetro();
  const setRetro = (p: Partial<RetroOptions>) => setC((o) => ({ ...o, retro: { ...(o.retro ?? defaultRetro()), ...p } }));
  const inCat = (name: string) => (skus ?? []).filter((s) => categoryOf(s) === name);
  const rails = inCat("LED heat sink").filter((s) => railOf(s) === CANOE_RAIL);
  /** type a piece count: this run stops being automatic */
  const setPieces = (length: number, counts: Record<CanoeSize, number>, k: CanoeSize, v: number) =>
    set({ manualFits: { ...c.manualFits, [String(length)]: { ...counts, [k]: v } } });
  const autoPieces = (length: number) => {
    const rest = { ...c.manualFits };
    delete rest[String(length)];
    set({ manualFits: rest });
  };
  const ss = c.ss ?? defaultSs();
  const setSs = (p: Partial<SsOptions>) => setC((o) => ({ ...o, ss: { ...(o.ss ?? defaultSs()), ...p } }));
  // stainless housing bars / acrylic covers: anything named SS / stainless, acrylic / cover
  const ssHousings = useMemo(() => (skus ?? []).filter((s) => /\bSS\b|SS[-\s]?3\d\d|stainless|สแตนเลส/i.test(`${s.code} ${s.name}`)), [skus]);
  const covers = useMemo(() => (skus ?? []).filter((s) => /acrylic|cover|อะคริลิก|ฝาครอบ/i.test(`${s.code} ${s.name}`)), [skus]);

  const parsed = spec.trim() ? parseCutSpec(spec) : null;
  const specError = parsed && "error" in parsed ? parsed.error : null;
  // each side of a joined run [a+b] (L-shape, pool steps) gets its own pieces
  const runs = parsed && !("error" in parsed) ? runsFromSpec(parsed.runs) : [];
  const cfg: CanoeConfig = { ...c, runs, spec };
  const led = byId.get(c.ledSkuId);
  const built = useMemo(
    () => (prices ? buildCanoe(cfg, led, prices, () => crypto.randomUUID(), (id) => byId.get(id)?.unit) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(cfg), led, prices],
  );
  const discNum = toNumber(disc) ?? 0;
  const tooHigh = !!built && discNum > built.maxDiscount + 1e-9;
  const net = built ? Math.round(built.list * (1 - discNum / 100) * 100) / 100 : 0;

  const save = useMutation({
    mutationFn: async () => {
      if (!built) throw new Error("ยังโหลดข้อมูลไม่เสร็จ");
      if (specError) throw new Error(specError);
      if (built.problems.length) throw new Error(built.problems.join(" · "));
      if (built.missing.length)
        throw new Error(`ยังไม่มีราคาขายของ ${built.missing.map((id) => byId.get(id)?.code ?? id).join(", ")}`);
      if (tooHigh) throw new Error(`ส่วนลดสูงสุดของชุดนี้คือ ${built.maxDiscount}%`);
      const rows = built.rows.map((r, i) => ({
        id: r.id,
        kind: r.kind,
        customer_text: r.customer_text,
        qty: r.qty,
        unit: r.unit,
        unit_price: r.unit_price,
        discount_percent: r.kind === "priced" ? discNum : 0,
        item_no: r.item_no ?? null,
        option_name: option.trim() || null,
        zone: i === 0 ? zone.trim() || null : null,
        component_id: null,
        circuit_note: null,
        cut_lengths: r.cut_lengths,
      }));
      await replaceRows(editing?.config.rowIds ?? [], rows);
      const recipes = built.rows.flatMap((r) => r.recipes.map((x) => ({ ...x, quote_line_id: r.id })));
      if (recipes.length) {
        const { error } = await supabase.from("line_recipes").insert(recipes);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "อัปเดตชุด Canoe แล้ว" : "เพิ่มชุด Canoe แล้ว");
      ["line_recipes", "boq_costs", "set_lines"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: ["quote_lines", quotationId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const plan = built?.plan;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "แก้ชุด Canoe" : "เพิ่มชุด Canoe"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
          <div className="space-y-5">
            <Block title="1. ไฟและแบบ">
              <div className="grid gap-2 text-sm">
                <Row label="ข้อที่ · รหัสแบบ · ชื่อ">
                  <div className="flex gap-2">
                    <Input className="w-14" placeholder="1" value={c.itemNo ?? ""} onChange={(e) => set({ itemNo: e.target.value })} />
                    <Input className="w-28" placeholder="CN 01" value={c.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
                    <Input value={c.title} onChange={(e) => set({ title: e.target.value.toUpperCase() })} />
                  </div>
                </Row>
                <Row label="ไฟ LED">
                  <SkuSelect value={c.ledSkuId} preferred={leds} category="LED ribbon" all={skus ?? []} onChange={(id) => set({ ledSkuId: id })} />
                </Row>
                <Row label="แบบ">
                  <div className="flex gap-1.5">
                    <Choice on={!c.double} onClick={() => set({ double: false })}>
                      Single
                    </Choice>
                    <Choice on={c.double} onClick={() => set({ double: true })}>
                      Double (ไฟ 2 ฝั่ง)
                    </Choice>
                  </div>
                </Row>
                {plan?.lengths ? (
                  <p className="text-xs text-muted-foreground">
                    ขนาดท่อนของไฟนี้:{" "}
                    {CANOE_SIZES.filter((k) => plan.lengths![k])
                      .map((k) => `${k} ${cm(plan.lengths![k]!)}`)
                      .join(" · ")}{" "}
                    (+2 มม. ต่อรอยต่อ)
                  </p>
                ) : c.ledSkuId ? (
                  <p className="text-xs text-destructive">ไฟรุ่นนี้ยังไม่มีขนาดท่อน Canoe — เลือกไฟรุ่นอื่น</p>
                ) : null}
              </div>
            </Block>

            <Block title="2. ความยาวแต่ละช่วง (เมตร)">
              <Input
                className="font-mono"
                placeholder="เช่น 2.49x2 + 4.18 + [1.2+0.8]   (x = จำนวนชุด, [ ] = ต่อเป็นมุม / ขั้นบันได)"
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
              />
              {specError ? <p className="mt-1 text-xs text-destructive">{specError}</p> : null}
              {plan?.runs.length ? (
                <table className="mt-3 w-full text-xs">
                  <thead className="text-left text-muted-foreground">
                    <tr>
                      <th className="py-1">ความยาว</th>
                      <th>ชุด</th>
                      {CANOE_SIZES.map((k) => (
                        <th key={k} className="text-right">
                          {k}
                        </th>
                      ))}
                      <th className="text-right">ต่อได้</th>
                      <th className="text-right">ต่าง</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.runs.map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="py-1 tabular-nums">
                          {r.label ? <span className="text-muted-foreground">ด้าน {r.label} · </span> : null}
                          {formatQty(r.length)} ม.
                        </td>
                        <td className="tabular-nums">× {r.sets}</td>
                        {CANOE_SIZES.map((k) => (
                          <td key={k} className="text-right tabular-nums">
                            {r.fit && plan.lengths?.[k] ? (
                              <Input
                                className={"ml-auto h-7 w-12 px-1 text-right text-xs " + (r.fit.manual ? "border-warning" : "")}
                                inputMode="numeric"
                                title="แก้จำนวนท่อนเอง"
                                value={r.fit.counts[k] || ""}
                                onChange={(e) => setPieces(r.length, r.fit!.counts, k, Math.max(0, Math.round(toNumber(e.target.value) ?? 0)))}
                              />
                            ) : (
                              ""
                            )}
                          </td>
                        ))}
                        <td className="text-right tabular-nums">{r.fit ? `${formatQty(r.fit.totalM)} ม.` : "—"}</td>
                        <td className={"text-right tabular-nums " + (r.fit && !r.fit.ok ? "font-semibold text-destructive" : "")}>
                          {r.fit ? `${r.fit.diffM >= 0 ? "เหลือ" : "เกิน"} ${cm(Math.abs(r.fit.diffM))}` : ""}
                          {r.fit?.manual ? (
                            <button type="button" className="ml-1 text-primary underline" onClick={() => autoPieces(r.length)}>
                              อัตโนมัติ
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t border-border font-semibold">
                      <td className="py-1">รวม {formatQty(plan.runM)} ม.</td>
                      <td />
                      {CANOE_SIZES.map((k) => (
                        <td key={k} className="text-right tabular-nums">
                          {plan.totals[k] || ""}
                        </td>
                      ))}
                      <td colSpan={2} className="text-right">
                        LED {formatQty(plan.ledM)} ม.
                      </td>
                    </tr>
                  </tbody>
                </table>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">
                ระบบเลือกท่อนให้น้อยที่สุด โดยยาวเกินได้ไม่เกิน 5 ซม. และสั้นกว่าได้ไม่เกิน 10 ซม. · แก้จำนวนท่อนในตารางเองได้
                ถ้าหน้างานต้องตัดสินใจเอง · ช่วงที่ต่อกัน [a+b] เช่น มุม L หรือขั้นบันไดสระ คิดท่อนแยกทีละด้าน
              </p>
            </Block>

            <Block title="3. ตัวเรือน Canoe">
              <div className="mb-3 flex flex-wrap gap-1.5 text-sm">
                <Choice on={!isSS && !isRetro} onClick={() => set({ housingType: "alu" })}>
                  อลูมิเนียม (ท่อน L / M / S / SS)
                </Choice>
                <Choice on={isSS} onClick={() => set({ housingType: "ss", ss })}>
                  สแตนเลส (ต่อเนื่อง เชื่อมหน้างาน)
                </Choice>
                <Choice
                  on={isRetro}
                  onClick={() =>
                    set({
                      housingType: "retrofit",
                      retro: { ...retro, heatsinkSkuId: retro.heatsinkSkuId || (rails[0]?.id ?? "") },
                    })
                  }
                >
                  เปลี่ยนไฟในตัวเรือนเดิม
                </Choice>
              </div>
              {isRetro ? (
                <div className="grid gap-2 text-sm">
                  <Row label="ชื่อช่วงในใบ">
                    <Input placeholder="SWX-1 (STRAIGHT)" value={retro.runName} onChange={(e) => setRetro({ runName: e.target.value.toUpperCase() })} />
                  </Row>
                  <Row label="Jacket">
                    <div className="flex flex-wrap gap-1.5">
                      <Choice on={retro.jacket === "DOUBLE"} onClick={() => setRetro({ jacket: "DOUBLE" })}>
                        Double
                      </Choice>
                      <Choice on={retro.jacket === "SINGLE"} onClick={() => setRetro({ jacket: "SINGLE" })}>
                        Single
                      </Choice>
                    </div>
                  </Row>
                  <Row label={`ราง alu. (${CANOE_RAIL}")`}>
                    <SkuSelect value={retro.heatsinkSkuId} preferred={rails.length ? rails : inCat("LED heat sink")} category={`LED heat sink ขนาด ${CANOE_RAIL}`} all={skus ?? []} noneLabel="— ไม่เลือก —" onChange={(id) => setRetro({ heatsinkSkuId: id })} />
                  </Row>
                  <Row label="Jacket ที่เบิก">
                    <SkuSelect value={retro.jacketSkuId} preferred={inCat("LED jacket")} category="LED jacket" all={skus ?? []} noneLabel="— ไม่เลือก —" onChange={(id) => setRetro({ jacketSkuId: id })} />
                  </Row>
                  <Row label="Diffuser">
                    <div className="flex flex-wrap gap-1.5">
                      {DIFFUSERS.map((d) => (
                        <Choice key={d} on={retro.diffuser === d} onClick={() => setRetro({ diffuser: d })}>
                          {d}
                        </Choice>
                      ))}
                    </div>
                  </Row>
                  <Row label="ชุดอะคริลิก + สาย IP68 (ต่อท่อน)">
                    <SkuSelect value={retro.kitSkuId} preferred={covers} category="ชุดอะคริลิก" all={skus ?? []} onChange={(id) => setRetro({ kitSkuId: id })} />
                  </Row>
                  <Row label="ตัวเรือนเดิม (พิมพ์ในใบ)">
                    <Input value={retro.housingText} onChange={(e) => setRetro({ housingText: e.target.value.toUpperCase() })} />
                  </Row>
                  <Row label="หม้อแปลง">
                    <div className="flex flex-wrap gap-1.5">
                      <Choice on={retro.existingPsu} onClick={() => setRetro({ existingPsu: true })}>
                        ของเดิม
                      </Choice>
                      <Choice on={!retro.existingPsu} onClick={() => setRetro({ existingPsu: false })}>
                        ไม่พิมพ์ (เพิ่มบรรทัดเอง)
                      </Choice>
                    </div>
                  </Row>
                  <p className="text-xs text-muted-foreground">
                    ใช้ท่อน 50 / 40 / 30 ซม. รวม {plan?.pieces ?? 0} ท่อน = ชุดอะคริลิก {plan?.pieces ?? 0} ชุด
                  </p>
                </div>
              ) : isSS ? (
                <div className="grid gap-2 text-sm">
                  <Row label="หน้าตัด">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {SS_MODELS.map((m) => (
                        <Choice key={m.key} on={ss.model === m.key} onClick={() => setSs({ model: m.key })}>
                          {m.label} ({m.w}×{m.h})
                        </Choice>
                      ))}
                      <Choice on={ss.model === "custom"} onClick={() => setSs({ model: "custom" })}>
                        ขนาดพิเศษ
                      </Choice>
                    </div>
                  </Row>
                  {ss.model === "custom" ? (
                    <Row label="ขนาดพิเศษ">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        กว้าง
                        <Input className="h-8 w-16" inputMode="decimal" value={ss.customW || ""} onChange={(e) => setSs({ customW: toNumber(e.target.value) ?? 0 })} />
                        × สูง
                        <Input className="h-8 w-16" inputMode="decimal" value={ss.customH || ""} onChange={(e) => setSs({ customH: toNumber(e.target.value) ?? 0 })} />
                        มม. · ค่าทำแบบพิเศษ
                        <Input className="h-8 w-24 text-right" inputMode="decimal" value={ss.surcharge || ""} onChange={(e) => setSs({ surcharge: toNumber(e.target.value) ?? 0 })} />
                        บาท (ทั้งชุด)
                      </div>
                    </Row>
                  ) : null}
                  <Row label="เกรดสแตนเลส">
                    <div className="flex flex-wrap gap-1.5">
                      {SS_GRADES.map((g) => (
                        <Choice key={g} on={ss.grade === g} onClick={() => setSs({ grade: g })}>
                          {g}
                        </Choice>
                      ))}
                    </div>
                  </Row>
                  <Row label="Diffuser">
                    <div className="flex flex-wrap gap-1.5">
                      {DIFFUSERS.map((d) => (
                        <Choice key={d} on={ss.diffuser === d} onClick={() => setSs({ diffuser: d })}>
                          {d}
                        </Choice>
                      ))}
                    </div>
                  </Row>
                  <Row label="ตัวเรือนสแตนเลส (เส้น 2.4 ม.)">
                    <SkuSelect value={ss.housingSkuId} preferred={ssHousings} category="ตัวเรือนสแตนเลส" all={skus ?? []} onChange={(id) => setSs({ housingSkuId: id })} />
                  </Row>
                  <Row label="ฝาครอบอะคริลิก (แผ่น 2.4 ม.)">
                    <SkuSelect value={ss.coverSkuId} preferred={covers} category="ฝาครอบอะคริลิก" all={skus ?? []} onChange={(id) => setSs({ coverSkuId: id })} />
                  </Row>
                  <p className="text-xs text-muted-foreground">
                    ใช้ตัวเรือน {plan?.ssBars ?? 0} เส้น และฝาครอบ {plan?.ssCovers ?? 0} แผ่น (ปัดขึ้นทีละช่วง — เชื่อม / ต่อหน้างาน) · SKU
                    หน่วย “m” ตัดสต็อกเป็นเมตร (เส้น × 2.4) หน่วยอื่นตัดเป็นเส้น
                  </p>
                </div>
              ) : (
              <div className="grid gap-2 text-sm">
                {CANOE_SIZES.map((k: CanoeSize) => (
                  <Row key={k} label={`ท่อน ${k}${c.double ? " (Double)" : ""}`}>
                    <SkuSelect
                      value={c.housing[k] ?? ""}
                      preferred={housings}
                      category="Canoe (ตัวเรือน)"
                      all={skus ?? []}
                      noneLabel="— เลือก SKU ตัวเรือน —"
                      onChange={(id) => set({ housing: { ...c.housing, [k]: id || undefined } })}
                    />
                  </Row>
                ))}
                <p className="text-xs text-muted-foreground">
                  ยังไม่มี SKU ตัวเรือน Canoe? เพิ่มที่หน้า SKU ก่อน (เช่น CANOE-L-SINGLE) แล้วตั้งราคาขาย
                </p>
              </div>
              )}
            </Block>
          </div>

          <div className="space-y-5">
            <Block title="ลูกค้าจะเห็น">
              <div className="rounded bg-secondary p-2 text-xs">
                <div className="mb-1 grid grid-cols-[110px_1fr] gap-2">
                  <Input className="h-7 text-xs" placeholder="Option (ถ้ามี)" value={option} onChange={(e) => setOption(e.target.value)} />
                  <Input className="h-7 text-xs" placeholder="โซน" value={zone} onChange={(e) => setZone(e.target.value.toUpperCase())} />
                </div>
                {zone ? <div className="font-bold">{zone}</div> : null}
                {(built?.rows ?? []).map((r) => (
                  <div key={r.id} className={r.kind === "heading" ? "pt-1 font-semibold" : ""}>
                    <div className="flex gap-2">
                      <span className="flex-1">{r.customer_text}</span>
                      {r.kind === "priced" ? (
                        <span className="whitespace-nowrap tabular-nums">
                          {formatQty(r.qty ?? 0)} {r.unit} @{formatTHB(r.unit_price ?? 0)}
                        </span>
                      ) : null}
                    </div>
                    {r.cut_lengths?.map((len, i) => (
                      <div key={i} className="pl-2 text-muted-foreground">
                        - {formatQty(len)} M.
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              {built?.problems.length ? (
                <p className="mt-1 text-xs font-medium text-destructive">{built.problems.join(" · ")}</p>
              ) : null}
            </Block>
            <Block title="ราคา">
              {built?.missing.length ? (
                <p className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                  ยังไม่มีราคาขายของ {built.missing.map((id) => byId.get(id)?.code ?? id).join(", ")} —{" "}
                  {canSeeCost ? "ตั้งราคาที่หน้าทะเบียน SKU" : "ติดต่อ admin ให้ตั้งราคา"}
                </p>
              ) : built ? (
                <div className="space-y-2 text-sm">
                  <div className="flex items-baseline justify-between">
                    <span className="text-muted-foreground">ราคาเต็มทั้งชุด</span>
                    <span className="text-base font-semibold tabular-nums">{formatTHB(built.list)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">ส่วนลด (สูงสุด {built.maxDiscount}%)</span>
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
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button disabled={!built || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "กำลังบันทึก..." : "บันทึกชุด Canoe"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
