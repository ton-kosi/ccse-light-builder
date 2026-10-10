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
  type IpRating,
  type LinearConfig,
} from "@/lib/linear";
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
    setC({
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
      profileSkuId: groups.profiles[0]?.id ?? null,
      profileName: groups.profiles[0] ? `${groups.profiles[0].name.toUpperCase()} w/ MOUNTING` : "",
      profileExtras: [],
      color: "",
      paintSkuId: groups.paints[0]?.id ?? null,
      psuOptions: groups.psuFor("DALI"),
      loadFactor: 0.8,
      show: { heatsink: true, profile: true, paint: true, psu: true },
      circuits: [{ ckt: "", lengths: [] }],
      rowIds: [],
    });
  }, [c, skus, groups]);

  // PSU choices always follow the dimming type
  useEffect(() => {
    if (!c || !skus) return;
    const opts = groups.psuFor(c.dim);
    if (JSON.stringify(opts) !== JSON.stringify(c.psuOptions)) setC({ ...c, psuOptions: opts });
  }, [c, skus, groups]);

  const set = (p: Partial<LinearConfig>) => setC((o) => (o ? { ...o, ...p } : o));
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
      if (c.show.psu && !c.psuOptions.length)
        throw new Error(`ไม่มีหม้อแปลงแบบ ${c.dim} ในทะเบียน SKU`);
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
                      all={skus ?? []}
                      onChange={(id) => {
                        const s = byId.get(id);
                        set({
                          ledSkuId: id,
                          ledName: s ? s.name.toUpperCase() : c.ledName,
                          wattPerM: wattPerMOf(s) ?? c.wattPerM,
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
              </Block>

              <Block title="2. IP และระบบดิม">
                <div className="flex flex-wrap gap-2">
                  {IP_RATINGS.map((ip) => (
                    <Choice key={ip} on={c.ip === ip} onClick={() => set({ ip: ip as IpRating })}>
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
                  <Row label="Heat sink">
                    <SkuSelect
                      value={c.heatsinkSkuId}
                      preferred={groups.heatsinks}
                      all={skus ?? []}
                      onChange={(id) => set({ heatsinkSkuId: id || null })}
                      noneLabel="— ไม่ใช้ —"
                    />
                  </Row>
                  {isDoubleJacket(c.ip) ? (
                    <Row label="Double jacket">
                      <SkuSelect
                        value={c.doubleJacketSkuId}
                        preferred={groups.doubleJackets}
                        all={skus ?? []}
                        onChange={(id) => set({ doubleJacketSkuId: id || null })}
                      />
                    </Row>
                  ) : (
                    <Row label="Single jacket">
                      <SkuSelect
                        value={c.singleJacketSkuId}
                        preferred={groups.singleJackets}
                        all={skus ?? []}
                        onChange={(id) => set({ singleJacketSkuId: id || null })}
                      />
                    </Row>
                  )}
                  {profileOn ? (
                    <>
                      <Row label="Profile">
                        <SkuSelect
                          value={c.profileSkuId}
                          preferred={groups.profiles}
                          all={skus ?? []}
                          onChange={(id) => {
                            const s = byId.get(id);
                            set({
                              profileSkuId: id || null,
                              profileName: s
                                ? `${s.name.toUpperCase()} w/ MOUNTING`
                                : c.profileName,
                            });
                          }}
                        />
                      </Row>
                      <Row label="ชื่อ profile ในใบ">
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
                              preferred={[]}
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
                            all={skus ?? []}
                            onChange={(id) => set({ paintSkuId: id || null })}
                          />
                        </Row>
                      ) : null}
                    </>
                  ) : null}
                  <Row label="หม้อแปลง">
                    <span className="text-xs text-muted-foreground">
                      {c.psuOptions.length
                        ? `คำนวณต่อวงจร โหลด ≤ 80% จาก: ${c.psuOptions.map((o) => `${o.watt}W`).join(", ")} (${c.dim})`
                        : `ไม่มีหม้อแปลง ${c.dim} ในทะเบียน SKU — ชื่อ SKU ต้องมีคำว่า power supply/PSU/driver, วัตต์ เช่น 75W และ ${c.dim === "NON-DIM" ? "ไม่มีคำว่า dim" : c.dim}`}
                    </span>
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

function Choice({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "h-8 rounded-md border px-3 text-sm " +
        (on
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background hover:bg-secondary")
      }
    >
      {children}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
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
