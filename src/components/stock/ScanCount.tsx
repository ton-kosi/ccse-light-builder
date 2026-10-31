import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ScanBox } from "@/components/scan/ScanBox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMe } from "@/hooks/useMe";
import { findByScan, withBarcode } from "@/lib/barcode";
import { formatQty, toNumber } from "@/lib/format";
import { countAdjustments } from "@/lib/stockCount";

type Sku = { id: string; code: string; name: string; unit: string; barcodes?: string[] | null };

export const SCAN_COUNT_NOTE = "ตรวจนับสต็อก (สแกน)";

/**
 * ตรวจนับด้วยสแกน: scan a shelf label or box → type what is there → the difference from the
 * system is posted as an adjustment (same rule as the CSV count). An unknown supplier barcode
 * can be linked to its SKU once, so the next scan finds it.
 */
export function ScanCount({ skus, onHand }: { skus: Sku[]; onHand: Map<string, number> }) {
  const qc = useQueryClient();
  const { me } = useMe();
  const [current, setCurrent] = useState<Sku | null>(null);
  const [pick, setPick] = useState<{ code: string; candidates: Sku[] } | null>(null);
  const [unknown, setUnknown] = useState<string | null>(null);
  const [linkTo, setLinkTo] = useState("");
  const [counted, setCounted] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ sku: Sku; system: number; counted: number }[]>([]);
  const qtyRef = useRef<HTMLInputElement>(null);

  const choose = (k: Sku) => {
    setCurrent(k);
    setPick(null);
    setUnknown(null);
    setCounted("");
    setTimeout(() => qtyRef.current?.focus(), 0);
  };

  const onScan = (code: string) => {
    const { match, candidates } = findByScan(skus, code);
    if (match) return choose(match);
    setCurrent(null);
    if (candidates.length) setPick({ code, candidates });
    else {
      setUnknown(code);
      setLinkTo("");
    }
  };

  const focusScan = () =>
    setTimeout(() => document.querySelector<HTMLInputElement>("[data-scan-count] input")?.focus(), 0);

  const save = async () => {
    if (!current) return;
    const qty = toNumber(counted);
    if (qty === null || qty < 0) {
      toast.error("ใส่จำนวนที่นับได้ (0 ขึ้นไป)");
      return;
    }
    if (!me?.userId) return;
    setBusy(true);
    try {
      const system = onHand.get(current.id) ?? 0;
      const moves = countAdjustments([{ skuId: current.id, qty }], onHand).map((m) => ({
        ...m,
        type: "adjust",
        note: SCAN_COUNT_NOTE,
        created_by: me.userId,
      }));
      if (moves.length) {
        const { error } = await supabase.from("stock_movements").insert(moves);
        if (error) throw error;
      }
      setDone((d) => [{ sku: current, system, counted: qty }, ...d.filter((x) => x.sku.id !== current.id)]);
      toast.success(moves.length ? `${current.code}: ปรับยอด ${system} → ${qty}` : `${current.code}: ยอดตรงกับระบบ`);
      qc.invalidateQueries({ queryKey: ["sku_on_hand"] });
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["material_demand"] });
      setCurrent(null);
      setCounted("");
      focusScan();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const link = async () => {
    const sku = skus.find((k) => k.id === linkTo);
    if (!sku || !unknown) return;
    const { error } = await supabase
      .from("skus")
      .update({ barcodes: withBarcode(sku.barcodes, unknown, sku.code) })
      .eq("id", sku.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`ผูกบาร์โค้ด ${unknown} กับ ${sku.code} แล้ว`);
    qc.invalidateQueries({ queryKey: ["skus"] });
    choose({ ...sku, barcodes: withBarcode(sku.barcodes, unknown, sku.code) });
  };

  return (
    <section className="mb-4 space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold">ตรวจนับด้วยสแกน</h2>
        <p className="text-xs text-muted-foreground">
          สแกนป้ายสินค้า → ใส่จำนวนที่นับได้ทั้งหมด → Enter · ระบบปรับยอดให้เท่าที่นับ (ของเดียวกันหลายที่ ให้นับรวมก่อน)
        </p>
      </div>
      <div data-scan-count className="max-w-md">
        <ScanBox onScan={onScan} />
      </div>

      {current ? (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-primary/40 bg-primary/5 p-3">
          <div className="min-w-48 flex-1">
            <div className="font-mono text-sm font-semibold">{current.code}</div>
            <div className="text-sm">{current.name}</div>
            <div className="text-xs text-muted-foreground">
              ในระบบ {formatQty(onHand.get(current.id) ?? 0)} {current.unit}
            </div>
          </div>
          <div className="space-y-1">
            <label htmlFor="scan-counted" className="text-xs text-muted-foreground">
              นับได้ ({current.unit})
            </label>
            <Input
              id="scan-counted"
              ref={qtyRef}
              inputMode="decimal"
              className="w-32"
              value={counted}
              onChange={(e) => setCounted(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void save();
                }
              }}
            />
          </div>
          <Button onClick={save} disabled={busy || counted === ""}>
            บันทึก
          </Button>
          <Button variant="ghost" onClick={() => setCurrent(null)}>
            ข้าม
          </Button>
        </div>
      ) : null}

      {pick ? (
        <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          <div className="mb-2">บาร์โค้ด {pick.code} ตรงกับหลายสินค้า — เลือกชิ้นที่นับ:</div>
          <div className="flex flex-wrap gap-2">
            {pick.candidates.map((k) => (
              <Button key={k.id} size="sm" variant="outline" onClick={() => choose(k)}>
                {k.code} — {k.name}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {unknown ? (
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <div>
            ไม่พบสินค้ารหัส <span className="font-mono font-semibold">{unknown}</span> — ถ้าเป็นบาร์โค้ดของผู้ขาย
            ผูกกับ SKU ได้เลย ครั้งหน้าสแกนแล้วเจอทันที
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              className="h-9 min-w-64 flex-1 rounded-md border border-input bg-background px-2 text-sm"
              value={linkTo}
              onChange={(e) => setLinkTo(e.target.value)}
            >
              <option value="">— เลือก SKU —</option>
              {skus.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.code} — {k.name}
                </option>
              ))}
            </select>
            <Button size="sm" disabled={!linkTo} onClick={link}>
              ผูกบาร์โค้ดนี้
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setUnknown(null)}>
              ปิด
            </Button>
          </div>
        </div>
      ) : null}

      {done.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1">นับแล้ว ({done.length})</th>
                <th className="text-right">ในระบบเดิม</th>
                <th className="text-right">นับได้</th>
                <th className="text-right">ต่าง</th>
              </tr>
            </thead>
            <tbody>
              {done.map((d) => {
                const diff = Math.round((d.counted - d.system) * 1e6) / 1e6;
                return (
                  <tr key={d.sku.id} className="border-t border-border">
                    <td className="py-1">
                      <span className="font-mono">{d.sku.code}</span> {d.sku.name}
                    </td>
                    <td className="text-right tabular-nums">{formatQty(d.system)}</td>
                    <td className="text-right tabular-nums">{formatQty(d.counted)}</td>
                    <td className={"text-right tabular-nums " + (diff ? "font-semibold text-destructive" : "")}>
                      {diff > 0 ? "+" : ""}
                      {formatQty(diff)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
