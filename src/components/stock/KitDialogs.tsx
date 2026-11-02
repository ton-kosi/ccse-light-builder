import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatQty, toNumber } from "@/lib/format";
import { assembleNeeds, KIT_MODES, maxAssemble, type KitMode, type Part } from "@/lib/kits";

type Sku = { id: string; code: string; name: string; unit: string; kit_mode?: string | null };

export const kitPartsKey = (kitId: string) => ["sku_components", kitId] as const;

function useParts(kitId: string) {
  return useQuery({
    queryKey: kitPartsKey(kitId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sku_components")
        .select("component_sku_id, qty, note")
        .eq("kit_sku_id", kitId);
      if (error) {
        if (/sku_components|schema cache/i.test(error.message))
          throw new Error("ยังใช้สูตรประกอบไม่ได้ — ให้ Lovable รัน migration 0031_sku_kits ก่อน");
        throw error;
      }
      return data.map((p) => ({ component_sku_id: p.component_sku_id, qty: Number(p.qty), note: p.note ?? "" }));
    },
  });
}

/** Edit a SKU's parts list (สูตรประกอบ) and how it is used. Saving replaces the whole list. */
export function KitEditDialog({ sku, skus, onClose }: { sku: Sku; skus: Sku[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: saved, error, isLoading } = useParts(sku.id);
  const [mode, setMode] = useState<KitMode>((sku.kit_mode as KitMode) || "none");
  const [rows, setRows] = useState<{ component_sku_id: string; qty: string; note: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const list =
    rows ?? (saved ?? []).map((p) => ({ component_sku_id: p.component_sku_id, qty: String(p.qty), note: p.note }));
  const options = skus.filter((k) => k.id !== sku.id);
  const byId = new Map(skus.map((k) => [k.id, k]));
  const set = (i: number, patch: Partial<(typeof list)[number]>) =>
    setRows(list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    const clean = list
      .filter((r) => r.component_sku_id)
      .map((r) => ({ component_sku_id: r.component_sku_id, qty: toNumber(r.qty), note: r.note.trim() || null }));
    const problem = clean.some((r) => !r.qty || r.qty <= 0)
      ? "จำนวนต่อชุดต้องมากกว่า 0"
      : new Set(clean.map((r) => r.component_sku_id)).size !== clean.length
        ? "มีชิ้นส่วนซ้ำ — รวมเป็นบรรทัดเดียว"
        : mode !== "none" && !clean.length
          ? "ใส่ชิ้นส่วนอย่างน้อย 1 รายการ"
          : null;
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      const { error: e1 } = await supabase.from("skus").update({ kit_mode: mode }).eq("id", sku.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("sku_components").delete().eq("kit_sku_id", sku.id);
      if (e2) throw e2;
      if (clean.length) {
        const { error: e3 } = await supabase
          .from("sku_components")
          .insert(clean.map((r) => ({ kit_sku_id: sku.id, component_sku_id: r.component_sku_id, qty: r.qty!, note: r.note })));
        if (e3) throw e3;
      }
      toast.success(`บันทึกสูตรประกอบ ${sku.code} แล้ว`);
      qc.invalidateQueries({ queryKey: kitPartsKey(sku.id) });
      qc.invalidateQueries({ queryKey: ["skus"] });
      qc.invalidateQueries({ queryKey: ["material_demand"] });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            สูตรประกอบ — <span className="font-mono">{sku.code}</span>
          </DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              {KIT_MODES.map((m) => (
                <label
                  key={m.value}
                  className={
                    "cursor-pointer rounded-md border p-2 " +
                    (mode === m.value ? "border-primary bg-primary/5" : "border-border")
                  }
                >
                  <div className="flex items-center gap-2 font-medium">
                    <input type="radio" checked={mode === m.value} onChange={() => setMode(m.value)} />
                    {m.label}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{m.hint}</div>
                </label>
              ))}
            </div>
            {mode !== "none" ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold">
                  ชิ้นส่วนต่อ 1 {sku.unit} {isLoading ? "(กำลังโหลด…)" : ""}
                </div>
                {list.map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <select
                      className="h-9 min-w-56 flex-1 rounded-md border border-input bg-background px-2"
                      value={r.component_sku_id}
                      onChange={(e) => set(i, { component_sku_id: e.target.value })}
                    >
                      <option value="">— เลือกชิ้นส่วน —</option>
                      {options.map((k) => (
                        <option key={k.id} value={k.id}>
                          {k.code} — {k.name}
                        </option>
                      ))}
                    </select>
                    <Input
                      className="w-24"
                      inputMode="decimal"
                      value={r.qty}
                      placeholder="จำนวน"
                      onChange={(e) => set(i, { qty: e.target.value })}
                    />
                    <span className="w-10 text-xs text-muted-foreground">{byId.get(r.component_sku_id)?.unit ?? ""}</span>
                    <Input
                      className="w-40"
                      value={r.note}
                      placeholder="หมายเหตุ"
                      onChange={(e) => set(i, { note: e.target.value })}
                    />
                    <Button size="sm" variant="ghost" onClick={() => setRows(list.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRows([...list, { component_sku_id: "", qty: "1", note: "" }])}
                >
                  + เพิ่มชิ้นส่วน
                </Button>
                {mode === "phantom" ? (
                  <p className="text-xs text-muted-foreground">
                    ใบเสนอราคา / ใบงานที่ใช้ {sku.code} จะเบิกและสั่งซื้อเป็นชิ้นส่วนเหล่านี้แทน
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    กด “ประกอบ” ในหน้า SKU เมื่อประกอบเสร็จ — ระบบตัดชิ้นส่วนออกและเพิ่ม {sku.code} เข้าสต็อก
                  </p>
                )}
              </div>
            ) : null}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={save} disabled={busy || !!error}>
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** ประกอบเข้าสต็อก: shows parts needed vs on hand, then moves stock in one step. */
export function AssembleDialog({ sku, skus, onClose }: { sku: Sku; skus: Sku[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: parts, error } = useParts(sku.id);
  const ids = (parts ?? []).map((p) => p.component_sku_id);
  const { data: onHand } = useQuery({
    queryKey: ["sku_on_hand", "kit", sku.id, ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("sku_on_hand").select("sku_id, on_hand").in("sku_id", ids);
      if (error) throw error;
      return new Map(data.map((r) => [r.sku_id ?? "", Number(r.on_hand ?? 0)]));
    },
  });
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const n = toNumber(qty) ?? 0;
  const byId = new Map(skus.map((k) => [k.id, k]));
  const list: Part[] = (parts ?? []).map((p) => ({ component_sku_id: p.component_sku_id, qty: p.qty }));
  const needs = assembleNeeds(list, n, onHand ?? new Map());
  const short = needs.some((r) => r.short > 0);

  const run = async () => {
    if (!(n > 0)) {
      toast.error("ใส่จำนวนที่ประกอบเสร็จ");
      return;
    }
    setBusy(true);
    try {
      const { error: e } = await supabase.rpc("assemble_kit", {
        _kit_sku_id: sku.id,
        _qty: n,
        ...(note.trim() ? { _note: note.trim() } : {}),
      });
      if (e) throw e;
      toast.success(`ประกอบ ${sku.code} × ${formatQty(n)} เข้าสต็อกแล้ว`);
      ["sku_on_hand", "stock_movements", "material_demand"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            ประกอบเข้าสต็อก — <span className="font-mono">{sku.code}</span>
          </DialogTitle>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label htmlFor="asm-qty" className="text-xs text-muted-foreground">
                  ประกอบเสร็จ ({sku.unit})
                </label>
                <Input id="asm-qty" inputMode="decimal" className="w-28" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="text-xs text-muted-foreground">
                ของที่มีพอประกอบได้ {formatQty(maxAssemble(list, onHand ?? new Map()))} {sku.unit}
              </div>
            </div>
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1">ชิ้นส่วน</th>
                  <th className="text-right">ต่อชิ้น</th>
                  <th className="text-right">ใช้</th>
                  <th className="text-right">มีอยู่</th>
                </tr>
              </thead>
              <tbody>
                {needs.map((r) => {
                  const k = byId.get(r.component_sku_id);
                  return (
                    <tr key={r.component_sku_id} className="border-t border-border">
                      <td className="py-1">
                        <span className="font-mono">{k?.code}</span> {k?.name}
                      </td>
                      <td className="text-right tabular-nums">{formatQty(r.perKit)}</td>
                      <td className="text-right tabular-nums">{formatQty(r.need)}</td>
                      <td className={"text-right tabular-nums " + (r.short ? "font-semibold text-destructive" : "")}>
                        {formatQty(r.onHand)}
                        {r.short ? ` (ขาด ${formatQty(r.short)})` : ""}
                      </td>
                    </tr>
                  );
                })}
                {!needs.length ? (
                  <tr>
                    <td colSpan={4} className="py-2 text-muted-foreground">
                      ยังไม่มีสูตรประกอบ — ตั้งที่ปุ่ม “สูตร”
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            {short ? (
              <p className="rounded-md border border-warning/50 bg-warning/10 p-2 text-xs">
                ชิ้นส่วนในระบบไม่พอ — ถ้าประกอบเสร็จจริงแล้ว บันทึกได้ (ยอดชิ้นส่วนจะติดลบ ให้ตรวจนับภายหลัง)
              </p>
            ) : null}
            <Input value={note} placeholder="หมายเหตุ เช่น ล็อตวันที่ / ผู้ประกอบ" onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={run} disabled={busy || !!error || !needs.length || !(n > 0)}>
            บันทึกประกอบเสร็จ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
