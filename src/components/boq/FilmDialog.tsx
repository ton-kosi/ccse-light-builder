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
import { SKU_OPTIONS_KEY } from "@/lib/skuCategory";
import {
  BUSBARS,
  buildFilm,
  calcOf,
  filmSkuGroups,
  pieceOk,
  sizeProblem,
  transformersFor,
  transformerWatt,
  type Busbar,
  type FilmConfig,
  type FilmPiece,
  type Status,
} from "@/lib/film";
import { formatQty, formatTHB, toNumber } from "@/lib/format";
import { useSkuPrices } from "@/lib/skuPrices";

export type FilmTarget =
  | { mode: "new"; option: string | null }
  | { mode: "edit"; config: FilmConfig; option: string | null; zone: string | null; discount: number };

const newPiece = (): FilmPiece => ({ w: 0, h: 0, qty: 1, busbar: "", calcW: null, calcH: null });
const sel = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

export function FilmDialog({
  target,
  quotationId,
  canSeeCost,
  replaceRows,
  onClose,
}: {
  target: FilmTarget;
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
  const g = useMemo(() => filmSkuGroups(skus ?? []), [skus]);
  const byId = useMemo(() => new Map((skus ?? []).map((s) => [s.id, s])), [skus]);

  const [c, setC] = useState<FilmConfig | null>(editing?.config ?? null);
  const [option, setOption] = useState(target.option ?? "");
  const [zone, setZone] = useState(editing?.zone ?? "");
  const [disc, setDisc] = useState(editing ? String(editing.discount) : "0");
  const [cells, setCells] = useState<Record<string, string>>({});

  useEffect(() => {
    if (c || !skus) return;
    const tr = g.transformers[0];
    setC({
      v: 1,
      blockId: crypto.randomUUID().slice(0, 8),
      code: "",
      title: "PRIVACY FILM",
      filmSkuId: g.films[0]?.id ?? "",
      maxW: 1.5,
      maxH: 3,
      wattPerM2: 10,
      showBusbar: true,
      locations: [{ name: "", pieces: [newPiece()] }],
      transformer: { mode: "priced", skuId: tr?.id ?? null, watt: transformerWatt(tr) ?? 100, text: "TRANSFORMER", loadFactor: 0.8 },
      wiring: "by_buyer",
      install: { mode: "priced", price: 0, text: "INSTALLATION FEE" },
      rowIds: [],
    });
  }, [c, skus, g]);

  const set = (p: Partial<FilmConfig>) => setC((o) => (o ? { ...o, ...p } : o));
  const setLoc = (li: number, p: Partial<FilmConfig["locations"][number]>) =>
    setC((o) => (o ? { ...o, locations: o.locations.map((l, i) => (i === li ? { ...l, ...p } : l)) } : o));
  const setPiece = (li: number, pi: number, p: Partial<FilmPiece>) =>
    setC((o) =>
      o
        ? {
            ...o,
            locations: o.locations.map((l, i) =>
              i === li ? { ...l, pieces: l.pieces.map((x, j) => (j === pi ? { ...x, ...p } : x)) } : l,
            ),
          }
        : o,
    );
  const cell = (key: string, value: number | null | undefined) => cells[key] ?? (value ? String(value) : "");
  const num = (key: string, apply: (n: number | null) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setCells((x) => ({ ...x, [key]: e.target.value }));
    apply(toNumber(e.target.value));
  };

  const built = useMemo(() => (c && prices ? buildFilm(c, prices, () => crypto.randomUUID()) : null), [c, prices]);
  const discNum = toNumber(disc) ?? 0;
  const tooHigh = !!built && discNum > built.maxDiscount + 1e-9;
  const net = built ? Math.round(built.list * (1 - discNum / 100) * 100) / 100 : 0;

  const save = useMutation({
    mutationFn: async () => {
      if (!c || !built) throw new Error("ยังโหลดข้อมูลไม่เสร็จ");
      if (!c.filmSkuId) throw new Error("เลือกฟิล์ม");
      if (!built.rows.some((r) => r.kind === "priced" && r.recipes.length)) throw new Error("ใส่ขนาดฟิล์มอย่างน้อย 1 แผ่น");
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
      toast.success(editing ? "อัปเดตชุด Privacy film แล้ว" : "เพิ่มชุด Privacy film แล้ว");
      ["line_recipes", "boq_costs", "set_lines"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      qc.invalidateQueries({ queryKey: ["quote_lines", quotationId] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const status = (v: Status, on: Status, label: string, onClick: () => void) => (
    <Choice key={v} on={on === v} onClick={onClick}>
      {label}
    </Choice>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[94vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "แก้ชุด Privacy film" : "เพิ่มชุด Privacy film"}</DialogTitle>
        </DialogHeader>
        {!c ? (
          <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
            <div className="space-y-5">
              <Block title="1. ฟิล์ม">
                <div className="grid gap-2 text-sm">
                  <Row label="รหัสแบบ · ชื่อ">
                    <div className="flex gap-2">
                      <Input className="w-28" placeholder="GL 01" value={c.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
                      <Input value={c.title} onChange={(e) => set({ title: e.target.value.toUpperCase() })} />
                    </div>
                  </Row>
                  <Row label="ฟิล์มที่ใช้">
                    <SkuSelect
                      value={c.filmSkuId}
                      preferred={g.films}
                      category="Smart film"
                      all={skus ?? []}
                      onChange={(id) => set({ filmSkuId: id })}
                    />
                  </Row>
                  <Row label="แผ่นใหญ่สุด">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Input className="h-8 w-16" inputMode="decimal" value={cell("maxW", c.maxW)} onChange={num("maxW", (n) => set({ maxW: n ?? 0 }))} />
                      ×
                      <Input className="h-8 w-16" inputMode="decimal" value={cell("maxH", c.maxH)} onChange={num("maxH", (n) => set({ maxH: n ?? 0 }))} />
                      ม. · ไฟ
                      <Input className="h-8 w-14" inputMode="decimal" value={cell("wpm2", c.wattPerM2)} onChange={num("wpm2", (n) => set({ wattPerM2: n ?? 0 }))} />
                      W/ตร.ม.
                    </div>
                  </Row>
                </div>
              </Block>

              <Block title="2. ตำแหน่งและขนาดแผ่น (ขนาดตัด กว้าง × สูง)">
                <label className="mb-2 flex items-center gap-2 text-sm">
                  <Checkbox checked={c.showBusbar} onCheckedChange={(v) => set({ showBusbar: v === true })} />
                  แสดงตำแหน่ง busbar ในใบเสนอราคา
                </label>
                <div className="space-y-3">
                  {c.locations.map((loc, li) => (
                    <div key={li} className="rounded-md border border-border p-2">
                      <div className="mb-1 flex gap-2">
                        <Input
                          placeholder="ชื่อตำแหน่ง เช่น RECEPTION (OFFICE ROOM) — ว่าง = ใช้ชื่อฟิล์ม"
                          value={loc.name}
                          onChange={(e) => setLoc(li, { name: e.target.value.toUpperCase() })}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setCells({});
                            set({ locations: c.locations.length > 1 ? c.locations.filter((_, i) => i !== li) : [{ name: "", pieces: [newPiece()] }] });
                          }}
                        >
                          ลบตำแหน่ง
                        </Button>
                      </div>
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs text-muted-foreground">
                          <tr>
                            <th className="w-16 pb-1 font-medium">กว้าง</th>
                            <th className="w-16 pb-1 font-medium">สูง</th>
                            <th className="w-12 pb-1 font-medium">แผ่น</th>
                            <th className="pb-1 font-medium">busbar</th>
                            <th className="w-32 pb-1 font-medium" title="ปกติ = ขนาดตัด">คิดเงิน ก × ส</th>
                            <th className="w-16 pb-1 text-right font-medium">ตร.ม.</th>
                            <th className="w-8" />
                          </tr>
                        </thead>
                        <tbody>
                          {loc.pieces.map((p, pi) => {
                            const k = `${li}-${pi}`;
                            const [cw, ch] = calcOf(p);
                            const bad = pieceOk(p) && !!sizeProblem(p, c.maxW, c.maxH);
                            return (
                              <tr key={pi} className="align-top">
                                <td className="py-1 pr-1">
                                  <Input className={bad ? "border-destructive" : ""} inputMode="decimal" value={cell(`w${k}`, p.w)} onChange={num(`w${k}`, (n) => setPiece(li, pi, { w: n ?? 0 }))} />
                                </td>
                                <td className="py-1 pr-1">
                                  <Input inputMode="decimal" value={cell(`h${k}`, p.h)} onChange={num(`h${k}`, (n) => setPiece(li, pi, { h: n ?? 0 }))} />
                                </td>
                                <td className="py-1 pr-1">
                                  <Input inputMode="numeric" value={cell(`q${k}`, p.qty)} onChange={num(`q${k}`, (n) => setPiece(li, pi, { qty: Math.max(0, Math.round(n ?? 0)) }))} />
                                </td>
                                <td className="py-1 pr-1">
                                  <select
                                    className={sel + (pieceOk(p) && !p.busbar ? " border-destructive" : "")}
                                    value={p.busbar}
                                    onChange={(e) => setPiece(li, pi, { busbar: e.target.value as Busbar | "" })}
                                  >
                                    <option value="">— เลือก —</option>
                                    {BUSBARS.map((b) => (
                                      <option key={b.value} value={b.value}>
                                        {b.label}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-1 pr-1">
                                  <div className="flex gap-1">
                                    <Input
                                      className="px-1.5"
                                      inputMode="decimal"
                                      placeholder={p.w ? String(p.w) : ""}
                                      value={cells[`cw${k}`] ?? (p.calcW ? String(p.calcW) : "")}
                                      onChange={num(`cw${k}`, (n) => setPiece(li, pi, { calcW: n }))}
                                    />
                                    <Input
                                      className="px-1.5"
                                      inputMode="decimal"
                                      placeholder={p.h ? String(p.h) : ""}
                                      value={cells[`ch${k}`] ?? (p.calcH ? String(p.calcH) : "")}
                                      onChange={num(`ch${k}`, (n) => setPiece(li, pi, { calcH: n }))}
                                    />
                                  </div>
                                </td>
                                <td className="py-1 text-right text-xs tabular-nums text-muted-foreground">
                                  {pieceOk(p) ? formatQty(Math.round(cw * ch * p.qty * 100) / 100) : "—"}
                                </td>
                                <td className="py-1 text-right">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setCells({});
                                      setLoc(li, { pieces: loc.pieces.length > 1 ? loc.pieces.filter((_, j) => j !== pi) : [newPiece()] });
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
                      {loc.pieces.map((p) => (pieceOk(p) ? sizeProblem(p, c.maxW, c.maxH) : null)).filter(Boolean).map((b, i) => (
                        <p key={i} className="text-xs text-destructive">
                          {b}
                        </p>
                      ))}
                      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                        <Button size="sm" variant="outline" onClick={() => setLoc(li, { pieces: [...loc.pieces, newPiece()] })}>
                          + เพิ่มขนาด
                        </Button>
                        หม้อแปลงตำแหน่งนี้ {transformersFor(loc, c)} ตัว
                      </div>
                    </div>
                  ))}
                </div>
                <Button className="mt-2" size="sm" variant="outline" onClick={() => set({ locations: [...c.locations, { name: "", pieces: [newPiece()] }] })}>
                  + เพิ่มตำแหน่ง
                </Button>
              </Block>

              <Block title="3. หม้อแปลง สายไฟ ค่าติดตั้ง">
                <div className="grid gap-2 text-sm">
                  <Row label="หม้อแปลง">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap gap-1.5">
                        {(
                          [
                            ["priced", "คิดราคา"],
                            ["existing", "ของเดิม (existing)"],
                            ["by_buyer", "ลูกค้าจัดหา"],
                            ["none", "ไม่ใส่"],
                          ] as [Status, string][]
                        ).map(([v, label]) =>
                          status(v, c.transformer.mode, label, () => set({ transformer: { ...c.transformer, mode: v } })),
                        )}
                      </div>
                      {c.transformer.mode !== "none" ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="min-w-56 flex-1">
                            <SkuSelect
                              value={c.transformer.skuId}
                              preferred={g.transformers}
                              category="Film transformer"
                              all={skus ?? []}
                              onChange={(id) =>
                                set({ transformer: { ...c.transformer, skuId: id || null, watt: transformerWatt(byId.get(id)) ?? c.transformer.watt } })
                              }
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {c.transformer.watt}W · โหลด 80% · รวม {built?.transformers ?? 0} ตัว
                          </span>
                        </div>
                      ) : null}
                    </div>
                  </Row>
                  <Row label="สายไฟ 220V + สวิตช์">
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          ["by_buyer", "ลูกค้าจัดหา"],
                          ["existing", "ของเดิม (existing)"],
                          ["none", "ไม่ใส่"],
                        ] as [Status, string][]
                      ).map(([v, label]) => status(v, c.wiring, label, () => set({ wiring: v })))}
                    </div>
                  </Row>
                  <Row label="ค่าติดตั้ง">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(
                        [
                          ["priced", "คิดราคา"],
                          ["included", "รวมแล้ว (INCLUDED)"],
                          ["none", "ไม่ใส่"],
                        ] as const
                      ).map(([v, label]) => (
                        <Choice key={v} on={c.install.mode === v} onClick={() => set({ install: { ...c.install, mode: v } })}>
                          {label}
                        </Choice>
                      ))}
                      {c.install.mode === "priced" ? (
                        <Input
                          className="h-8 w-28 text-right"
                          inputMode="decimal"
                          placeholder="บาท"
                          value={cell("inst", c.install.price)}
                          onChange={num("inst", (n) => set({ install: { ...c.install, price: n ?? 0 } }))}
                        />
                      ) : null}
                      {c.install.mode !== "none" ? (
                        <Input className="h-8 min-w-48 flex-1" value={c.install.text} onChange={(e) => set({ install: { ...c.install, text: e.target.value.toUpperCase() } })} />
                      ) : null}
                    </div>
                  </Row>
                </div>
              </Block>
            </div>

            <div className="space-y-5">
              <Block title="ลูกค้าจะเห็น">
                <div className="max-h-[28rem] overflow-y-auto rounded bg-secondary p-2 text-xs">
                  <div className="mb-1 grid grid-cols-[110px_1fr] gap-2">
                    <Input className="h-7 text-xs" placeholder="Option (ถ้ามี)" value={option} onChange={(e) => setOption(e.target.value)} />
                    <Input className="h-7 text-xs" placeholder="โซน เช่น 7th. FLR." value={zone} onChange={(e) => setZone(e.target.value.toUpperCase())} />
                  </div>
                  {zone ? <div className="font-bold">{zone}</div> : null}
                  {(built?.rows ?? []).map((r) => (
                    <div key={r.id} className={"flex gap-2 " + (r.kind === "heading" ? "pt-1 font-semibold" : "")}>
                      <span className="flex-1">{r.customer_text}</span>
                      {r.kind === "priced" ? (
                        <span className="whitespace-nowrap tabular-nums">
                          {formatQty(r.qty ?? 0)} {r.unit} @{formatTHB(r.unit_price ?? 0)}
                        </span>
                      ) : r.kind === "existing" || r.kind === "by_buyer" ? (
                        <span className="whitespace-nowrap italic">
                          {r.qty} {r.unit} {r.kind === "existing" ? "existing" : "by buyer"}
                        </span>
                      ) : null}
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
            {save.isPending ? "กำลังบันทึก..." : "บันทึกชุด Privacy film"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
