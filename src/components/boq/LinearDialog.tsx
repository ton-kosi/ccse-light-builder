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
import { Block, Field, SkuSelect, type Sku } from "@/components/boq/FoSetDialog";
import { SKU_OPTIONS_KEY } from "@/lib/skuCategory";
import {
  buildLinear,
  circuitLength,
  DIM_TYPES,
  hasProfile,
  IP_RATINGS,
  isDoubleJacket,
  linearSkuGroups,
  parseLengths,
  pickPsu,
  wattPerMOf,
  type DimType,
  type PsuSkip,
  type IpRating,
  type LinearConfig,
  jediOf,
} from "@/lib/linear";
import {
  chipOf,
  DIFFUSERS,
  fitProblem,
  jediPercent,
  pcbOf,
  profileModel,
  profileModelOfSku,
  profileSize,
  profileText,
  railNeeded,
  railOf,
  usesEzClip,
  type MountType,
} from "@/lib/profiles";
import { formatQty, formatTHB, toNumber } from "@/lib/format";
import { useSkuPrices } from "@/lib/skuPrices";

export type LinearTarget =
  | { mode: "new"; option: string | null }
  | {
      mode: "edit";
      config: LinearConfig;
      option: string | null;
      zone: string | null;
      discount: number;
    };

const sel = "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm";
const COLORS = ["BLACK", "WHITE", "TBD"];
const IP_HELP: Record<IpRating, string> = {
  IP44: "ไม่ใส่ profile · heat sink + single jacket",
  IP54: "ใส่ profile · heat sink + single jacket",
  IP65: "ใส่ profile · heat sink + double jacket",
};

export function LinearDialog({
  target,
  quotationId,
  canSeeCost,
  replaceRows,
  onClose,
}: {
  target: LinearTarget;
  quotationId: string;
  canSeeCost: boolean;
  /** Deletes oldIds (if any) and inserts rows at the same place (or at the end). */
  replaceRows: (oldIds: string[], rows: Partial<GridLine>[]) => Promise<void>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const editing = target.mode === "edit" ? target : null;

  const { data: skus } = useQuery({
    queryKey: SKU_OPTIONS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("skus")
        .select("id, code, name, unit, notes")
        .order("code");
      if (error) throw error;
      return data as Sku[];
    },
  });
  const { data: prices } = useSkuPrices();
  const groups = useMemo(() => linearSkuGroups(skus ?? []), [skus]);
  const byId = useMemo(() => new Map((skus ?? []).map((s) => [s.id, s])), [skus]);

  const [c, setC] = useState<LinearConfig | null>(editing?.config ?? null);
  const [option, setOption] = useState(target.option ?? "");
  const [zone, setZone] = useState(editing?.zone ?? "");
  const [disc, setDisc] = useState(editing ? String(editing.discount) : "0");
  const [lenText, setLenText] = useState<string[]>(
    editing
      ? editing.config.circuits.map((k) => k.lengths.map((x) => x.toFixed(2)).join("+"))
      : [""],
  );

  useEffect(() => {
    if (c || !skus) return;
    const led = groups.leds[0];
    const pcb = pcbOf(led);
    const prf = groups.profiles.find((s) => {
      const m = profileModelOfSku(s);
      return !m || !fitProblem(m, pcb);
    });
    setC(withChoices({
      v: 1,
      blockId: crypto.randomUUID().slice(0, 8),
      typeCode: "",
      ledSkuId: led?.id ?? "",
      ledName: led ? led.name.toUpperCase() : "",
      wattPerM: wattPerMOf(led) ?? 0,
      ip: "IP54",
      dim: "DALI",
      heatsinkSkuId: groups.heatsinks[0]?.id ?? null,
      singleJacketSkuId: groups.singleJackets[0]?.id ?? null,
      doubleJacketSkuId: groups.doubleJackets[0]?.id ?? null,
      profileSkuId: prf?.id ?? null,
      profileName: prf ? `${prf.name.toUpperCase()} w/ MOUNTING` : "",
      profileModel: profileModelOfSku(prf)?.key ?? null,
      mount: "CLIP",
      trim: false,
      diffuser: "JEDI",
      jediPct: null,
      chip: chipOf(led),
      pcbMm: pcb,
      ezClip: usesEzClip(led),
      profileExtras: [],
      color: "",
      paintSkuId: groups.paints[0]?.id ?? null,
      psuOptions: groups.psuFor("DALI"),
      loadFactor: 0.8,
      // default: prices folded into the LED line; tick an item to price it on its own line
      show: { heatsink: false, profile: false, paint: false, psu: false },
      circuits: [{ ckt: "", lengths: [] }],
      rowIds: [],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c, skus, groups]);

  // PSU choices always follow the dimming type
  useEffect(() => {
    if (!c || !skus) return;
    const opts = groups.psuFor(c.dim);
    if (JSON.stringify(opts) !== JSON.stringify(c.psuOptions)) setC({ ...c, psuOptions: opts });
  }, [c, skus, groups]);

  const set = (p: Partial<LinearConfig>) => setC((o) => (o ? { ...o, ...p } : o));

  /** Chip, PCB width and EZ clip come from the LED's SKU (SKU page), never typed here. */
  function ledFacts(ledSkuId: string) {
    const led = byId.get(ledSkuId);
    return { chip: chipOf(led), pcbMm: pcbOf(led), ezClip: usesEzClip(led) };
  }

  /**
   * After an LED / profile / IP choice changes: profile model from the profile SKU, profile text
   * from the model + mounting + trim + diffuser, and an aluminium rail of the size needed.
   */
  function withChoices(n: LinearConfig): LinearConfig {
    const out: LinearConfig = { ...n, ...ledFacts(n.ledSkuId) };
    let prf = n.profileSkuId ? byId.get(n.profileSkuId) : undefined;
    let model = profileModelOfSku(prf);
    // a wide PCB doesn't fit V2 W13 / 45° Reverse: move to a W22 profile of the same depth if stocked
    if (model && fitProblem(model, out.pcbMm ?? null)) {
      const depth = model.family === "V2.13" ? model.key.replace("W13", "W22") : "W22.13";
      const alt = groups.profiles.find((s) => profileModelOfSku(s)?.key === depth);
      if (alt) {
        prf = alt;
        model = profileModelOfSku(alt);
        out.profileSkuId = alt.id;
      }
    }
    out.profileModel = model?.key ?? null;
    if (model) {
      const mount: MountType = model.mounts.includes(n.mount ?? "CLIP")
        ? (n.mount ?? "CLIP")
        : model.mounts[0]!;
      const choice = { model, mount, trim: !!n.trim && model.hasTrim, diffuser: n.diffuser ?? "JEDI" };
      out.mount = mount;
      out.trim = choice.trim;
      out.profileName = profileText(choice);
    } else if (prf && prf.id !== n.profileSkuId) {
      out.profileName = `${prf.name.toUpperCase()} w/ MOUNTING`;
    }
    const rail = railNeeded(hasProfile(n.ip) ? model : null, !!out.ezClip);
    const current = n.heatsinkSkuId ? byId.get(n.heatsinkSkuId) : undefined;
    if (rail && (!current || railOf(current) !== rail)) {
      const fit = groups.heatsinks.find((s) => railOf(s) === rail);
      if (fit) out.heatsinkSkuId = fit.id;
    }
    return out;
  }
  // Editing a saved block: refresh LED facts from the SKU (they may have been filled in since).
  useEffect(() => {
    if (!c || !skus || !editing) return;
    const f = ledFacts(c.ledSkuId);
    const m = profileModelOfSku(c.profileSkuId ? byId.get(c.profileSkuId) : undefined)?.key ?? null;
    if (f.chip !== c.chip || f.pcbMm !== c.pcbMm || f.ezClip !== c.ezClip || (m && m !== c.profileModel))
      setC({ ...c, ...f, ...(m ? { profileModel: m } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skus]);
  const setP = (p: Partial<LinearConfig>) => setC((o) => (o ? withChoices({ ...o, ...p }) : o));
  const built = useMemo(
    () => (c && prices ? buildLinear(c, prices, () => crypto.randomUUID()) : null),
    [c, prices],
  );
  const discNum = toNumber(disc) ?? 0;
  const tooHigh = !!built && discNum > built.maxDiscount + 1e-9;
  const net = built ? Math.round(built.list * (1 - discNum / 100) * 100) / 100 : 0;

  const save = useMutation({
    mutationFn: async () => {
      if (!c || !built) throw new Error("ยังโหลดข้อมูลไม่เสร็จ");
      if (!c.ledSkuId) throw new Error("กรุณาเลือกรุ่นไฟ");
      if (!(c.wattPerM > 0)) throw new Error("กรุณากรอกวัตต์ต่อเมตร");
      if (!c.circuits.some((k) => circuitLength(k) > 0))
        throw new Error("กรุณาใส่ความยาวอย่างน้อย 1 วงจร");
      const fitModel = hasProfile(c.ip) ? profileModel(c.profileModel) : null;
      const bad = fitModel ? fitProblem(fitModel, c.pcbMm ?? null) : null;
      if (bad) throw new Error(bad);
      if (c.show.psu && !c.psuOptions.length)
        throw new Error(`ไม่มีหม้อแปลงแบบ ${c.dim} ในหมวด Power supply — ดูรายละเอียดใต้หัวข้อ "หม้อแปลง"`);
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
      const recipes = built.rows.flatMap((r) =>
        r.recipes.map((x) => ({ ...x, quote_line_id: r.id })),
      );
      if (recipes.length) {
        const { error } = await supabase.from("line_recipes").insert(recipes);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "อัปเดตชุดไฟเส้นแล้ว" : "เพิ่มชุดไฟเส้นแล้ว");
      qc.invalidateQueries({ queryKey: ["quote_lines", quotationId] });
      qc.invalidateQueries({ queryKey: ["line_recipes"] });
      qc.invalidateQueries({ queryKey: ["boq_costs"] });
      qc.invalidateQueries({ queryKey: ["set_lines"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const profileOn = c ? hasProfile(c.ip) : false;
  const model = c && profileOn ? profileModel(c.profileModel) : null;
  const rail = c ? railNeeded(model, !!c.ezClip) : null;
  const railFit = rail ? groups.heatsinks.filter((s) => railOf(s) === rail) : [];
  const railChoices = railFit.length ? railFit : groups.heatsinks;
  // profiles the LED fits in (PCB width); unrecognised ones stay selectable
  const tooWide = c
    ? groups.profiles.filter((s) => {
        const m = profileModelOfSku(s);
        return !!m && !!fitProblem(m, c.pcbMm ?? null);
      })
    : [];
  const profileChoices = groups.profiles.filter((s) => !tooWide.includes(s));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "แก้ชุดไฟเส้น" : "เพิ่มชุดไฟเส้น (LED linear)"}</DialogTitle>
        </DialogHeader>
        {!c ? (
          <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1fr_420px]">
            <div className="space-y-5">
              <Block title="1. ไฟรุ่นไหน สีอะไร">
                <div className="grid gap-2 sm:grid-cols-[100px_1fr_100px]">
                  <Field label="รหัสแบบ">
                    <Input
                      value={c.typeCode}
                      placeholder="LTJ2"
                      onChange={(e) => set({ typeCode: e.target.value.toUpperCase() })}
                    />
                  </Field>
                  <Field label="LED ที่เบิกจริง">
                    <SkuSelect
                      value={c.ledSkuId}
                      preferred={groups.leds}
                      category="LED ribbon"
                      all={skus ?? []}
                      onChange={(id) => {
                        const s = byId.get(id);
                        setP({
                          ledSkuId: id,
                          ledName: s ? s.name.toUpperCase() : c.ledName,
                          wattPerM: wattPerMOf(s) ?? c.wattPerM,
                          chip: chipOf(s),
                          pcbMm: pcbOf(s),
                          ezClip: usesEzClip(s),
                          jediPct: null,
                        });
                      }}
                    />
                  </Field>
                  <Field label="วัตต์/เมตร">
                    <Input
                      inputMode="decimal"
                      value={c.wattPerM ? String(c.wattPerM) : ""}
                      onChange={(e) => set({ wattPerM: toNumber(e.target.value) ?? 0 })}
                    />
                  </Field>
                </div>
                <div className="mt-2">
                  <Field label="ชื่อที่ลูกค้าเห็น (ชื่อขาย)">
                    <Input value={c.ledName} onChange={(e) => set({ ledName: e.target.value })} />
                  </Field>
                </div>
                <LedFacts c={c} />
              </Block>

              <Block title="2. IP และระบบดิม">
                <div className="flex flex-wrap gap-2">
                  {IP_RATINGS.map((ip) => (
                    <Choice key={ip} on={c.ip === ip} onClick={() => setP({ ip: ip as IpRating })}>
                      {ip}
                    </Choice>
                  ))}
                  <span className="self-center text-xs text-muted-foreground">{IP_HELP[c.ip]}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {DIM_TYPES.map((d) => (
                    <Choice key={d} on={c.dim === d} onClick={() => set({ dim: d as DimType })}>
                      {d}
                    </Choice>
                  ))}
                </div>
              </Block>

              <Block title="3. อุปกรณ์">
                <div className="grid gap-2 text-sm">
                  <Row label={rail ? `ราง alu. (${rail}")` : "ราง alu. (heat sink)"}>
                    <SkuSelect
                      value={c.heatsinkSkuId}
                      preferred={railChoices}
                      category={rail ? `LED heat sink ขนาด ${rail}` : "LED heat sink"}
                      all={skus ?? []}
                      onChange={(id) => set({ heatsinkSkuId: id || null })}
                      noneLabel="— ไม่ใช้ —"
                    />
                  </Row>
                  {isDoubleJacket(c.ip) ? (
                    <Row label="Double jacket">
                      <SkuSelect
                        value={c.doubleJacketSkuId}
                        preferred={groups.doubleJackets.length ? groups.doubleJackets : groups.jackets}
                        category="LED jacket"
                        all={skus ?? []}
                        onChange={(id) => set({ doubleJacketSkuId: id || null })}
                      />
                    </Row>
                  ) : (
                    <Row label="Single jacket">
                      <SkuSelect
                        value={c.singleJacketSkuId}
                        preferred={groups.singleJackets.length ? groups.singleJackets : groups.jackets}
                        category="LED jacket"
                        all={skus ?? []}
                        onChange={(id) => set({ singleJacketSkuId: id || null })}
                      />
                    </Row>
                  )}
                  {profileOn ? (
                    <>
                      <Row label="Profile ที่เบิก">
                        <SkuSelect
                          value={c.profileSkuId}
                          preferred={profileChoices}
                          category="LED profile"
                          all={skus ?? []}
                          onChange={(id) => setP({ profileSkuId: id || null, jediPct: null })}
                        />
                        {model ? null : c.profileSkuId ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            SKU นี้ยังไม่ได้ตั้งรุ่น profile ที่หน้า SKU — จึงไม่มีขนาดรวมและ Jedi %
                          </p>
                        ) : null}
                        {model && fitProblem(model, c.pcbMm ?? null) ? (
                          <p className="mt-1 text-xs font-medium text-destructive">
                            {fitProblem(model, c.pcbMm ?? null)} — เลือก profile อื่น
                          </p>
                        ) : tooWide.length ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            ซ่อน {tooWide.length} รุ่นที่แผ่นปริ้น {c.pcbMm} มม. ใส่ไม่ได้ (V2 W13 / 45° Reverse)
                          </p>
                        ) : null}
                      </Row>
                      {model ? (
                        <>
                          <Row label="การยึด">
                            <div className="flex flex-wrap gap-1.5">
                              {model.mounts.map((x) => (
                                <Choice key={x} on={c.mount === x} onClick={() => setP({ mount: x })}>
                                  {x === "SILICONE" ? "Silicone (ไม่มี mounting)" : x.charAt(0) + x.slice(1).toLowerCase()}
                                </Choice>
                              ))}
                            </div>
                          </Row>
                          {model.hasTrim ? (
                            <Row label="Trim">
                              <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                  checked={!!c.trim}
                                  onCheckedChange={(v) => setP({ trim: v === true })}
                                />
                                มีขอบ trim (ขนาดรวมกว้างขึ้น)
                              </label>
                            </Row>
                          ) : null}
                          <Row label="Diffuser">
                            <div className="flex flex-wrap gap-1.5">
                              {DIFFUSERS.map((x) => (
                                <Choice
                                  key={x}
                                  on={(c.diffuser ?? "JEDI") === x}
                                  onClick={() => setP({ diffuser: x })}
                                >
                                  {x.charAt(0) + x.slice(1).toLowerCase()}
                                </Choice>
                              ))}
                            </div>
                          </Row>
                          <Row label="สรุป">
                            <ProfileSummary c={c} onJedi={(v) => set({ jediPct: v })} />
                          </Row>
                        </>
                      ) : null}
                      <Row label={model ? "ชื่อ profile ในใบ (สร้างให้ แก้ได้)" : "ชื่อ profile ในใบ"}>
                        <Input
                          value={c.profileName}
                          onChange={(e) => set({ profileName: e.target.value })}
                        />
                      </Row>
                      {c.profileExtras.map((x, i) => (
                        <Row key={i} label={i === 0 ? "อุปกรณ์ profile" : ""}>
                          <div className="flex gap-2">
                            <SkuSelect
                              value={x.skuId}
                              preferred={groups.profileExtras}
                              category="LED profile / LED accessory"
                              all={skus ?? []}
                              onChange={(id) =>
                                set({
                                  profileExtras: c.profileExtras.map((e, j) =>
                                    j === i ? { ...e, skuId: id } : e,
                                  ),
                                })
                              }
                            />
                            <Input
                              className="w-16"
                              value={String(x.perM)}
                              title="จำนวนต่อเมตร"
                              onChange={(e) =>
                                set({
                                  profileExtras: c.profileExtras.map((ex, j) =>
                                    j === i ? { ...ex, perM: toNumber(e.target.value) ?? 0 } : ex,
                                  ),
                                })
                              }
                            />
                            <span className="self-center text-xs text-muted-foreground">/ม.</span>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                set({ profileExtras: c.profileExtras.filter((_, j) => j !== i) })
                              }
                            >
                              ลบ
                            </Button>
                          </div>
                        </Row>
                      ))}
                      <Row label="">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            set({ profileExtras: [...c.profileExtras, { skuId: "", perM: 1 }] })
                          }
                        >
                          + อุปกรณ์ profile (diffuser, clip…)
                        </Button>
                      </Row>
                      <Row label="สี profile">
                        <div className="flex flex-wrap items-center gap-2">
                          <Choice on={!c.color} onClick={() => set({ color: "" })}>
                            ไม่ทำสี
                          </Choice>
                          {COLORS.map((x) => (
                            <Choice key={x} on={c.color === x} onClick={() => set({ color: x })}>
                              {x}
                            </Choice>
                          ))}
                          <Input
                            className="h-8 w-32"
                            placeholder="สีอื่น"
                            value={COLORS.includes(c.color) ? "" : c.color}
                            onChange={(e) => set({ color: e.target.value.toUpperCase() })}
                          />
                        </div>
                      </Row>
                      {c.color ? (
                        <Row label="ค่าทำสี (ราคา/ม.)">
                          <SkuSelect
                            value={c.paintSkuId}
                            preferred={groups.paints}
                            category="Service"
                            all={skus ?? []}
                            onChange={(id) => set({ paintSkuId: id || null })}
                          />
                        </Row>
                      ) : null}
                    </>
                  ) : null}
                  <Row label="หม้อแปลง">
                    <PsuInfo
                      dim={c.dim}
                      options={c.psuOptions}
                      report={groups.psuReport(c.dim)}
                      total={groups.psus.length}
                    />
                  </Row>
                </div>
              </Block>

              <Block title="4. วงจรและความยาว">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="w-28 pb-1 font-medium">CKT. NO.</th>
                      <th className="pb-1 font-medium">ความยาวแต่ละท่อน (ม.) เช่น 0.70+0.70</th>
                      <th className="w-16 pb-1 text-right font-medium">รวม ม.</th>
                      <th className="w-16 pb-1 text-right font-medium">วัตต์</th>
                      <th className="w-24 pb-1 text-right font-medium">หม้อแปลง</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {c.circuits.map((k, i) => {
                      const L = circuitLength(k);
                      const W = L * c.wattPerM;
                      const psu = pickPsu(W, c.psuOptions, c.loadFactor);
                      return (
                        <tr key={i}>
                          <td className="py-1 pr-2">
                            <Input
                              value={k.ckt}
                              placeholder="ไม่แสดง"
                              title="ไม่ใส่เลขวงจร = ไม่แสดงบรรทัด CKT. NO."
                              onChange={(e) =>
                                set({
                                  circuits: c.circuits.map((x, j) =>
                                    j === i ? { ...x, ckt: e.target.value.toUpperCase() } : x,
                                  ),
                                })
                              }
                            />
                          </td>
                          <td className="py-1 pr-2">
                            <Input
                              value={lenText[i] ?? ""}
                              placeholder="3.20"
                              onChange={(e) => {
                                const t = [...lenText];
                                t[i] = e.target.value;
                                setLenText(t);
                                set({
                                  circuits: c.circuits.map((x, j) =>
                                    j === i ? { ...x, lengths: parseLengths(e.target.value) } : x,
                                  ),
                                });
                              }}
                            />
                          </td>
                          <td className="py-1 text-right tabular-nums">{L ? formatQty(L) : "—"}</td>
                          <td className="py-1 text-right tabular-nums">
                            {W ? formatQty(Math.round(W * 10) / 10) : "—"}
                          </td>
                          <td className="py-1 text-right text-xs">
                            {psu ? `${psu.count} × ${psu.watt}W` : "—"}
                          </td>
                          <td className="py-1 text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2"
                              disabled={c.circuits.length === 1}
                              onClick={() => {
                                set({ circuits: c.circuits.filter((_, j) => j !== i) });
                                setLenText(lenText.filter((_, j) => j !== i));
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
                  size="sm"
                  variant="outline"
                  className="mt-1"
                  onClick={() => {
                    set({ circuits: [...c.circuits, { ckt: "", lengths: [] }] });
                    setLenText([...lenText, ""]);
                  }}
                >
                  + เพิ่มวงจร
                </Button>
              </Block>
            </div>

            <div className="space-y-4">
              <Block title="แสดงราคาแยกแต่ละรายการ">
                <div className="grid grid-cols-2 gap-1.5 text-sm">
                  <Tick on disabled label="LED (ความยาว)" />
                  <Tick
                    on={c.show.heatsink}
                    label="Heat sink & jacket"
                    onChange={(v) => set({ show: { ...c.show, heatsink: v } })}
                  />
                  {profileOn ? (
                    <Tick
                      on={c.show.profile}
                      label="Profile"
                      onChange={(v) => set({ show: { ...c.show, profile: v } })}
                    />
                  ) : null}
                  {profileOn && c.color ? (
                    <Tick
                      on={c.show.paint}
                      label="ทำสี"
                      onChange={(v) => set({ show: { ...c.show, paint: v } })}
                    />
                  ) : null}
                  <Tick
                    on={c.show.psu}
                    label="หม้อแปลง"
                    onChange={(v) => set({ show: { ...c.show, psu: v } })}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  ไม่ติ๊ก = ยังแสดงชื่อรายการในใบ แต่ไม่แสดงจำนวนและราคา (รวมราคาเข้าบรรทัด LED) ·
                  เบิกของตามปกติ
                </p>
              </Block>

              <Block title="ลูกค้าจะเห็น">
                <div className="max-h-80 overflow-y-auto rounded bg-secondary p-2 text-xs">
                  <div className="mb-1 grid grid-cols-[110px_1fr] gap-2">
                    <Input
                      className="h-7 text-xs"
                      placeholder="Option (ถ้ามี)"
                      value={option}
                      onChange={(e) => setOption(e.target.value)}
                    />
                    <Input
                      className="h-7 text-xs"
                      placeholder="โซน เช่น BEDROOM 01"
                      value={zone}
                      onChange={(e) => setZone(e.target.value.toUpperCase())}
                    />
                  </div>
                  {zone ? <div className="font-bold">{zone}</div> : null}
                  {(built?.rows ?? []).map((r) => (
                    <div
                      key={r.id}
                      className={"flex gap-2 " + (r.kind === "heading" ? "pt-1 font-semibold" : "")}
                    >
                      <span className="flex-1">{r.customer_text}</span>
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
                    ยังไม่มีราคาขายของ{" "}
                    {built.missing.map((id) => byId.get(id)?.code ?? id).join(", ")} —{" "}
                    {canSeeCost
                      ? "ตั้งราคาที่หน้าทะเบียน SKU (เมนู สต็อก)"
                      : "ติดต่อ admin ให้ตั้งราคา"}
                  </p>
                ) : built ? (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-baseline justify-between">
                      <span className="text-muted-foreground">ราคาเต็มทั้งชุด</span>
                      <span className="text-base font-semibold tabular-nums">
                        {formatTHB(built.list)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        ส่วนลด (สูงสุด {built.maxDiscount}%)
                      </span>
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
                    {tooHigh ? (
                      <p className="text-xs text-destructive">ลดได้ไม่เกิน {built.maxDiscount}%</p>
                    ) : null}
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
            {save.isPending ? "กำลังบันทึก..." : "บันทึกชุดไฟเส้น"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Choice({
  on,
  onClick,
  disabled,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        "h-8 rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-40 " +
        (on
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background hover:bg-secondary")
      }
    >
      {children}
    </button>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[130px_1fr]">
      <span className="text-sm font-medium">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Tick({
  on,
  label,
  onChange,
  disabled,
}: {
  on: boolean;
  label: string;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={"flex items-center gap-2 " + (disabled ? "opacity-60" : "")}>
      <Checkbox checked={on} disabled={disabled} onCheckedChange={(v) => onChange?.(v === true)} />
      {label}
    </label>
  );
}

function PsuInfo({
  dim,
  options,
  report,
  total,
}: {
  dim: DimType;
  options: { watt: number }[];
  report: { skipped: PsuSkip[] };
  total: number;
}) {
  const problems = report.skipped.filter((x) => !x.reason.startsWith("เป็น "));
  return (
    <div className="text-xs text-muted-foreground">
      {options.length ? (
        <>
          คำนวณต่อวงจร โหลด ≤ 80% จาก: {options.map((o) => `${o.watt}W`).join(", ")} ({dim})
        </>
      ) : (
        <span className="text-destructive">
          {total
            ? `ไม่มีหม้อแปลง ${dim} ที่ใช้ได้ในหมวด Power supply`
            : "ยังไม่มีสินค้าในหมวด Power supply — ตั้งหมวดที่หน้า SKU"}
        </span>
      )}
      {(options.length ? problems : report.skipped).length ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {(options.length ? problems : report.skipped).map((x) => (
            <li key={x.id}>
              <span className="font-mono">{x.code}</span> — {x.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Overall size, rail size and Jedi % of the chosen profile; Jedi % can be typed over. */
function ProfileSummary({
  c,
  onJedi,
}: {
  c: LinearConfig;
  onJedi: (v: number | null) => void;
}) {
  const model = profileModel(c.profileModel)!;
  const [w, h] = profileSize({
    model,
    mount: c.mount ?? "CLIP",
    trim: !!c.trim,
    diffuser: c.diffuser ?? "JEDI",
  });
  const table = jediPercent(model, c.wattPerM, c.chip ?? "STANDARD");
  const jedi = jediOf(c);
  return (
    <div className="space-y-1 text-sm">
      <div>
        ขนาดรวม <b>{w.toFixed(2)} × {h.toFixed(2)} มม.</b> · ราง alu. {railNeeded(model, !!c.ezClip)}"
      </div>
      {(c.diffuser ?? "JEDI") === "JEDI" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>
            Jedi <b>{jedi != null ? `${jedi}%` : "—"}</b>
          </span>
          <span className="text-xs text-muted-foreground">
            {table != null
              ? `ตามตาราง ${c.wattPerM}W/m ${c.chip === "NICHIA" ? "Nichia" : "Standard"} = ${table}%`
              : `ไม่มี ${c.wattPerM}W/m ${c.chip === "NICHIA" ? "Nichia" : "Standard"} ในตาราง — ใส่เอง`}
          </span>
          <label className="flex items-center gap-1 text-xs">
            แก้เป็น
            <Input
              className="h-7 w-14"
              inputMode="numeric"
              placeholder="auto"
              value={c.jediPct != null ? String(c.jediPct) : ""}
              onChange={(e) => onJedi(toNumber(e.target.value))}
            />
            %
          </label>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">ไม่ใช่ Jedi diffuser — ไม่แสดง Jedi %</div>
      )}
    </div>
  );
}

/** Chip / PCB / EZ clip of the chosen LED, as set on the SKU page (read-only here). */
function LedFacts({ c }: { c: LinearConfig }) {
  if (!c.ledSkuId) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>
        ชิป <b className="text-foreground">{c.chip === "NICHIA" ? "Nichia" : "Standard"}</b>
      </span>
      <span>
        แผ่นปริ้น <b className="text-foreground">{c.pcbMm != null ? `${c.pcbMm} มม.` : "ไม่ระบุ"}</b>
      </span>
      {c.ezClip ? <b className="text-foreground">ใช้ EZ clip (ราง 4/8)</b> : null}
      <span>· แก้ได้ที่หน้า SKU</span>
    </div>
  );
}
