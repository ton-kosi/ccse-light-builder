import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LineRecipeEditor } from "@/components/boq/LineRecipeEditor";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  LINE_KINDS,
  formatCutLengths,
  lineAmount,
  optKey,
  parseCutLengths,
  sumCut,
  type QuoteLine,
} from "@/lib/boq";
import { formatQty, formatTHB, toNumber } from "@/lib/format";

type Comp = { code: string; name: string; unit: string } | null;
export type GridLine = QuoteLine & { sales_components: Comp };
type ComponentOpt = { id: string; code: string; name: string; unit: string; list_price?: number | null; max_discount_percent?: number | null };

const COLS = [
  "option_name", "zone", "circuit_note", "item_no", "kind", "component",
  "customer_text", "cut_lengths", "qty", "unit", "unit_price", "discount_percent",
] as const;
type ColKey = (typeof COLS)[number];
const LAST_COL = COLS.length - 1;

const cellCls =
  "h-11 w-full min-w-0 bg-transparent px-2 text-base outline-none focus:bg-background focus:ring-2 focus:ring-ring rounded-sm disabled:opacity-60";

function focusCell(r: number, c: number) {
  const el = document.querySelector<HTMLElement>(`[data-boq-cell="${r}:${c}"]`);
  if (el) {
    el.focus();
    if (el instanceof HTMLInputElement) el.select();
  }
}

export function BoqGrid({
  quotationId,
  lines,
  components,
  selectedOption,
  canEdit,
  canSeeCost,
}: {
  quotationId: string;
  lines: GridLine[];
  components: ComponentOpt[];
  selectedOption: string | null;
  canEdit: boolean;
  canSeeCost: boolean;
}) {
  const qc = useQueryClient();
  const [openRecipe, setOpenRecipe] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const pendingFocus = useRef<{ id: string; c: number } | null>(null);
  const key = ["quote_lines", quotationId];
  const tableRef = useRef<HTMLTableElement>(null);
  const [draftWidths, setDraftWidths] = useState<Record<string, string>>({});
  const [columnWidths, setColumnWidths] = useState([24, 70, 96, 112, 52, 136, 196, 200, 150, 90, 64, 100, 48, 112, 112, 176]);
  const trackWidth = (id: string, field: string, value: string) =>
    setDraftWidths((old) => ({ ...old, [`${id}:${field}`]: value }));

  useLayoutEffect(() => {
    let active = true;
    const measure = () => {
      const table = tableRef.current;
      const context = document.createElement("canvas").getContext("2d");
      if (!active || !table || !context) return;
      const font = getComputedStyle(table);
      context.font = `600 16px ${font.fontFamily}`;
      const textWidth = (text: string) => Math.ceil(context.measureText(text).width);
      const fit = (text: string, header: string, extra = 20) => Math.max(textWidth(text) + extra, textWidth(header) + 16);
      const longest = (field: "customer_text" | "cut_lengths", fallback: string) => {
        let width = textWidth(fallback);
        for (const line of lines) {
          const saved = field === "customer_text" ? line.customer_text || line.sales_components?.name || "" : formatCutLengths(line.cut_lengths);
          const shown = draftWidths[`${line.id}:${field}`] ?? saved;
          for (const part of shown.split("\n")) width = Math.max(width, textWidth(part));
        }
        return width + 24;
      };
      setColumnWidths([
        24, fit("MMM", "Option"), 96, fit("999999999", "เลขวงจร"), fit("999", "Item"),
        Math.max(...LINE_KINDS.map((kind) => textWidth(kind.label))) + 44,
        fit("M".repeat(18), "ชิ้นส่วนขาย"),
        longest("customer_text", "รายละเอียด (ลูกค้าเห็น)"), longest("cut_lengths", "ความยาวตัด (ม.)"),
        fit("99999", "จำนวนรวม"), fit("MMMM", "หน่วย"), fit("9999999", "@ราคา"),
        fit("99", "%ลด"), fit("99,999.99", "รวม"), fit("99,999.99", "ต้นทุน"), 176,
      ]);
    };
    measure();
    document.fonts.ready.then(measure);
    return () => { active = false; };
  }, [lines, draftWidths]);

  const setLocal = (fn: (rows: GridLine[]) => GridLine[]) =>
    qc.setQueryData<GridLine[]>(key, (old) => fn(old ?? []));

  useEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    const r = lines.findIndex((l) => l.id === p.id);
    if (r >= 0) {
      pendingFocus.current = null;
      requestAnimationFrame(() => focusCell(r, p.c));
    }
  }, [lines]);

  /* ---- internal cost: recipe × sku cost ---- */
  const lineIds = lines.map((l) => l.id);
  const compMap = useMemo(() => new Map(components.map((c) => [c.id, c])), [components]);
  const compIds = Array.from(new Set(lines.map((l) => l.component_id).filter(Boolean))) as string[];
  const { data: costs } = useQuery({
    queryKey: ["boq_costs", quotationId, lineIds.join(","), compIds.join(",")],
    enabled: canSeeCost && lines.length > 0,
    queryFn: async () => {
      const [lr, rc, sc] = await Promise.all([
        lineIds.length
          ? supabase.from("line_recipes").select("quote_line_id, sku_id, qty").in("quote_line_id", lineIds)
          : Promise.resolve({ data: [], error: null }),
        compIds.length
          ? supabase.from("recipes").select("component_id, sku_id, qty_per_unit").in("component_id", compIds)
          : Promise.resolve({ data: [], error: null }),
        supabase.from("sku_costs").select("sku_id, unit_cost"),
      ]);
      const cost = new Map((sc.data ?? []).map((c) => [c.sku_id, Number(c.unit_cost)]));
      const byLine = new Map<string, number>();
      for (const r of lr.data ?? [])
        byLine.set(r.quote_line_id, (byLine.get(r.quote_line_id) ?? 0) + Number(r.qty) * (cost.get(r.sku_id) ?? 0));
      const byComp = new Map<string, number>();
      for (const r of rc.data ?? [])
        byComp.set(r.component_id, (byComp.get(r.component_id) ?? 0) + Number(r.qty_per_unit) * (cost.get(r.sku_id) ?? 0));
      return { byLine, byComp };
    },
  });
  // Line cost = standard recipe × line qty + custom line_recipes (already totals for the line)
  const lineCost = (l: GridLine): number | null => {
    if (!costs) return null;
    const std = l.component_id ? costs.byComp.get(l.component_id) : undefined;
    const custom = costs.byLine.get(l.id);
    if (std === undefined && custom === undefined) return null;
    return (std ?? 0) * Number(l.qty ?? 0) + (custom ?? 0);
  };

  /* ---- mutations ---- */
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TablesUpdate<"quote_lines"> }) => {
      const { error } = await supabase.from("quote_lines").update(patch).eq("id", id);
      if (error) throw error;
    },
    onMutate: ({ id, patch }) =>
      setLocal((rows) => rows.map((r) => (r.id === id ? ({ ...r, ...patch } as GridLine) : r))),
    onError: (e: Error) => {
      toast.error(e.message);
      qc.invalidateQueries({ queryKey: key });
    },
  });

  /** Apply new order: renumber sort_order, persist changed rows, insert new rows. */
  const persistOrder = async (ordered: GridLine[], inserts: GridLine[]) => {
    const withOrder = ordered.map((r, i) => ({ ...r, sort_order: (i + 1) * 10 }));
    setLocal(() => withOrder);
    const newIds = new Set(inserts.map((r) => r.id));
    const old = new Map(lines.map((l) => [l.id, l.sort_order]));
    try {
      if (inserts.length) {
        const payload: TablesInsert<"quote_lines">[] = withOrder
          .filter((r) => newIds.has(r.id))
          .map(({ sales_components: _c, created_at: _a, updated_at: _b, ...rest }) => rest);
        const { error } = await supabase.from("quote_lines").insert(payload);
        if (error) throw error;
      }
      const changed = withOrder.filter((r) => !newIds.has(r.id) && old.get(r.id) !== r.sort_order);
      const results = await Promise.all(
        changed.map((r) =>
          supabase.from("quote_lines").update({ sort_order: r.sort_order }).eq("id", r.id),
        ),
      );
      const err = results.find((x) => x.error)?.error;
      if (err) throw err;
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      qc.invalidateQueries({ queryKey: key });
    }
  };

  const blankRow = (base?: GridLine): GridLine => ({
    id: crypto.randomUUID(),
    quotation_id: quotationId,
    sort_order: 0,
    option_name: base?.option_name ?? null,
    zone: base?.zone ?? null,
    item_no: null,
    kind: "priced",
    component_id: null,
    customer_text: null,
    circuit_note: null,
    cut_lengths: null,
    qty: null,
    unit: null,
    unit_price: null,
    discount_percent: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    sales_components: null,
  });

  const addRowAfter = (index: number) => {
    const base = index >= 0 ? lines[index] : undefined;
    const row = blankRow(base);
    const next = [...lines];
    next.splice(index + 1, 0, row);
    pendingFocus.current = { id: row.id, c: 0 };
    void persistOrder(next, [row]);
  };

  const removeRow = async (id: string) => {
    setLocal((rows) => rows.filter((r) => r.id !== id));
    const { error } = await supabase.from("quote_lines").delete().eq("id", id);
    if (error) toast.error(error.message);
    qc.invalidateQueries({ queryKey: key });
  };

  const duplicateCircuit = async (index: number) => {
    let end = index + 1;
    while (end < lines.length && lines[end]!.kind !== "heading") end++;
    const block = lines.slice(index, end);
    const idMap = new Map<string, string>();
    const copies = block.map((r) => {
      const id = crypto.randomUUID();
      idMap.set(r.id, id);
      return { ...r, id };
    });
    const next = [...lines.slice(0, end), ...copies, ...lines.slice(end)];
    await persistOrder(next, copies);
    const { data: rec } = await supabase
      .from("line_recipes")
      .select("quote_line_id, sku_id, qty, note")
      .in("quote_line_id", block.map((b) => b.id));
    if (rec?.length) {
      const { error } = await supabase.from("line_recipes").insert(
        rec.map((r) => ({ ...r, quote_line_id: idMap.get(r.quote_line_id)! })),
      );
      if (error) toast.error(error.message);
    }
    toast.success(`คัดลอกวงจร ${block.length} บรรทัดแล้ว`);
  };

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const next = lines.filter((l) => l.id !== dragId);
    const moving = lines.find((l) => l.id === dragId)!;
    const ti = next.findIndex((l) => l.id === targetId);
    const fromIdx = lines.findIndex((l) => l.id === dragId);
    const toIdx = lines.findIndex((l) => l.id === targetId);
    next.splice(fromIdx < toIdx ? ti + 1 : ti, 0, moving);
    void persistOrder(next, []);
  };

  /* ---- keyboard ---- */
  const onKey = (e: React.KeyboardEvent<HTMLElement>, r: number, c: number) => {
    const el = e.currentTarget;
    const isText = el instanceof HTMLInputElement;
    const atStart = isText && el.selectionStart === 0 && el.selectionEnd === 0;
    const atEnd = isText && el.selectionStart === el.value.length;
    if (e.key === "Enter") {
      e.preventDefault();
      el.blur();
      if (c === LAST_COL) {
        if (canEdit) addRowAfter(r);
      } else if (r + 1 < lines.length) {
        requestAnimationFrame(() => focusCell(r + 1, c));
      } else {
        requestAnimationFrame(() => focusCell(r, c + 1));
      }
    } else if (e.key === "ArrowDown" && !(el instanceof HTMLSelectElement)) {
      e.preventDefault();
      focusCell(Math.min(lines.length - 1, r + 1), c);
    } else if (e.key === "ArrowUp" && !(el instanceof HTMLSelectElement)) {
      e.preventDefault();
      focusCell(Math.max(0, r - 1), c);
    } else if (e.key === "ArrowLeft" && (atStart || !isText) && c > 0) {
      e.preventDefault();
      focusCell(r, c - 1);
    } else if (e.key === "ArrowRight" && (atEnd || !isText) && c < LAST_COL) {
      e.preventDefault();
      focusCell(r, c + 1);
    }
  };

  const commitText = (l: GridLine, k: Exclude<ColKey, "kind" | "component" | "cut_lengths">, raw: string) => {
    const numeric = k === "qty" || k === "unit_price" || k === "discount_percent";
    let v: string | number | null;
    if (numeric) {
      v = toNumber(raw);
      if (raw.trim() && v === null) { toast.error("กรุณากรอกตัวเลข"); return false; }
      if (k === "unit_price" && v !== null && l.component_id) {
        const lp = compMap.get(l.component_id)?.list_price;
        if (lp != null && Number(v) !== Number(lp)) {
          if (Number(v) < Number(lp)) {
            toast.error(`ห้ามตั้งราคาต่ำกว่าราคาขาย ${formatTHB(Number(lp))}`);
            return false;
          }
          const cur = l.unit_price === null ? null : Number(l.unit_price);
          if (Number(v) !== cur) {
            const msg = `ราคาขายของชิ้นส่วนนี้คือ ${formatTHB(Number(lp))} — ยืนยันเปลี่ยนเป็น ${formatTHB(Number(v))}?`;
            if (!window.confirm(msg)) return false;
          }
        }
      }
      if (k === "discount_percent") {
        v = v ?? 0;
        const max = l.component_id ? compMap.get(l.component_id)?.max_discount_percent : undefined;
        if (max != null && (v as number) > Number(max)) {
          toast.error(`ส่วนลดสูงสุดของรายการนี้คือ ${max}%`);
          return false;
        }
      }
    } else v = raw.trim() || null;
    const cur = l[k] === null || l[k] === undefined ? null : numeric ? Number(l[k]) : l[k];
    if (v === cur) return false;
    update.mutate({ id: l.id, patch: { [k]: v } as TablesUpdate<"quote_lines"> });
    return true;
  };

  const commitCut = (l: GridLine, raw: string) => {
    const arr = parseCutLengths(raw);
    if (arr === undefined) { toast.error('รูปแบบความยาวตัดไม่ถูกต้อง เช่น "1.50+1.50+1.40"'); return; }
    if (formatCutLengths(arr) === formatCutLengths(l.cut_lengths)) return;
    const patch: TablesUpdate<"quote_lines"> = { cut_lengths: arr };
    const oldSum = l.cut_lengths?.length ? sumCut(l.cut_lengths) : null;
    const qty = l.qty === null ? null : Number(l.qty);
    // auto-suggest qty when it is empty or still equals the previous sum
    if (arr && (qty === null || qty === oldSum)) patch.qty = sumCut(arr);
    update.mutate({ id: l.id, patch });
  };

  const fade = (l: GridLine) => !!selectedOption && optKey(l) !== "" && optKey(l) !== selectedOption;

  return (
    <div className="mt-4">
      <div className="overflow-x-auto rounded-md border border-border">
        <table ref={tableRef} className="table-fixed border-collapse text-sm" style={{ width: columnWidths.reduce((sum, width, index) => sum + (index === 14 && !canSeeCost ? 0 : width), 0) }}>
          <colgroup>
            {columnWidths.map((width, index) => index === 14 && !canSeeCost ? null : <col key={index} style={{ width }} />)}
          </colgroup>
          <thead className="bg-secondary text-left text-sm text-muted-foreground">
            <tr>
              <th className="w-6" />
              <H>Option</H>
              <H>โซน</H>
              <H>เลขวงจร</H>
              <H>Item</H>
              <H>ประเภท</H>
              <H>ชิ้นส่วนขาย</H>
              <H>รายละเอียด (ลูกค้าเห็น)</H>
              <H>ความยาวตัด (ม.)</H>
              <H w="text-right">จำนวนรวม</H>
              <H>หน่วย</H>
              <H w="text-right">@ราคา</H>
              <H w="text-right">%ลด</H>
              <H w="text-right">รวม</H>
              {canSeeCost ? <H w="w-24 text-right" internal>ต้นทุน</H> : null}
              <th className="w-44" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, r) => {
              const heading = l.kind === "heading";
              const buyer = l.kind === "by_buyer" || l.kind === "existing";
              const rowCls = [
                "border-t border-border",
                heading ? "bg-muted font-semibold" : "",
                buyer ? "italic text-by-buyer" : "",
                fade(l) ? "opacity-40" : "",
                overId === l.id && dragId ? "outline outline-2 outline-primary" : "",
              ].join(" ");
              const cost = lineCost(l);
              const amount = lineAmount(l);
              const cutSum = l.cut_lengths?.length ? sumCut(l.cut_lengths) : null;
              const txt = (k: Parameters<typeof commitText>[1], c: number, extra = "") => (
                <td className="px-0.5 py-0.5">
                  <CellInput
                    cell={`${r}:${c}`}
                    value={l[k] === null || l[k] === undefined ? "" : String(l[k])}
                    disabled={!canEdit || (k === "unit" && !!l.component_id)}
                    className={extra}
                    onCommit={(v) => commitText(l, k, v)}
                    onKeyDown={(e) => onKey(e, r, c)}
                  />
                </td>
              );
              return (
                <Fragment key={l.id}>
                  <tr
                    className={rowCls}
                    onDragOver={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      setOverId(l.id);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      onDrop(l.id);
                      setDragId(null);
                      setOverId(null);
                    }}
                  >
                    <td
                      className={"select-none px-1 text-center text-muted-foreground " + (canEdit ? "cursor-grab" : "")}
                      draggable={canEdit}
                      title="ลากเพื่อจัดลำดับ"
                      onDragStart={() => setDragId(l.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setOverId(null);
                      }}
                    >
                      ⋮⋮
                    </td>
                    {txt("option_name", 0)}
                    {txt("zone", 1)}
                    <td className="px-0.5 py-0.5">
                      <CellInput
                        cell={`${r}:2`}
                        value={l.circuit_note ?? ""}
                        disabled={!canEdit}
                        onCommit={(v) => commitText(l, "circuit_note", v)}
                        onKeyDown={(e) => onKey(e, r, 2)}
                      />
                    </td>

                    {txt("item_no", 3)}
                    <td className="px-0.5 py-0.5">
                      <select
                        data-boq-cell={`${r}:4`}
                        className={cellCls}
                        value={l.kind}
                        disabled={!canEdit}
                        onKeyDown={(e) => onKey(e, r, 4)}
                        onChange={(e) => update.mutate({ id: l.id, patch: { kind: e.target.value } })}
                      >
                        {LINE_KINDS.map((k) => (
                          <option key={k.value} value={k.value}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-0.5 py-0.5">
                      <ComponentPicker
                        cell={`${r}:5`}
                        components={components}
                        value={l.sales_components ? `${l.sales_components.code}` : ""}
                        disabled={!canEdit}
                        onKeyDown={(e) => onKey(e, r, 5)}
                        onPick={(c) => {
                          if ((c?.id ?? null) === l.component_id) return;
                          setLocal((rows) =>
                            rows.map((x) =>
                              x.id === l.id
                                ? { ...x, sales_components: c ? { code: c.code, name: c.name, unit: c.unit } : null }
                                : x,
                            ),
                          );
                          update.mutate({
                            id: l.id,
                            patch: {
                              component_id: c?.id ?? null,
                              ...(c ? { unit: c.unit } : {}),
                              ...(c && c.list_price != null ? { unit_price: c.list_price, discount_percent: 0 } : {}),
                            },
                          });
                        }}
                      />
                    </td>
                    <td className="px-0.5 py-0.5">
                       <DescriptionCell
                        cell={`${r}:6`}
                        value={l.customer_text ?? ""}
                        placeholder={l.sales_components?.name ?? ""}
                        disabled={!canEdit}
                         onDraftChange={(value) => trackWidth(l.id, "customer_text", value)}
                        onCommit={(v) => commitText(l, "customer_text", v)}
                         onKeyDown={(e) => {
                           if (["Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
                           onKey(e, r, 6);
                         }}
                      />
                    </td>
                     <td className="px-0.5 py-0.5">
                       <CellInput
                         cell={`${r}:7`}
                        value={formatCutLengths(l.cut_lengths)}
                        placeholder="1.50+1.40"
                         onDraftChange={(value) => trackWidth(l.id, "cut_lengths", value)}
                        disabled={!canEdit}
                        onCommit={(v) => commitCut(l, v)}
                        onKeyDown={(e) => onKey(e, r, 7)}
                      />
                       {cutSum !== null ? (
                        <div className="px-1.5 text-[11px] not-italic text-muted-foreground">
                           รวม {formatQty(cutSum)} ม.
                        </div>
                      ) : null}
                    </td>
                    {txt("qty", 8, "text-right")}
                    {txt("unit", 9)}
                    {txt("unit_price", 10, "text-right")}
                    {(() => {
                      const max = l.component_id ? compMap.get(l.component_id)?.max_discount_percent : null;
                      return (
                        <td className="px-0.5 py-0.5" title={max != null ? `ลดได้สูงสุด ${max}%` : undefined}>
                          <CellInput
                            cell={`${r}:11`}
                            value={String(l.discount_percent ?? "")}
                            placeholder={max != null ? `≤${max}` : ""}
                            disabled={!canEdit}
                            className="text-right"
                            onCommit={(v) => commitText(l, "discount_percent", v)}
                            onKeyDown={(e) => onKey(e, r, 11)}
                          />
                          {max != null ? <div className="px-1 text-right text-xs text-muted-foreground">สูงสุด<br />{max}%</div> : null}
                        </td>
                      );
                    })()}
                    <td className="px-1.5 text-right tabular-nums">
                      {l.kind === "priced" ? formatTHB(amount) : kindText(l.kind)}
                    </td>
                    {canSeeCost ? (
                      <td className="bg-accent/30 px-1.5 text-right tabular-nums text-muted-foreground">
                        {heading || cost === null ? "" : formatTHB(cost)}
                      </td>
                    ) : null}
                    <td className="whitespace-nowrap px-1 py-0.5 not-italic">
                      <div className="flex gap-1">
                        {!heading ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => setOpenRecipe(l.id)}
                          >
                            สูตรภายใน
                          </Button>
                        ) : canEdit ? (
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => duplicateCircuit(r)}>
                            คัดลอกวงจร
                          </Button>
                        ) : null}
                        {canEdit ? (
                          <>
                            <Button size="sm" variant="ghost" className="h-7 px-2" title="แทรกบรรทัดด้านล่าง" onClick={() => addRowAfter(r)}>
                              +
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => removeRow(l.id)}>
                              ลบ
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
            {lines.length === 0 ? (
              <tr>
                <td colSpan={16} className="px-3 py-4 text-muted-foreground">
                  ยังไม่มีรายการ BOQ
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {canEdit ? (
          <Button size="sm" variant="outline" onClick={() => addRowAfter(lines.length - 1)}>
            + เพิ่มบรรทัด
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">
          Tab/ลูกศร = ย้ายช่อง · Enter = ลงบรรทัดถัดไป · Enter ที่ช่องสุดท้าย = เพิ่มบรรทัดใต้ · ลาก ⋮⋮ เพื่อจัดลำดับ ·
          คอลัมน์พื้นสีเหลือง = <b>ภายใน</b> (ไม่พิมพ์ให้ลูกค้า)
        </span>
      </div>
      <Sheet open={!!openRecipe} onOpenChange={(o) => !o && setOpenRecipe(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          {(() => {
            const l = lines.find((x) => x.id === openRecipe);
            if (!l) return null;
            return (
              <>
                <SheetHeader>
                  <SheetTitle>สูตรภายใน</SheetTitle>
                  <SheetDescription>
                    {l.item_no ? `${l.item_no} · ` : ""}
                    {l.customer_text || "—"} · จำนวน {formatQty(Number(l.qty ?? 0))} {l.unit ?? ""}
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-4">
                  <LineRecipeEditor
                    lineId={l.id}
                    componentId={l.component_id}
                    lineQty={Number(l.qty ?? 0)}
                    canEdit={canEdit}
                  />
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function kindText(kind: string): string {
  if (kind === "by_buyer") return "by buyer";
  if (kind === "existing") return "existing";
  if (kind === "foc") return "FOC";
  return "";
}

function H({ children, w = "", internal }: { children: React.ReactNode; w?: string; internal?: boolean }) {
  return (
    <th className={"px-1.5 py-2 font-medium " + w + (internal ? " bg-accent/50" : "")}>
      {children}
      {internal ? <div className="text-[10px] font-semibold text-accent-foreground">ภายใน</div> : null}
    </th>
  );
}

function DescriptionCell({ cell, value, placeholder, disabled, onCommit, onKeyDown, onDraftChange }: {
  cell: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onDraftChange?: (value: string) => void;
  onCommit: (value: string) => boolean;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const shown = draft || placeholder || "";
  return (
    <Textarea
      data-boq-cell={cell}
      aria-label="รายละเอียด (ลูกค้าเห็น)"
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
       rows={Math.max(2, shown.split("\n").length)}
       wrap="off"
       className="w-full min-w-0 max-w-none resize-y whitespace-pre border-transparent bg-transparent px-2 py-2 text-base shadow-none"
      onChange={(e) => { setDraft(e.target.value); onDraftChange?.(e.target.value); }}
      onKeyDown={onKeyDown}
      onBlur={() => { if (!onCommit(draft)) { setDraft(value); onDraftChange?.(value || placeholder || ""); } }}
    />
  );
}

function CellInput({
  cell,
  value,
  onCommit,
  onKeyDown,
  disabled,
  placeholder,
  className = "",
  onDraftChange,
}: {
  cell: string;
  value: string;
  onCommit: (v: string) => boolean | void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onDraftChange?: (value: string) => void;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      data-boq-cell={cell}
      className={cellCls + " " + className}
      value={v}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => { setV(e.target.value); onDraftChange?.(e.target.value); }}
      onBlur={() => { if (v !== value && onCommit(v) === false) setV(value); }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setV(value);
          onDraftChange?.(value);
          return;
        }
        onKeyDown(e);
      }}
    />
  );
}

function ComponentPicker({
  cell,
  components,
  value,
  disabled,
  onPick,
  onKeyDown,
}: {
  cell: string;
  components: ComponentOpt[];
  value: string;
  disabled?: boolean;
  onPick: (c: ComponentOpt | null) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 400 });
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  useEffect(() => setQ(value), [value]);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return components.slice(0, 12);
    return components
      .filter((c) => c.code.toLowerCase().includes(t) || c.name.toLowerCase().includes(t))
      .slice(0, 12);
  }, [q, components]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(520, window.innerWidth - 24);
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: rect.bottom + 4, width });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => { window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open]);

  const pick = (c: ComponentOpt | null) => {
    setOpen(false);
    setQ(c?.code ?? "");
    onPick(c);
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        role="combobox"
        aria-label="ชิ้นส่วนขาย"
        aria-expanded={open}
        aria-controls={`components-${cell}`}
        aria-autocomplete="list"
        data-boq-cell={cell}
        className={cellCls}
        value={q}
        disabled={disabled}
        placeholder="ค้นหารหัส/ชื่อ"
        onFocus={() => { setHi(0); setOpen(true); }}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150);
          if (!q.trim() && value) pick(null);
          else if (q !== value) setQ(value);
        }}
        onKeyDown={(e) => {
          if (open && matches.length) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((h) => Math.min(matches.length - 1, h + 1));
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => Math.max(0, h - 1));
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              if (e.key === "Enter") e.preventDefault();
              pick(matches[hi]!);
              return;
            }
          }
          if (e.key === "Escape") {
            setOpen(false);
            setQ(value);
            return;
          }
          onKeyDown(e);
        }}
      />
      {open ? createPortal(
        <ul id={`components-${cell}`} role="listbox" aria-label="ชิ้นส่วนขายที่พบ" style={position} className="fixed z-[100] max-h-80 overflow-auto rounded-md border border-border bg-popover py-1 text-base not-italic font-normal text-popover-foreground shadow-md">
          {!matches.length ? <li className="px-3 py-3 text-muted-foreground">ไม่พบชิ้นส่วนขาย</li> : null}
          {matches.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === hi}
              className={"cursor-pointer px-3 py-3 " + (i === hi ? "bg-accent" : "")}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
            >
              <span className="font-mono text-sm">{c.code}</span> — {c.name}{" "}
              <span className="text-xs text-muted-foreground">({c.unit})</span>
            </li>
          ))}
        </ul>, document.body
      ) : null}
    </div>
  );
}
