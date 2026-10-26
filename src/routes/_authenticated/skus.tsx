import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { PageHeader } from "@/components/AppLayout";
import { Field, Td, Th } from "@/routes/_authenticated/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CsvImport, type CsvRow, boolCsv, numCsv } from "@/components/CsvImport";
import { useMe } from "@/hooks/useMe";
import { formatDate, formatQty, formatTHB, toNumber } from "@/lib/format";
import { ensureRollComponent, saveSkuPrice, SKU_PRICES_KEY, useSkuPrices } from "@/lib/skuPrices";
import {
  CATEGORY_HINT,
  categoryOf,
  categoryOptions,
  guessCategory,
  noteText,
  savedCategory,
  withCategory,
  writeTags,
  type SkuCategoryName,
} from "@/lib/skuCategory";
import { DEMO_PREFIX, loadDemoData, removeDemoData } from "@/lib/demoData";
import { attrFieldsFor, attrsForCategory, attrsOf, attrSummary, guessAttrs } from "@/lib/skuAttrs";
import { CategoryFilter } from "@/components/stock/CategoryFilter";
import { countAdjustments, parseCount, STOCK_COUNT_NOTE } from "@/lib/stockCount";

export const Route = createFileRoute("/_authenticated/skus")({
  head: () => ({
    meta: [
      { title: "สต็อกสินค้า SKU | CCSE ERP" },
      {
        name: "description",
        content: "ทะเบียนสินค้าจริงในคลัง ยอดคงเหลือคำนวณจากการรับ/เบิก/ปรับยอด",
      },
      { property: "og:title", content: "สต็อกสินค้า SKU | CCSE ERP" },
      { property: "og:description", content: "ทะเบียนสินค้าและความเคลื่อนไหวสต็อกของ CCSE" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SkusPage,
});

type Sku = Tables<"skus">;
const MOVE_TYPES = [
  { value: "receive", label: "รับของ (+)" },
  { value: "issue", label: "เบิกออก (−)" },
  { value: "adjust", label: "ปรับยอด (±)" },
] as const;
const moveLabel = (t: string) => MOVE_TYPES.find((m) => m.value === t)?.label ?? t;

const EMPTY = {
  code: "",
  name: "",
  unit: "ชิ้น",
  source: "domestic",
  lead_time_days: "0",
  min_stock: "0",
  is_roll: false,
  /** LED strip cut on site: only a cut step (cut_step_cm), no roll settings */
  is_led_strip: false,
  roll_length_m: "",
  roll_family: "",
  cut_step_cm: "",
  max_piece_m: "",
  notes: "",
  category: "",
  /** category-specific fields (LED chip, PCB width, profile model, PSU watt…) */
  attrs: {} as Record<string, string>,
  unit_cost: "",
  sell_price: "",
  max_discount: "",
};
type Form = typeof EMPTY;

function SkusPage() {
  const { canEditMaster, canSeeMoney, canSeeCost, canViewQuote, me } = useMe();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const [moving, setMoving] = useState<Sku | null>(null);
  const [history, setHistory] = useState<Sku | null>(null);

  const { data: skus, isLoading } = useQuery({
    queryKey: ["skus"],
    queryFn: async () => {
      const { data, error } = await supabase.from("skus").select("*").order("code");
      if (error) throw error;
      return data;
    },
  });
  const { data: onHand } = useQuery({
    queryKey: ["sku_on_hand"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sku_on_hand").select("*");
      if (error) throw error;
      return new Map(data.map((r) => [r.sku_id, Number(r.on_hand ?? 0)]));
    },
  });
  const { data: costs } = useQuery({
    queryKey: ["sku_costs"],
    enabled: canSeeCost,
    queryFn: async () => {
      const { data, error } = await supabase.from("sku_costs").select("*");
      if (error) throw error;
      return new Map(data.map((c) => [c.sku_id, Number(c.unit_cost)]));
    },
  });
  const { data: prices } = useSkuPrices(canViewQuote);

  const save = useMutation({
    mutationFn: async ({ id, form }: { id: string | null; form: Form }) => {
      const row = formToRow(form);
      let skuId = id;
      if (id) {
        const { error } = await supabase.from("skus").update(row).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("skus").insert(row).select("id").single();
        if (error) throw error;
        skuId = data.id;
      }
      const sell = toNumber(form.sell_price);
      if (canSeeMoney && sell !== null && skuId) {
        const old = prices?.get(skuId);
        const md = toNumber(form.max_discount) ?? 0;
        if (!old || old.unitPrice !== sell || old.maxDiscount !== md) {
          await saveSkuPrice(
            { id: skuId, code: row.code, name: row.name, unit: row.unit ?? "ชิ้น" },
            sell,
            md,
          );
        }
      }
      // Jedi flex rolls: make sure the family has its roll component (used by BOQ + roll plan)
      if (skuId && row.is_roll && row.roll_family && form.category === "Neon flex") {
        await ensureRollComponent(row.roll_family, {
          id: skuId,
          length: Number(row.roll_length_m) || 5,
        });
      }
      const cost = toNumber(form.unit_cost);
      const oldCost = skuId ? costs?.get(skuId) : undefined;
      if (canSeeMoney && cost !== null && skuId) {
        const { error } = await supabase
          .from("sku_costs")
          .upsert({ sku_id: skuId, unit_cost: cost });
        if (error) throw error;
        if (oldCost !== cost) return skuId;
      }
      return null;
    },
    onSuccess: (changedSku) => {
      toast.success("บันทึกสินค้าแล้ว");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["skus"] });
      qc.invalidateQueries({ queryKey: ["sku_on_hand"] });
      qc.invalidateQueries({ queryKey: ["sku_costs"] });
      qc.invalidateQueries({ queryKey: SKU_PRICES_KEY });
    },
    onError: (e: Error) => toast.error(friendly(e.message)),
  });

  async function importRows(rows: CsvRow[]) {
    // check every counted qty before saving anything, so a bad cell never half-imports
    rows.forEach((r, i) => {
      if (parseCount(r.qty) === "invalid") throw new Error(`แถว ${i + 2}: qty ต้องเป็นตัวเลข 0 ขึ้นไป`);
    });
    const payload: TablesInsert<"skus">[] = rows.map((r, i) => {
      if (!r.code || !r.name) throw new Error(`แถว ${i + 2}: ต้องมี code และ name`);
      const isRoll = boolCsv(r.is_roll);
      return {
        code: r.code,
        name: r.name,
        unit: r.unit || "ชิ้น",
        source: r.source === "import" ? "import" : "domestic",
        lead_time_days: numCsv(r.lead_time_days) ?? 0,
        min_stock: numCsv(r.min_stock) ?? 0,
        is_roll: isRoll,
        roll_length_m: isRoll ? numCsv(r.roll_length_m) : null,
        roll_family: r.roll_family || null,
        cut_step_cm: numCsv(r.cut_step_cm),
        max_piece_m: numCsv(r.max_piece_m),
        // only touch notes when the file has them, so re-importing never wipes a saved category
        ...(r.category || r.notes
          ? { notes: withCategory(r.notes ?? "", r.category?.trim() || null) }
          : {}),
      };
    });
    // rows with and without notes go separately: a bulk upsert fills missing columns with null
    const withNotes = payload.filter((p) => "notes" in p);
    const plain = payload.filter((p) => !("notes" in p));
    for (const part of [withNotes, plain]) {
      if (!part.length) continue;
      const { error } = await supabase.from("skus").upsert(part, { onConflict: "code" });
      if (error) throw new Error(friendly(error.message));
    }
    // admin: cost / selling price / lowest price per row (lowest price → max discount %)
    const money = rows.filter((r) => r.unit_cost || r.sell_price);
    if (money.length && canSeeMoney) {
      const { data: saved, error } = await supabase
        .from("skus")
        .select("id, code, name, unit")
        .in(
          "code",
          money.map((r) => r.code!),
        );
      if (error) throw new Error(friendly(error.message));
      const byCode = new Map(saved.map((k) => [k.code, k]));
      const costRows = money
        .map((r) => ({ sku: byCode.get(r.code!), cost: numCsv(r.unit_cost) }))
        .filter((x) => x.sku && x.cost !== null)
        .map((x) => ({ sku_id: x.sku!.id, unit_cost: x.cost! }));
      if (costRows.length) {
        const { error: e2 } = await supabase.from("sku_costs").upsert(costRows);
        if (e2) throw new Error(friendly(e2.message));
      }
      for (const r of money) {
        const sku = byCode.get(r.code!);
        const sell = numCsv(r.sell_price);
        if (!sku || sell === null || sell <= 0) continue;
        const min = numCsv(r.min_price);
        const max =
          numCsv(r.max_discount) ??
          (min !== null && min > 0 && min < sell ? Math.floor((1 - min / sell) * 10000) / 100 : 0);
        await saveSkuPrice({ ...sku, unit: sku.unit ?? "ชิ้น" }, sell, max);
      }
      qc.invalidateQueries({ queryKey: ["sku_costs"] });
      qc.invalidateQueries({ queryKey: SKU_PRICES_KEY });
    }
    // qty = counted stock: post the difference from on-hand as an adjustment
    const counted = rows.filter((r) => parseCount(r.qty) !== null);
    if (counted.length) {
      if (!me?.userId) throw new Error("ไม่พบผู้ใช้ที่เข้าสู่ระบบ");
      const { data: saved, error } = await supabase
        .from("skus")
        .select("id, code")
        .in(
          "code",
          counted.map((r) => r.code!),
        );
      if (error) throw new Error(friendly(error.message));
      const idByCode = new Map(saved.map((k) => [k.code, k.id]));
      const { data: hand, error: e3 } = await supabase
        .from("sku_on_hand")
        .select("sku_id, on_hand")
        .in(
          "sku_id",
          saved.map((k) => k.id),
        );
      if (e3) throw new Error(friendly(e3.message));
      const moves = countAdjustments(
        counted.map((r) => ({ skuId: idByCode.get(r.code!)!, qty: parseCount(r.qty) as number })),
        new Map(hand.map((h) => [h.sku_id!, Number(h.on_hand ?? 0)])),
      ).map((m) => ({ ...m, type: "adjust", note: STOCK_COUNT_NOTE, created_by: me.userId }));
      if (moves.length) {
        const { error: e4 } = await supabase.from("stock_movements").insert(moves);
        if (e4) throw new Error(friendly(e4.message));
      }
      qc.invalidateQueries({ queryKey: ["stock_movements"] });
      qc.invalidateQueries({ queryKey: ["material_demand"] });
    }
    qc.invalidateQueries({ queryKey: ["skus"] });
    qc.invalidateQueries({ queryKey: ["sku_on_hand"] });
    return payload.length;
  }

  const s = search.trim().toLowerCase();
  const list = (skus ?? [])
    .filter((k) => !cat || categoryOf(k) === cat)
    .filter(
      (k) => !s || [k.code, k.name, k.roll_family ?? ""].some((x) => x.toLowerCase().includes(s)),
    );
  const cols = 10 + (canSeeCost ? 1 : 0) + (canViewQuote ? 2 : 0) + (canEditMaster ? 1 : 0);
  // SKUs whose category or category fields can still be filled from their name
  const guessed = (skus ?? []).filter((k) => {
    if (!savedCategory(k.notes)) return true;
    const saved = attrsOf(k.notes);
    return Object.keys(guessAttrs(k, categoryOf(k))).some((key) => !(key in saved));
  });

  const hasDemo = (skus ?? []).some((k) => k.code.startsWith(DEMO_PREFIX));
  const demo = useMutation({
    mutationFn: async (mode: "load" | "remove") => {
      const id = toast.loading("กำลังทำงาน…");
      try {
        if (mode === "load") await loadDemoData((m) => toast.loading(m, { id }));
        else await removeDemoData((m) => toast.loading(m, { id }));
      } finally {
        toast.dismiss(id);
      }
      return mode;
    },
    onSuccess: (mode) => {
      toast.success(mode === "load" ? "เติมข้อมูลทดสอบ (DEMO-) แล้ว" : "ลบข้อมูลทดสอบแล้ว");
      ["skus", "sku_on_hand", "sku_costs", "purchases", "stock_movements"].forEach((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      );
      qc.invalidateQueries({ queryKey: SKU_PRICES_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveGuesses = useMutation({
    mutationFn: async () => {
      for (const k of guessed) {
        const { error } = await supabase
          .from("skus")
          .update({
            notes: writeTags(k.notes, { ...guessAttrs(k, categoryOf(k)), หมวด: categoryOf(k) }),
          })
          .eq("id", k.id);
        if (error) throw error;
      }
      return guessed.length;
    },
    onSuccess: (n) => {
      toast.success(`บันทึกหมวดและข้อมูลให้ ${n} รายการแล้ว`);
      qc.invalidateQueries({ queryKey: ["skus"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="สต็อก (SKU)"
        description="สินค้าจริงที่เบิกจากคลัง — ยอดคงเหลือคำนวณจากรายการรับ/เบิก/ปรับยอดเท่านั้น"
        actions={
          canEditMaster ? (
            <>
              <CsvImport
                label="นำเข้า CSV"
                columns="code,name,category,unit,source,lead_time_days,min_stock,is_roll,roll_length_m,roll_family,cut_step_cm,max_piece_m,notes,unit_cost,sell_price,min_price (หรือ max_discount),qty (ยอดตรวจนับ)"
                onRows={importRows}
              />
              {canSeeMoney ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={demo.isPending}
                    title="เพิ่ม SKU ทดสอบ (รหัส DEMO-) พร้อมหมวด ข้อมูลไฟ/profile/หม้อแปลง ราคาขาย และประวัติซื้อ"
                    onClick={() => demo.mutate("load")}
                  >
                    เติมข้อมูลทดสอบ
                  </Button>
                  {hasDemo ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={demo.isPending}
                      onClick={() => {
                        if (confirm("ลบ SKU ทดสอบ (DEMO-) ทั้งหมด พร้อมราคาและประวัติซื้อ?"))
                          demo.mutate("remove");
                      }}
                    >
                      ลบข้อมูลทดสอบ
                    </Button>
                  ) : null}
                </>
              ) : null}
              <Button size="sm" onClick={() => setEditing({ id: null, form: { ...EMPTY } })}>
                เพิ่มสินค้า
              </Button>
            </>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          className="max-w-sm"
          placeholder="ค้นหารหัส ชื่อ หรือตระกูลม้วน..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <CategoryFilter skus={skus ?? []} value={cat} onChange={setCat} />
      </div>
      {canEditMaster && guessed.length ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-sm">
          <span>
            มี {guessed.length} รายการที่ยังไม่ได้ตั้งหมวด — ระบบเดาจากชื่อให้ก่อน
            (ตัวเอียงในคอลัมน์หมวด) ตรวจแล้วกดบันทึกทีเดียว หรือแก้ทีละรายการ
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={saveGuesses.isPending}
            onClick={() => saveGuesses.mutate()}
          >
            บันทึกหมวดที่ระบบเดาทั้งหมด
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <Th>รหัส</Th>
              <Th>ชื่อสินค้า</Th>
              <Th>หมวด</Th>
              <Th>หน่วย</Th>
              <Th>แหล่ง</Th>
              <Th>Lead time (วัน)</Th>
              <Th>ม้วน / ระยะตัด</Th>
              <Th>ตระกูลม้วน</Th>
              <Th>ขั้นต่ำ</Th>
              <Th>คงเหลือ</Th>
              {/* cost: admin / purchase / payment team · selling price: admin / sale / payment team */}
              {canSeeCost ? <Th>ต้นทุน/หน่วย</Th> : null}
              {canViewQuote ? (
                <>
                  <Th>ราคาขาย/หน่วย</Th>
                  <Th>ลดได้สูงสุด</Th>
                </>
              ) : null}
              {canEditMaster ? <Th>{""}</Th> : null}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <Td colSpan={cols}>กำลังโหลด...</Td>
              </tr>
            ) : list.length ? (
              list.map((k) => {
                const qty = onHand?.get(k.id) ?? 0;
                const low = qty < Number(k.min_stock);
                return (
                  <tr key={k.id} className="border-t border-border">
                    <Td className="font-mono text-xs">{k.code}</Td>
                    <Td className="font-medium">{k.name}</Td>
                    <Td className="whitespace-nowrap">
                      {savedCategory(k.notes) ?? (
                        <span
                          className="italic text-muted-foreground"
                          title="ระบบเดาจากชื่อ ยังไม่ได้บันทึก"
                        >
                          {guessCategory(k)}?
                        </span>
                      )}
                      {attrSummary(categoryOf(k), attrsOf(k.notes)) ? (
                        <div className="text-xs text-muted-foreground">
                          {attrSummary(categoryOf(k), attrsOf(k.notes))}
                        </div>
                      ) : null}
                    </Td>
                    <Td>{k.unit}</Td>
                    <Td>{k.source === "import" ? "นำเข้า" : "ในประเทศ"}</Td>
                    <Td>{k.lead_time_days}</Td>
                    <Td className="whitespace-nowrap">
                      {k.is_roll
                        ? `${formatQty(Number(k.roll_length_m))} ม.`
                        : isLedStrip(k)
                          ? `LED ตัดทุก ${formatQty(Number(k.cut_step_cm))} ซม.`
                          : "-"}
                    </Td>
                    <Td className="font-mono text-xs">{k.roll_family ?? "-"}</Td>
                    <Td>{formatQty(Number(k.min_stock))}</Td>
                    <Td>
                      <button
                        className={
                          "underline-offset-2 hover:underline " +
                          (low ? "font-semibold text-destructive" : "")
                        }
                        onClick={() => setHistory(k)}
                        title="ดูประวัติความเคลื่อนไหว"
                      >
                        {formatQty(qty)}
                      </button>
                    </Td>
                    {canSeeCost ? (
                        <Td className="whitespace-nowrap">
                          {formatTHB(costs?.get(k.id) ?? 0)}
                          <Link
                            to="/purchases"
                            search={{ sku: k.id }}
                            className="ml-1 text-xs text-primary hover:underline"
                            title="ประวัติการซื้อ"
                          >
                            ประวัติ
                          </Link>
                        </Td>
                    ) : null}
                    {canViewQuote ? (
                      <>
                        <Td className={prices?.has(k.id) ? "" : "text-muted-foreground"}>
                          {prices?.has(k.id)
                            ? formatTHB(prices.get(k.id)!.unitPrice)
                            : "ยังไม่ตั้ง"}
                        </Td>
                        <Td>
                          {prices?.has(k.id) ? `${formatQty(prices.get(k.id)!.maxDiscount)}%` : "-"}
                        </Td>
                      </>
                    ) : null}
                    {canEditMaster ? (
                      <Td className="whitespace-nowrap">
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setMoving(k)}>
                            ปรับยอด/รับของ
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setEditing({
                                id: k.id,
                                form: rowToForm(k, costs?.get(k.id), prices?.get(k.id)),
                              })
                            }
                          >
                            แก้ไข
                          </Button>
                        </div>
                      </Td>
                    ) : null}
                  </tr>
                );
              })
            ) : (
              <tr>
                <Td colSpan={cols}>{s || cat ? "ไม่พบสินค้าที่ค้นหา" : "ยังไม่มีสินค้าในคลัง"}</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "แก้ไขสินค้า" : "เพิ่มสินค้า"}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <SkuForm
              initial={editing.form}
              categories={categoryOptions(skus ?? [])}
              canSeeMoney={canSeeMoney}
              pending={save.isPending}
              onSubmit={(form) => save.mutate({ id: editing.id, form })}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!moving} onOpenChange={(o) => !o && setMoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ปรับยอด/รับของ — {moving?.code}</DialogTitle>
          </DialogHeader>
          {moving ? (
            <MovementForm
              sku={moving}
              onHand={onHand?.get(moving.id) ?? 0}
              onDone={() => {
                setMoving(null);
                qc.invalidateQueries({ queryKey: ["sku_on_hand"] });
                qc.invalidateQueries({ queryKey: ["stock_movements"] });
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!history} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              ความเคลื่อนไหว — {history?.code} {history?.name}
            </DialogTitle>
          </DialogHeader>
          {history ? <MovementHistory skuId={history.id} unit={history.unit} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function friendly(msg: string) {
  if (msg.includes("skus_code_key")) return "รหัส SKU นี้มีอยู่แล้ว";
  if (msg.includes("skus_roll_len_chk"))
    return "LED neon flex ต้องมีความยาวม้วน 5 หรือ 10 ม. (สินค้าอื่นต้องเว้นว่าง)";
  return msg;
}

/** LED strip = not a Neon flex roll but has a cut step (also how a CSV row with cut_step_cm is read). */
function isLedStrip(k: Pick<Sku, "is_roll" | "cut_step_cm">) {
  return !k.is_roll && k.cut_step_cm !== null;
}

function rowToForm(
  k: Sku,
  cost?: number,
  price?: { unitPrice: number; maxDiscount: number },
): Form {
  const s = (v: number | null) => (v === null ? "" : String(v));
  return {
    code: k.code,
    name: k.name,
    unit: k.unit,
    source: k.source,
    lead_time_days: String(k.lead_time_days),
    min_stock: String(k.min_stock),
    is_roll: k.is_roll,
    is_led_strip: isLedStrip(k),
    roll_length_m: s(k.roll_length_m),
    roll_family: k.roll_family ?? "",
    cut_step_cm: s(k.cut_step_cm),
    max_piece_m: s(k.max_piece_m),
    notes: noteText(k.notes),
    category: savedCategory(k.notes) ?? guessCategory(k),
    attrs: guessAttrs(k, savedCategory(k.notes) ?? guessCategory(k)),
    unit_cost: cost === undefined ? "" : String(cost),
    sell_price: price ? String(Math.round(price.unitPrice * 100) / 100) : "",
    max_discount: price ? String(price.maxDiscount) : "",
  };
}

function formToRow(f: Form): TablesInsert<"skus"> {
  return {
    code: f.code.trim(),
    name: f.name.trim(),
    unit: f.unit.trim() || "ชิ้น",
    source: f.source,
    lead_time_days: toNumber(f.lead_time_days) ?? 0,
    min_stock: toNumber(f.min_stock) ?? 0,
    is_roll: f.is_roll,
    roll_length_m: f.is_roll ? toNumber(f.roll_length_m) : null,
    // roll settings only apply to roll products
    roll_family: f.is_roll ? f.roll_family.trim() || null : null,
    // cut step: Neon flex rolls and LED strips; longest piece: Neon flex only
    cut_step_cm: f.is_roll || f.is_led_strip ? toNumber(f.cut_step_cm) : null,
    max_piece_m: f.is_roll ? toNumber(f.max_piece_m) : null,
    notes: writeTags(f.notes, {
      ...attrsForCategory(f.category, f.attrs),
      หมวด: f.category || null,
    }),
  };
}

const selectCls = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

function SkuForm({
  initial,
  categories,
  canSeeMoney,
  pending,
  onSubmit,
}: {
  initial: Form;
  categories: string[];
  canSeeMoney: boolean;
  pending: boolean;
  onSubmit: (f: Form) => void;
}) {
  const [f, setF] = useState(initial);
  const custom = f.category !== "" && !categories.includes(f.category);
  const [typing, setTyping] = useState(custom);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (f.is_roll && !["5", "10"].includes(f.roll_length_m)) {
          toast.error("LED neon flex ต้องเลือกความยาวม้วน 5 หรือ 10 ม.");
          return;
        }
        if (f.is_led_strip && !((toNumber(f.cut_step_cm) ?? 0) > 0)) {
          toast.error("LED เส้นต้องใส่ระยะตัด (ซม.)");
          return;
        }
        onSubmit(f);
      }}
    >
      <Field label="รหัส SKU *">
        <Input required value={f.code} onChange={set("code")} />
      </Field>
      <Field label="ชื่อสินค้า *">
        <Input required value={f.name} onChange={set("name")} />
      </Field>
      <Field label="หมวด (ใช้กรองตัวเลือกในชุดไฟเส้น / FO)" className="sm:col-span-2">
        {typing ? (
          <div className="flex gap-2">
            <Input
              autoFocus
              value={f.category}
              placeholder="ชื่อหมวดใหม่"
              onChange={set("category")}
            />
            <Button type="button" size="sm" variant="ghost" onClick={() => setTyping(false)}>
              เลือกจากรายการ
            </Button>
          </div>
        ) : (
          <select
            className={selectCls}
            value={f.category}
            onChange={(e) => {
              if (e.target.value === "__new") {
                setTyping(true);
                setF({ ...f, category: "" });
              } else setF({ ...f, category: e.target.value });
            }}
          >
            <option value="">— ไม่ระบุ —</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
                {CATEGORY_HINT[c as SkuCategoryName]
                  ? ` · ${CATEGORY_HINT[c as SkuCategoryName]}`
                  : ""}
              </option>
            ))}
            <option value="__new">+ เพิ่มหมวดใหม่…</option>
          </select>
        )}
      </Field>
      <AttrFields
        category={f.category}
        attrs={f.attrs}
        onChange={(attrs) => setF({ ...f, attrs })}
      />
      <Field label="หน่วย">
        <Input value={f.unit} onChange={set("unit")} />
      </Field>
      <Field label="แหล่งที่มา">
        <select className={selectCls} value={f.source} onChange={set("source")}>
          <option value="domestic">ในประเทศ</option>
          <option value="import">นำเข้า</option>
        </select>
      </Field>
      <Field label="Lead time (วัน)">
        <Input value={f.lead_time_days} onChange={set("lead_time_days")} />
      </Field>
      <Field label="สต็อกขั้นต่ำ">
        <Input value={f.min_stock} onChange={set("min_stock")} />
      </Field>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Checkbox
          id="is_roll"
          checked={f.is_roll}
          onCheckedChange={(v) =>
            setF({
              ...f,
              is_roll: v === true,
              is_led_strip: v === true ? false : f.is_led_strip,
              roll_length_m: v === true ? f.roll_length_m || "5" : "",
            })
          }
        />
        <label htmlFor="is_roll" className="text-sm">
          LED neon flex
        </label>
        <Checkbox
          id="is_led_strip"
          className="ml-6"
          checked={f.is_led_strip}
          onCheckedChange={(v) =>
            setF({
              ...f,
              is_led_strip: v === true,
              is_roll: v === true ? false : f.is_roll,
              roll_length_m: v === true ? "" : f.roll_length_m,
            })
          }
        />
        <label htmlFor="is_led_strip" className="text-sm">
          LED เส้น
        </label>
      </div>
      {/* roll-only settings: shown only for roll products */}
      {f.is_roll ? (
        <>
          <Field label="ความยาวม้วน (ม.)">
            <select className={selectCls} value={f.roll_length_m} onChange={set("roll_length_m")}>
              <option value="5">5 ม.</option>
              <option value="10">10 ม.</option>
            </select>
          </Field>
          <Field label="ตระกูลม้วน (เช่น JEDIFLEX-R18-2700K)">
            <Input value={f.roll_family} onChange={set("roll_family")} />
          </Field>
          <Field label="ระยะตัด (ซม.)">
            <Input value={f.cut_step_cm} onChange={set("cut_step_cm")} />
          </Field>
          <Field label="ความยาวชิ้นสูงสุด (ม.)">
            <Input value={f.max_piece_m} onChange={set("max_piece_m")} />
          </Field>
        </>
      ) : null}
      {/* LED strip: where it can be cut, used later by the work order / production sheet */}
      {f.is_led_strip ? (
        <>
          <Field label="ระยะตัด (ซม.) — ตัดได้ทุกกี่ ซม. *">
            <Input
              inputMode="decimal"
              value={f.cut_step_cm}
              placeholder="เช่น 5 หรือ 2.5"
              onChange={set("cut_step_cm")}
            />
          </Field>
        </>
      ) : null}
      {canSeeMoney ? (
        <>
          <Field label="ต้นทุนต่อหน่วย (บาท) — อัปเดตเองจากการซื้อล่าสุด">
            <Input value={f.unit_cost} onChange={set("unit_cost")} />
          </Field>
          <Field label="ราคาขายต่อหน่วย (บาท)">
            <Input value={f.sell_price} placeholder="ยังไม่ตั้ง" onChange={set("sell_price")} />
          </Field>
          <Field label="ลดได้สูงสุด (%)">
            <div className="flex items-center gap-3">
              <Input
                className="w-24 shrink-0"
                value={f.max_discount}
                placeholder="0"
                onChange={set("max_discount")}
              />
              <DiscountedNote sell={f.sell_price} discount={f.max_discount} cost={f.unit_cost} />
            </div>
          </Field>
        </>
      ) : null}
      <Field label="หมายเหตุ" className="sm:col-span-2">
        <Input value={f.notes} onChange={set("notes")} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending}>
          บันทึก
        </Button>
      </div>
    </form>
  );
}

/** "ลดแล้วเหลือ …" next to the max-discount input, with the margin left over cost. */
function DiscountedNote({
  sell,
  discount,
  cost,
}: {
  sell: string;
  discount: string;
  cost: string;
}) {
  const price = toNumber(sell);
  if (price === null) return <span className="text-xs text-muted-foreground">ใส่ราคาขายก่อน</span>;
  const pct = Math.min(100, Math.max(0, toNumber(discount) ?? 0));
  const net = Math.round(price * (1 - pct / 100) * 100) / 100;
  const c = toNumber(cost);
  const gp = c !== null && net > 0 ? ((net - c) / net) * 100 : null;
  return (
    <span className="text-sm">
      ลดแล้วเหลือ <b>{formatTHB(net)}</b> / หน่วย
      {gp !== null ? (
        <span
          className={
            "ml-1 text-xs " +
            (net < c! ? "font-semibold text-destructive" : "text-muted-foreground")
          }
        >
          {net < c! ? "(ต่ำกว่าต้นทุน!)" : `(กำไร ${gp.toFixed(1)}%)`}
        </span>
      ) : null}
    </span>
  );
}

/** Fields that depend on the category (LED chip / PCB, profile model, rail size, PSU watt / dim). */
function AttrFields({
  category,
  attrs,
  onChange,
}: {
  category: string;
  attrs: Record<string, string>;
  onChange: (a: Record<string, string>) => void;
}) {
  const fields = attrFieldsFor(category);
  if (!fields.length) return null;
  const put = (k: string, v: string) => onChange({ ...attrs, [k]: v });
  return (
    <div className="grid gap-3 rounded-md border border-dashed border-border bg-muted/30 p-3 sm:col-span-2 sm:grid-cols-2">
      <div className="text-xs font-medium text-muted-foreground sm:col-span-2">
        ข้อมูลสำหรับคำนวณในใบเสนอราคา ({category})
      </div>
      {fields.map((fd) => (
        <Field key={fd.key} label={fd.label}>
          {fd.kind === "text" ? (
            <Input value={attrs[fd.key] ?? ""} onChange={(e) => put(fd.key, e.target.value)} />
          ) : fd.kind === "number" ? (
            <div className="flex items-center gap-2">
              <Input
                inputMode="decimal"
                value={attrs[fd.key] ?? ""}
                onChange={(e) => put(fd.key, e.target.value)}
              />
              {fd.unit ? <span className="text-xs text-muted-foreground">{fd.unit}</span> : null}
            </div>
          ) : fd.kind === "select" ? (
            <select
              className={selectCls}
              value={attrs[fd.key] ?? ""}
              onChange={(e) => put(fd.key, e.target.value)}
            >
              <option value="">— ไม่ระบุ —</option>
              {fd.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <label className="flex h-9 items-center gap-2 text-sm">
              <Checkbox
                checked={attrs[fd.key] === "ใช่"}
                onCheckedChange={(v) => put(fd.key, v === true ? "ใช่" : "ไม่")}
              />
              ใช่
            </label>
          )}
          {fd.hint ? (
            <span className="mt-0.5 block text-[11px] text-muted-foreground">{fd.hint}</span>
          ) : null}
        </Field>
      ))}
    </div>
  );
}

function MovementForm({ sku, onHand, onDone }: { sku: Sku; onHand: number; onDone: () => void }) {
  const [type, setType] = useState<"receive" | "issue" | "adjust">("receive");
  const [qty, setQty] = useState("");
  const [projectId, setProjectId] = useState("");
  const [note, setNote] = useState("");

  const { data: projects } = useQuery({
    queryKey: ["projects", "options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, code, name")
        .order("code", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const n = toNumber(qty);
      if (n === null || n === 0) throw new Error("กรุณากรอกจำนวนที่ไม่ใช่ 0");
      const signed = type === "receive" ? Math.abs(n) : type === "issue" ? -Math.abs(n) : n;
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase.from("stock_movements").insert({
        sku_id: sku.id,
        qty: signed,
        type,
        project_id: projectId || null,
        note: note.trim() || null,
        created_by: u.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("บันทึกความเคลื่อนไหวแล้ว");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate();
      }}
    >
      <div className="text-sm text-muted-foreground">
        คงเหลือปัจจุบัน:{" "}
        <span className="font-semibold text-foreground">
          {formatQty(onHand)} {sku.unit}
        </span>
      </div>
      <Field label="ประเภท">
        <select
          className={selectCls}
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
        >
          {MOVE_TYPES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label={type === "adjust" ? "จำนวน (ใส่ − เพื่อลดยอด)" : `จำนวน (${sku.unit})`}>
        <Input required value={qty} onChange={(e) => setQty(e.target.value)} />
      </Field>
      <Field label="โปรเจกต์ (ถ้ามี)">
        <select
          className={selectCls}
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">— ไม่ระบุ —</option>
          {(projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="หมายเหตุ">
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div>
        <Button type="submit" size="sm" disabled={add.isPending}>
          บันทึก
        </Button>
      </div>
    </form>
  );
}

function MovementHistory({ skuId, unit }: { skuId: string; unit: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["stock_movements", skuId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("id, qty, type, note, created_at, projects(code)")
        .eq("sku_id", skuId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });
  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="bg-secondary text-left text-xs text-muted-foreground">
          <tr>
            <Th>วันที่</Th>
            <Th>ประเภท</Th>
            <Th>จำนวน</Th>
            <Th>โปรเจกต์</Th>
            <Th>หมายเหตุ</Th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr>
              <Td colSpan={5}>กำลังโหลด...</Td>
            </tr>
          ) : data?.length ? (
            data.map((m) => (
              <tr key={m.id} className="border-t border-border">
                <Td>{formatDate(m.created_at)}</Td>
                <Td>{moveLabel(m.type)}</Td>
                <Td className={Number(m.qty) < 0 ? "text-destructive" : ""}>
                  {Number(m.qty) > 0 ? "+" : ""}
                  {formatQty(Number(m.qty))} {unit}
                </Td>
                <Td>{(m.projects as { code: string } | null)?.code ?? "-"}</Td>
                <Td>{m.note ?? "-"}</Td>
              </tr>
            ))
          ) : (
            <tr>
              <Td colSpan={5}>ยังไม่มีความเคลื่อนไหว</Td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
