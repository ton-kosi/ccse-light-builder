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
import { buildCanoe, CANOE_SIZES, canoeLengths, runsFromSpec, type CanoeConfig, type CanoeSize } from "@/lib/canoe";
import { parseCutSpec } from "@/lib/cutSpec";
import { formatQty, formatTHB, toNumber } from "@/lib/format";
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

  const parsed = spec.trim() ? parseCutSpec(spec) : null;
  const specError = parsed && "error" in parsed ? parsed.error : null;
  // each side of a joined run [a+b] (L-shape, pool steps) gets its own pieces
  const runs = parsed && !("error" in parsed) ? runsFromSpec(parsed.runs) : [];
  const cfg: CanoeConfig = { ...c, runs, spec };
  const led = byId.get(c.ledSkuId);
  const built = useMemo(
    () => (prices ? buildCanoe(cfg, led, prices, () => crypto.randomUUID()) : null),
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
                <Row label="รหัสแบบ · ชื่อ">
                  <div className="flex gap-2">
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
                            {r.fit?.counts[k] || ""}
                          </td>
                        ))}
                        <td className="text-right tabular-nums">{r.fit ? `${formatQty(r.fit.totalM)} ม.` : "—"}</td>
                        <td className={"text-right tabular-nums " + (r.fit && !r.fit.ok ? "font-semibold text-destructive" : "")}>
                          {r.fit ? `${r.fit.diffM >= 0 ? "เหลือ" : "เกิน"} ${cm(Math.abs(r.fit.diffM))}` : ""}
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
                ระบบเลือกท่อนให้น้อยที่สุด โดยยาวเกินได้ไม่เกิน 5 ซม. และสั้นกว่าได้ไม่เกิน 10 ซม. · ช่วงที่ต่อกัน
                [a+b] เช่น มุม L หรือขั้นบันไดสระ คิดท่อนแยกทีละด้าน
              </p>
            </Block>

            <Block title="3. ตัวเรือน Canoe (ตัดสต็อกตามจำนวนท่อน)">
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
