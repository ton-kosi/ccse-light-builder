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
import { Block, SkuSelect, type Sku } from "@/components/boq/FoSetDialog";
import { Choice, Row } from "@/components/boq/LinearDialog";
import { SKU_OPTIONS_KEY, inCategory } from "@/lib/skuCategory";
import { DIM_TYPES, linearSkuGroups, wattPerMOf, type DimType } from "@/lib/linear";
import {
  bestLayout,
  buildClipso,
  clipsoSkuGroups,
  cutSize,
  DEFAULT_ALLOW_CM,
  lightFor,
  spacingFor,
  wattPerModuleOf,
  trackPieces,
  type ClipsoConfig,
  type Panel,
  type TrackType,
} from "@/lib/clipso";
import { formatQty, formatTHB, toNumber } from "@/lib/format";
import { useSkuPrices } from "@/lib/skuPrices";

export type ClipsoTarget =
  | { mode: "new"; option: string | null }
  | { mode: "edit"; config: ClipsoConfig; option: string | null; zone: string | null; discount: number };

const CCT = "2700K/3000K/4000K/6500K : TBD";
const newPanel = (): Panel => ({ shape: "rect", w: 0, l: 0, qty: 1, allowW: null, allowL: null });

export function ClipsoDialog({
  target,
  quotationId,
  canSeeCost,
  replaceRows,
  onClose,
}: {
  target: ClipsoTarget;
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
  const g = useMemo(() => clipsoSkuGroups(skus ?? []), [skus]);
  const lin = useMemo(() => linearSkuGroups(skus ?? []), [skus]);
  const byId = useMemo(() => new Map((skus ?? []).map((s) => [s.id, s])), [skus]);
  const typeNames = [...g.types.keys()];

  const [c, setC] = useState<ClipsoConfig | null>(editing?.config ?? null);
  const [type, setType] = useState("");
  const [option, setOption] = useState(target.option ?? "");
  const [zone, setZone] = useState(editing?.zone ?? "");
  const [disc, setDisc] = useState(editing ? String(editing.discount) : "0");
  // text being typed in the size cells (kept as text so "1." etc. can be typed)
  const [cells, setCells] = useState<Record<string, string>>({});

  useEffect(() => {
    if (c || !skus) return;
    const first = typeNames[0] ?? "";
    setType(first);
    const track = g.trackFor("CW")[0] ?? g.tracks[0];
    setC({
      v: 1,
      blockId: crypto.randomUUID().slice(0, 8),
      code: "",
      fabricName: first,
      fabrics: g.types.get(first) ?? [],
      forceFabricSkuId: null,
      track: "CW",
      trackSkuId: track?.id ?? null,
      trackLength: g.trackLength(track),
      panels: [newPanel()],
      combined: true,
      lengthStep: 0.1,
      light: null,
      rowIds: [],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, skus]);
  // editing: find which fabric type the saved widths belong to
  useEffect(() => {
    if (!editing || !skus || type) return;
    const id = editing.config.fabrics[0]?.skuId;
    const found = [...g.types.entries()].find(([, list]) => list.some((f) => f.skuId === id));
    setType(found?.[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skus]);

  const set = (p: Partial<ClipsoConfig>) => setC((o) => (o ? { ...o, ...p } : o));
  const setPanel = (i: number, p: Partial<Panel>) =>
    setC((o) => (o ? { ...o, panels: o.panels.map((x, j) => (j === i ? { ...x, ...p } : x)) } : o));
  const cell = (key: string, value: number | null | undefined) =>
    cells[key] ?? (value ? String(value) : "");
  const numCell = (key: string, apply: (n: number | null) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setCells((x) => ({ ...x, [key]: e.target.value }));
    apply(toNumber(e.target.value));
  };

  const built = useMemo(
    () => (c && prices ? buildClipso(c, prices, () => crypto.randomUUID()) : null),
    [c, prices],
  );
  const compare = useMemo(
    () =>
      c && prices
        ? bestLayout(
            c.panels.filter((p) => p.w > 0 && (p.shape === "circle" || p.l > 0) && p.qty > 0),
            c.fabrics,
            prices,
            c.lengthStep,
            c.forceFabricSkuId,
          )
        : null,
    [c, prices],
  );
  const allWidths = useMemo(
    () =>
      c && prices
        ? bestLayout(
            c.panels.filter((p) => p.w > 0 && (p.shape === "circle" || p.l > 0) && p.qty > 0),
            c.fabrics,
            prices,
            c.lengthStep,
          ).tries
        : [],
    [c, prices],
  );
  const discNum = toNumber(disc) ?? 0;
  const tooHigh = !!built && discNum > built.maxDiscount + 1e-9;
  const net = built ? Math.round(built.list * (1 - discNum / 100) * 100) / 100 : 0;

  // PSU choices follow the dimming type
  useEffect(() => {
    if (!c?.light) return;
    const opts = lin.psuFor(c.light.dim);
    if (JSON.stringify(opts) !== JSON.stringify(c.light.psuOptions))
      setC({ ...c, light: { ...c.light, psuOptions: opts } });
  }, [c, lin]);

  const save = useMutation({
    mutationFn: async () => {
      if (!c || !built) throw new Error("ยังโหลดข้อมูลไม่เสร็จ");
      if (!c.fabrics.length) throw new Error("เลือกรุ่นผ้าก่อน");
      if (!built.rows.some((r) => r.kind === "priced")) throw new Error("ใส่ขนาดช่องอย่างน้อย 1 ช่อง");
      if (built.problems.length) throw new Error(built.problems.join(" · "));
      if (!c.trackSkuId) throw new Error("เลือกรางก่อน");
      if (c.light && !c.light.ledSkuId) throw new Error("เลือกไฟก่อน");
      if (built.missing.length)
        throw new Error(
          `ยังไม่มีราคาขายของ ${built.missing.map((id) => byId.get(id)?.code ?? id).join(", ")} — ให้ admin ตั้งราคาที่หน้าทะเบียน SKU`,
        );
      if (tooHigh) throw new Error(`ส่วนลดสูงสุดของชุดนี้คือ ${built.maxDiscount}%`);
      const rows = built.rows.map((r, i) => ({
        id: r.id,
        kind: r.kind,
        customer_text: r.customer_text,
        qty: r.qty,
        unit: r.unit,
        unit_price: r.unit_price,
        discount_percent: r.kind === "priced" ? discNum : 0,
        option_name: option.trim() || null,
        zone: i === 0 ? zone.trim() || null : null,
        component_id: null,
        circuit_note: null,
        cut_lengths: null,
      }));
      await replaceRows(editing?.config.rowIds ?? [], rows);
      const recipes = built.rows.flatMap((r) => r.recipes.map((x) => ({ ...x, quote_line_id: r.id })));
      if (recipes.length) {
        const { error } = await supabase.from("line_recipes").insert(recipes);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "อัปเดตชุด Clipso แล้ว" : "เพิ่มชุด Clipso แล้ว");
      ["line_recipes", "boq_costs", "set_lines"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: ["quote_lines", quotationId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const chooseType = (t: string) => {
    setType(t);
    set({ fabrics: g.types.get(t) ?? [], fabricName: t, forceFabricSkuId: null });
  };
  const chooseTrack = (t: TrackType) => {
    const s = g.trackFor(t)[0];
    set({ track: t, trackSkuId: s?.id ?? c?.trackSkuId ?? null, trackLength: g.trackLength(s) });
  };
  const lightOn = (on: boolean) => {
    if (!on) return set({ light: null });
    const led = lin.leds[0];
    set({
      light: {
        kind: "strip",
        depthCm: 20,
        spacingCm: spacingFor(20),
        ledSkuId: led?.id ?? "",
        wattPerM: wattPerMOf(led) ?? 0,
        cct: CCT,
        dim: "NON-DIM",
        psuOptions: lin.psuFor("NON-DIM"),
        loadFactor: 0.8,
        miscSkuId: null,
      },
    });
  };
  const L = c?.light ?? null;
  const setL = (p: Partial<NonNullable<ClipsoConfig["light"]>>) =>
    setC((o) => (o && o.light ? { ...o, light: { ...o.light, ...p } } : o));
  const pick = compare?.pick ?? null;
  const miscChoices = skus ? inCategory(skus, "LED accessory", "Service") : [];
  const modules = skus ? inCategory(skus, "LED module") : [];
  const isModule = L?.kind === "module";
  const chooseKind = (kind: "strip" | "module") => {
    const first = kind === "module" ? modules[0] : lin.leds[0];
    setCells((x) => ({ ...x, wpm: "" }));
    setL({
      kind,
      ledSkuId: first?.id ?? "",
      wattPerM: (kind === "module" ? wattPerModuleOf(first) : wattPerMOf(first)) ?? 0,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "แก้ชุด Clipso" : "เพิ่มชุด Clipso (ผ้ายืด)"}</DialogTitle>
        </DialogHeader>
        {!c ? (
          <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
            <div className="space-y-5">
              <Block title="1. ผ้า">
                <div className="grid gap-2 text-sm">
                  <Row label="รหัสแบบ">
                    <Input
                      className="w-32"
                      placeholder="VN-01"
                      value={c.code}
                      onChange={(e) => set({ code: e.target.value.toUpperCase() })}
                    />
                  </Row>
                  <Row label="รุ่นผ้า">
                    {typeNames.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {typeNames.map((t) => (
                          <Choice key={t} on={type === t} onClick={() => chooseType(t)}>
                            {t}
                          </Choice>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-destructive">
                        ยังไม่มีผ้าในหมวด Clipso fabric ที่ตั้งหน้าผ้าไว้ — เพิ่มที่หน้า SKU
                      </span>
                    )}
                    {g.noWidth.length ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        ยังไม่ได้ตั้งหน้าผ้า: {g.noWidth.map((s) => s.code).join(", ")}
                      </p>
                    ) : null}
                  </Row>
                  <Row label="ชื่อผ้าในใบ">
                    <Input value={c.fabricName} onChange={(e) => set({ fabricName: e.target.value })} />
                  </Row>
                  <Row label="หน้าผ้า">
                    <div className="flex flex-wrap gap-1.5">
                      <Choice on={!c.forceFabricSkuId} onClick={() => set({ forceFabricSkuId: null })}>
                        อัตโนมัติ (ถูกที่สุด)
                      </Choice>
                      {c.fabrics.map((f) => (
                        <Choice
                          key={f.skuId}
                          on={c.forceFabricSkuId === f.skuId}
                          onClick={() => set({ forceFabricSkuId: f.skuId })}
                        >
                          {f.width.toFixed(2)} ม.
                        </Choice>
                      ))}
                    </div>
                  </Row>
                  <Row label="ราง">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(["CC", "CW"] as TrackType[]).map((t) => (
                        <Choice key={t} on={c.track === t} onClick={() => chooseTrack(t)}>
                          {t}
                        </Choice>
                      ))}
                      <div className="min-w-56 flex-1">
                        <SkuSelect
                          value={c.trackSkuId}
                          preferred={g.trackFor(c.track).length ? g.trackFor(c.track) : g.tracks}
                          category={`Clipso track ${c.track}`}
                          all={skus ?? []}
                          onChange={(id) =>
                            set({ trackSkuId: id || null, trackLength: g.trackLength(byId.get(id)) })
                          }
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">เส้นละ {c.trackLength} ม.</span>
                    </div>
                  </Row>
                </div>
              </Block>

              <Block title="2. ขนาดช่อง (หลุมจริง)">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="pb-1 font-medium">รูปทรง</th>
                      <th className="w-20 pb-1 font-medium">กว้าง / Ø (ม.)</th>
                      <th className="w-20 pb-1 font-medium">ยาว (ม.)</th>
                      <th className="w-14 pb-1 font-medium">จำนวน</th>
                      <th className="w-28 pb-1 font-medium" title="ปกติ 10 ซม. ต่อด้าน — ปรับสั้นลงได้เป็นกรณีไป">
                        เผื่อ/ด้าน (ซม.) ก × ย
                      </th>
                      <th className="pb-1 text-right font-medium">ขนาดตัด</th>
                      <th className="w-14 pb-1 text-right font-medium">ราง</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {c.panels.map((p, i) => {
                      const [a, b] = cutSize(p);
                      const ok = p.w > 0 && (p.shape === "circle" || p.l > 0);
                      return (
                        <tr key={i}>
                          <td className="py-1 pr-1">
                            <div className="flex gap-1">
                              <Choice on={p.shape === "rect"} onClick={() => setPanel(i, { shape: "rect" })}>
                                ▭
                              </Choice>
                              <Choice on={p.shape === "circle"} onClick={() => setPanel(i, { shape: "circle" })}>
                                ◯
                              </Choice>
                            </div>
                          </td>
                          <td className="py-1 pr-1">
                            <Input inputMode="decimal" value={cell(`w${i}`, p.w)} onChange={numCell(`w${i}`, (n) => setPanel(i, { w: n ?? 0 }))} />
                          </td>
                          <td className="py-1 pr-1">
                            {p.shape === "circle" ? (
                              <span className="text-xs text-muted-foreground">วงกลม</span>
                            ) : (
                              <Input inputMode="decimal" value={cell(`l${i}`, p.l)} onChange={numCell(`l${i}`, (n) => setPanel(i, { l: n ?? 0 }))} />
                            )}
                          </td>
                          <td className="py-1 pr-1">
                            <Input
                              inputMode="numeric"
                              value={cell(`q${i}`, p.qty)}
                              onChange={numCell(`q${i}`, (n) => setPanel(i, { qty: Math.max(0, Math.round(n ?? 0)) }))}
                            />
                          </td>
                          <td className="py-1 pr-1">
                            <div className="flex gap-1">
                              <Input
                                className="px-1.5 text-center"
                                inputMode="decimal"
                                placeholder={String(DEFAULT_ALLOW_CM)}
                                value={cells[`aw${i}`] ?? (p.allowW != null ? String(p.allowW) : "")}
                                onChange={numCell(`aw${i}`, (n) => setPanel(i, { allowW: n }))}
                              />
                              {p.shape === "rect" ? (
                                <Input
                                  className="px-1.5 text-center"
                                  inputMode="decimal"
                                  placeholder={String(DEFAULT_ALLOW_CM)}
                                  value={cells[`al${i}`] ?? (p.allowL != null ? String(p.allowL) : "")}
                                  onChange={numCell(`al${i}`, (n) => setPanel(i, { allowL: n }))}
                                />
                              ) : null}
                            </div>
                          </td>
                          <td className="py-1 text-right text-xs tabular-nums text-muted-foreground">
                            {ok ? `${a.toFixed(2)} × ${b.toFixed(2)}` : "—"}
                          </td>
                          <td className="py-1 text-right text-xs tabular-nums text-muted-foreground">
                            {ok ? `${trackPieces(p, c.trackLength) * p.qty} เส้น` : "—"}
                          </td>
                          <td className="py-1 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setCells({});
                                set({ panels: c.panels.length > 1 ? c.panels.filter((_, j) => j !== i) : [newPanel()] });
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
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                  <Button size="sm" variant="outline" onClick={() => set({ panels: [...c.panels, newPanel()] })}>
                    + เพิ่มช่อง
                  </Button>
                  <span className="flex items-center gap-1.5">
                    <Choice on={c.combined} onClick={() => set({ combined: true })}>
                      รวมเป็น 1 ชุด (จัดผ้ารวมกัน)
                    </Choice>
                    <Choice on={!c.combined} onClick={() => set({ combined: false })}>
                      แยกบรรทัดต่อขนาด
                    </Choice>
                  </span>
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    ปัดความยาวตัดขึ้นทีละ
                    <Input
                      className="h-8 w-16"
                      inputMode="decimal"
                      value={cells["step"] ?? String(c.lengthStep)}
                      onChange={numCell("step", (n) => set({ lengthStep: n ?? 0 }))}
                    />
                    ม.
                  </label>
                </div>
              </Block>

              <Block title="3. การวางผ้า (คิดเงิน = หน้าผ้า × ความยาวที่ตัด รวมชายที่เหลือทิ้ง)">
                {pick ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex flex-wrap gap-2">
                      {allWidths.map((t) => (
                        <div
                          key={t.fabric.skuId}
                          className={
                            "rounded border px-2 py-1 text-xs " +
                            (t.fabric.skuId === pick.fabric.skuId ? "border-primary bg-primary/5" : "border-border")
                          }
                        >
                          <b>หน้า {t.fabric.width.toFixed(2)} ม.</b>{" "}
                          {t.lay.problems.length
                            ? "— ใช้ไม่ได้"
                            : `— ยาว ${formatQty(t.lay.length)} ม. = ${formatQty(t.lay.area)} ตร.ม.`}
                          {canSeeCost && !t.lay.problems.length ? ` · ${formatTHB(t.cost)}` : ""}
                          {t.fabric.skuId === pick.fabric.skuId ? " ✓" : ""}
                        </div>
                      ))}
                    </div>
                    {c.combined ? (
                      <>
                        <ul className="space-y-0.5 text-xs text-muted-foreground">
                          {pick.lay.strips.map((s, i) => (
                            <li key={i}>
                              แถบ {i + 1}: ยาว {s.length.toFixed(2)} ม. · {s.items.length} ชิ้น ({s.items.map((x) => x.across.toFixed(2)).join(" + ")} = {s.used.toFixed(2)} จาก {pick.fabric.width.toFixed(2)} ม.)
                            </li>
                          ))}
                        </ul>
                        <p className="text-xs">
                          ใช้ผ้า {pick.lay.rolls} ม้วน (ม้วนละ {pick.fabric.rollLength} ม. — ชิ้นเดียวกันไม่ข้ามม้วน)
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">แยกบรรทัด: แต่ละขนาดคิดเป็นชุดของตัวเอง ราคาต่อ 1 ชุด × จำนวน</p>
                    )}
                    {built?.problems.length ? (
                      <p className="text-xs font-medium text-destructive">{built.problems.join(" · ")}</p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">ใส่ขนาดช่องและเลือกรุ่นผ้า</p>
                )}
              </Block>

              <Block title="4. ไฟด้านบน (Luminous ceiling)">
                <label className="mb-2 flex items-center gap-2 text-sm">
                  <Checkbox checked={!!L} onCheckedChange={(v) => lightOn(v === true)} />
                  รวมไฟด้านบนผ้า
                </label>
                {L ? (
                  <div className="grid gap-2 text-sm">
                    <Row label="ความลึกหลุม">
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          className="w-20"
                          inputMode="decimal"
                          value={cells["depth"] ?? String(L.depthCm)}
                          onChange={numCell("depth", (n) => {
                            setCells((x) => ({ ...x, spacing: String(spacingFor(n ?? 0)) }));
                            setL({ depthCm: n ?? 0, spacingCm: spacingFor(n ?? 0) });
                          })}
                        />
                        ซม. (ฝ้าถึงผ้า) → ระยะห่างไฟ
                        <Input
                          className="w-20"
                          inputMode="decimal"
                          value={cells["spacing"] ?? String(L.spacingCm)}
                          onChange={numCell("spacing", (n) => setL({ spacingCm: n ?? 0 }))}
                        />
                        ซม. <span className="text-xs text-muted-foreground">(ปกติ 1.5 เท่าของความลึก)</span>
                      </div>
                    </Row>
                    <Row label="ชนิดไฟ">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Choice on={!isModule} onClick={() => chooseKind("strip")}>
                          ไฟเส้น (เรียงเป็นแถว)
                        </Choice>
                        <Choice on={isModule} onClick={() => chooseKind("module")}>
                          ไฟ module (ตาราง x × y)
                        </Choice>
                      </div>
                    </Row>
                    <Row label="ไฟ">
                      <SkuSelect
                        value={L.ledSkuId}
                        preferred={isModule ? modules : lin.leds}
                        category={isModule ? "LED module" : "LED ribbon"}
                        all={skus ?? []}
                        onChange={(id) => {
                          const w = isModule ? wattPerModuleOf(byId.get(id)) : wattPerMOf(byId.get(id));
                          setCells((x) => ({ ...x, wpm: "" }));
                          setL({ ledSkuId: id, wattPerM: w ?? L.wattPerM });
                        }}
                      />
                    </Row>
                    <Row label={isModule ? "วัตต์/ชิ้น · สี" : "วัตต์/เมตร · สี"}>
                      <div className="flex gap-2">
                        <Input
                          className="w-20"
                          inputMode="decimal"
                          value={cells["wpm"] ?? String(L.wattPerM || "")}
                          onChange={numCell("wpm", (n) => setL({ wattPerM: n ?? 0 }))}
                        />
                        <Input value={L.cct} onChange={(e) => setL({ cct: e.target.value })} />
                      </div>
                    </Row>
                    <Row label="ระบบดิม">
                      <div className="flex flex-wrap gap-1.5">
                        {DIM_TYPES.map((d) => (
                          <Choice key={d} on={L.dim === d} onClick={() => setL({ dim: d as DimType })}>
                            {d}
                          </Choice>
                        ))}
                      </div>
                    </Row>
                    <Row label="อุปกรณ์อื่น (MISC.)">
                      <SkuSelect
                        value={L.miscSkuId}
                        preferred={miscChoices}
                        category="LED accessory / Service"
                        all={skus ?? []}
                        noneLabel="— ไม่ใส่ —"
                        onChange={(id) => setL({ miscSkuId: id || null })}
                      />
                    </Row>
                    <Row label="สรุปไฟ">
                      <ul className="text-xs text-muted-foreground">
                        {c.panels
                          .filter((p) => p.w > 0 && (p.shape === "circle" || p.l > 0))
                          .map((p, i) => {
                            const one = lightFor(p, L);
                            return (
                              <li key={i}>
                                ช่อง {i + 1}: {one.text} · {formatQty(one.watts)} W
                                {p.qty > 1 ? ` × ${p.qty} ช่อง` : ""}
                              </li>
                            );
                          })}
                        {!L.psuOptions.length ? (
                          <li className="text-destructive">ไม่มีหม้อแปลง {L.dim} ในหมวด Power supply</li>
                        ) : null}
                      </ul>
                    </Row>
                  </div>
                ) : null}
              </Block>
            </div>

            <div className="space-y-5">
              <Block title="ลูกค้าจะเห็น">
                <div className="max-h-96 overflow-y-auto rounded bg-secondary p-2 text-xs">
                  <div className="mb-1 grid grid-cols-[110px_1fr] gap-2">
                    <Input className="h-7 text-xs" placeholder="Option (ถ้ามี)" value={option} onChange={(e) => setOption(e.target.value)} />
                    <Input
                      className="h-7 text-xs"
                      placeholder="โซน เช่น LOBBY"
                      value={zone}
                      onChange={(e) => setZone(e.target.value.toUpperCase())}
                    />
                  </div>
                  {zone ? <div className="font-bold">{zone}</div> : null}
                  {(built?.rows ?? []).map((r) => (
                    <div key={r.id} className={"flex gap-2 " + (r.kind === "heading" ? "pt-1 font-semibold" : "pt-1")}>
                      <span className="flex-1 whitespace-pre-line">{r.customer_text}</span>
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
                    {tooHigh ? <p className="text-xs text-destructive">ลดได้ไม่เกิน {built.maxDiscount}%</p> : null}
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
            {save.isPending ? "กำลังบันทึก..." : "บันทึกชุด Clipso"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
