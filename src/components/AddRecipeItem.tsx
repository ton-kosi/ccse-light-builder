import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toNumber } from "@/lib/format";

export function AddRecipeItem({
  skus,
  onAdd,
  pending,
  label = "เพิ่มรายการในสูตร",
  showNote = true,
}: {
  skus: { id: string; code: string; name: string; unit: string }[];
  onAdd: (p: { sku_id: string; qty: number; note: string }) => void;
  pending?: boolean;
  label?: string;
  showNote?: boolean;
}) {
  const [skuId, setSkuId] = useState("");
  const [qty, setQty] = useState("1");
  const [note, setNote] = useState("");

  return (
    <form
      className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault();
        const n = toNumber(qty);
        if (!skuId) { toast.error("กรุณาเลือก SKU"); return; }
        if (n === null || n <= 0) { toast.error("กรุณากรอกจำนวนเป็นตัวเลขมากกว่า 0"); return; }
        onAdd({ sku_id: skuId, qty: n, note });
        setQty("1");
        setNote("");
      }}
    >
      <div className="space-y-1.5 sm:col-span-2">
        <Label className="text-xs">SKU</Label>
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={skuId}
          onChange={(e) => setSkuId(e.target.value)}
        >
          <option value="">— เลือกสินค้า —</option>
          {skus.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">จำนวนต่อหน่วย</Label>
        <Input value={qty} onChange={(e) => setQty(e.target.value)} />
      </div>
      {showNote ? (
        <div className="space-y-1.5">
          <Label className="text-xs">หมายเหตุ</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      ) : null}
      <div className="sm:col-span-4">
        <Button size="sm" type="submit" disabled={pending}>
          {label}
        </Button>
      </div>
    </form>
  );
}
