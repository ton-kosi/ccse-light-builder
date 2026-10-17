import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LineRecipeEditor } from "@/components/boq/LineRecipeEditor";
import { FoSetDialog, type FoTarget } from "@/components/boq/FoSetDialog";
import { LinearDialog, type LinearTarget } from "@/components/boq/LinearDialog";
import { parseLinear, type LinearConfig } from "@/lib/linear";
import { ClipsoDialog, type ClipsoTarget } from "@/components/boq/ClipsoDialog";
import { parseClipso, type ClipsoConfig } from "@/lib/clipso";
import { NeonDialog, type NeonTarget } from "@/components/boq/NeonDialog";
import { parseNeon, type NeonConfig } from "@/lib/neon";
import { rebalanceNeon } from "@/lib/neonSync";
import { FilmDialog, type FilmTarget } from "@/components/boq/FilmDialog";
import { parseFilm, type FilmConfig } from "@/lib/film";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  LINE_KINDS,
  lineAmount,
  optKey,
  type QuoteLine,
} from "@/lib/boq";
import { formatQty, formatTHB, toNumber } from "@/lib/format";

type Comp = { code: string; name: string; unit: string } | null;
export type GridLine = QuoteLine & { sales_components: Comp };
type ComponentOpt = { id: string; code: string; name: string; unit: string; list_price?: number | null; max_discount_percent?: number | null };

const COLS = [
  "option_name", "zone", "circuit_note", "item_no", "kind",
  "customer_text", "qty", "unit", "unit_price", "discount_percent",
] as const;
type ColKey = (typeof COLS)[number];
const LAST_COL = COLS.length - 1;
/** table columns: drag handle, the COLS, total, cost (admin), actions */
const N_COLS = COLS.length + 3;
const COST_COL = COLS.length + 1;

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
  const [foTarget, setFoTarget] = useState<FoTarget | null>(null);
  const [linTarget, setLinTarget] = useState<LinearTarget | null>(null);
  const [clpTarget, setClpTarget] = useState<ClipsoTarget | null>(null);
  const [neoTarget, setNeoTarget] = useState<NeonTarget | null>(null);
  const [pvfTarget, setPvfTarget] = useState<FilmTarget | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const pendingFocus = useRef<{ id: string; c: number } | null>(null);
  const key = ["quote_lines", quotationId];
  const tableRef = useRef<HTMLTableElement>(null);
  const [measurementRevision, setMeasurementRevision] = useState(0);
  const [columnWidths, setColumnWidths] = useState([24, 70, 96, 112, 52, 136, 200, 90, 64, 100, 48, 112, 112, 176]);
  const trackWidth = (_id: string, _field: string, _value: string) =>
    setMeasurementRevision((old) => old + 1);

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
  // Rows built by the FO / linear builders (their price cells are managed in those windows).
  const { data: setLines } = useQuery({
    queryKey: ["set_lines", quotationId, lineIds.join(",")],
    enabled: lineIds.length > 0,
    queryFn: async () => {
      const [fo, lin, clp, neo, pvf] = await Promise.all([
        supabase.from("line_recipes").select("quote_line_id").in("quote_line_id", lineIds).like("note", "FO %"),
        supabase.from("line_recipes").select("quote_line_id, note").in("quote_line_id", lineIds).like("note", "LIN %"),
        supabase.from("line_recipes").select("quote_line_id, note").in("quote_line_id", lineIds).like("note", "CLP %"),
        supabase.from("line_recipes").select("quote_line_id, note").in("quote_line_id", lineIds).like("note", "NEO %"),
        supabase.from("line_recipes").select("quote_line_id, note").in("quote_line_id", lineIds).like("note", "PVF %"),
      ]);
      if (fo.error) throw fo.error;
      if (lin.error) throw lin.error;
      if (clp.error) throw clp.error;
      if (neo.error) throw neo.error;
      if (pvf.error) throw pvf.error;
      const pvfBlocks = new Map<string, FilmConfig>();
      const pvfRow = new Map<string, string>();
      for (const r of pvf.data) {
        const cfg = parseFilm(r.note);
        if (cfg) {
          pvfBlocks.set(cfg.blockId, cfg);
          for (const id of cfg.rowIds) pvfRow.set(id, cfg.blockId);
        }
        const bid = r.note?.split(" ")[1];
        if (bid) pvfRow.set(r.quote_line_id, bid);
      }
      const neoBlocks = new Map<string, NeonConfig>();
      const neoRow = new Map<string, string>();
      for (const r of neo.data) {
        if (r.note?.startsWith("NEO ROLLS")) continue; // rolls of the whole quotation, not a block
        const cfg = parseNeon(r.note);
        if (cfg) {
          neoBlocks.set(cfg.blockId, cfg);
          for (const id of cfg.rowIds) neoRow.set(id, cfg.blockId);
        }
        const bid = r.note?.split(" ")[1];
        if (bid) neoRow.set(r.quote_line_id, bid);
      }
      const clpBlocks = new Map<string, ClipsoConfig>();
      const clpRow = new Map<string, string>();
      for (const r of clp.data) {
        const cfg = parseClipso(r.note);
        if (cfg) {
          clpBlocks.set(cfg.blockId, cfg);
          for (const id of cfg.rowIds) clpRow.set(id, cfg.blockId);
        }
        const bid = r.note?.split(" ")[1];
        if (bid) clpRow.set(r.quote_line_id, bid);
      }
      const blocks = new Map<string, LinearConfig>();
      const rowBlock = new Map<string, string>();
      for (const r of lin.data) {
        const cfg = parseLinear(r.note);
        if (cfg) {
          blocks.set(cfg.blockId, cfg);
          for (const id of cfg.rowIds) rowBlock.set(id, cfg.blockId);
        }
        const bid = r.note?.split(" ")[1];
        if (bid) rowBlock.set(r.quote_line_id, bid);
      }
      return { fo: new Set(fo.data.map((d) => d.quote_line_id)), blocks, rowBlock, clpBlocks, clpRow, neoBlocks, neoRow, pvfBlocks, pvfRow };
    },
  });
  const foLines = setLines?.fo;
  const linBlockOf = (id: string) => {
    const bid = setLines?.rowBlock.get(id);
    return bid ? (setLines?.blocks.get(bid) ?? null) : null;
  };
  const clpBlockOf = (id: string) => {
    const bid = setLines?.clpRow.get(id);
    return bid ? (setLines?.clpBlocks.get(bid) ?? null) : null;
  };
  const neoBlockOf = (id: string) => {
    const bid = setLines?.neoRow.get(id);
    return bid ? (setLines?.neoBlocks.get(bid) ?? null) : null;
  };
  const pvfBlockOf = (id: string) => {
    const bid = setLines?.pvfRow.get(id);
    return bid ? (setLines?.pvfBlocks.get(bid) ?? null) : null;
  };
  /** Reopens the linear / FO / Clipso / Jedi flex / film window a row was built in. */
  const openSet = (l: GridLine) => {
    const lin = linBlockOf(l.id);
    const clp = clpBlockOf(l.id);
    const neo = neoBlockOf(l.id);
    const pvf = pvfBlockOf(l.id);
    if (pvf) {
      const blockRows = lines.filter((x) => pvf.rowIds.includes(x.id));
      const priced = blockRows.find((x) => x.kind === "priced");
      setPvfTarget({
        mode: "edit",
        config: pvf,
        option: blockRows[0]?.option_name ?? null,
        zone: blockRows[0]?.zone ?? null,
        discount: Number(priced?.discount_percent ?? 0),
      });
    } else if (neo) {
      const blockRows = lines.filter((x) => neo.rowIds.includes(x.id));
      const priced = blockRows.find((x) => x.kind === "priced");
      setNeoTarget({
        mode: "edit",
        config: neo,
        option: blockRows[0]?.option_name ?? null,
        zone: blockRows[0]?.zone ?? null,
        discount: Number(priced?.discount_percent ?? 0),
      });
    } else if (clp) {
      const blockRows = lines.filter((x) => clp.rowIds.includes(x.id));
      const priced = blockRows.find((x) => x.kind === "priced");
      setClpTarget({
        mode: "edit",
        config: clp,
        option: blockRows[0]?.option_name ?? null,
        zone: blockRows[0]?.zone ?? null,
        discount: Number(priced?.discount_percent ?? 0),
      });
    } else if (lin) {
      const blockRows = lines.filter((x) => lin.rowIds.includes(x.id));
      const priced = blockRows.find((x) => x.kind === "priced");
      setLinTarget({
        mode: "edit",
        config: lin,
        option: blockRows[0]?.option_name ?? null,
        zone: blockRows[0]?.zone ?? null,
        discount: Number(priced?.discount_percent ?? 0),
      });
    } else if (foLines?.has(l.id)) setFoTarget({ mode: "edit", line: l });
  };
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

  useLayoutEffect(() => {
    let active = true;
    const measure = () => {
      const table = tableRef.current;
      const context = document.createElement("canvas").getContext("2d");
      if (!active || !table || !context) return;
      const padding = (el: HTMLElement) => {
        const style = getComputedStyle(el);
        return parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
      };
      const textWidth = (el: HTMLElement, text: string) => {
        const style = getComputedStyle(el);
        context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        return Math.max(0, ...text.split("\n").map((line) => context.measureText(line).width));
      };
      const widths = Array.from({ length: N_COLS }, () => 0);
      for (const row of Array.from(table.rows)) {
        for (const [visibleIndex, cell] of Array.from(row.cells).entries()) {
          if (cell.colSpan !== 1) continue;
          const index = !canSeeCost && visibleIndex >= COST_COL ? visibleIndex + 1 : visibleIndex;
          const control = cell.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select");
          let contentWidth = 0;
          if (control) {
            const text = control instanceof HTMLSelectElement ? control.selectedOptions[0]?.text ?? "" : control.value || control.placeholder;
            contentWidth = textWidth(control, text) + padding(control) + (control instanceof HTMLSelectElement ? 24 : 4);
            for (const child of Array.from(cell.children)) {
              if (child instanceof HTMLElement && !child.contains(control)) contentWidth = Math.max(contentWidth, textWidth(child, child.innerText) + padding(child));
            }
          } else if (cell.querySelector("button")) {
            const group = cell.firstElementChild;
            if (group instanceof HTMLElement) {
              contentWidth = Array.from(group.querySelectorAll("button")).reduce((sum, button) => sum + textWidth(button, button.innerText) + padding(button), 0);
              contentWidth += Math.max(0, group.children.length - 1) * (parseFloat(getComputedStyle(group).columnGap) || 0);
            }
          } else {
            // textContent avoids measuring soft line wraps caused by the previous column width.
            contentWidth = textWidth(cell, cell.textContent ?? "");
          }
          widths[index] = Math.max(widths[index] ?? 0, Math.ceil(contentWidth + padding(cell) + 2));
        }
      }
      setColumnWidths((old) => old.every((width, index) => width === widths[index]) ? old : widths);
    };
    measure();
    // React's input event can update a child draft after the parent layout effect.
    // Measure again after that draft has reached the DOM.
    const frame = requestAnimationFrame(measure);
    document.fonts.ready.then(measure);
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [lines, costs, canSeeCost, canEdit, measurementRevision]);

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
  const persistOrder = async (ordered: GridLine[], inserts: GridLine[]): Promise<boolean> => {
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
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      qc.invalidateQueries({ queryKey: key });
    }
  };

  /** Used by the linear dialog: remove the block's old rows and put the new ones in the same place. */
  const replaceRows = async (oldIds: string[], rows: Partial<GridLine>[]) => {
    const old = new Set(oldIds);
    const first = lines.findIndex((l) => old.has(l.id));
    const keep = lines.filter((l) => !old.has(l.id));
    const at = first < 0 ? keep.length : lines.slice(0, first).filter((l) => !old.has(l.id)).length;
    if (oldIds.length) {
      const { error } = await supabase.from("quote_lines").delete().in("id", oldIds);
      if (error) throw error;
    }
    const fresh = rows.map((r) => ({ ...blankRow(), ...r }) as GridLine);
    const next = [...keep];
    next.splice(at, 0, ...fresh);
    const ok = await persistOrder(next, fresh);
    if (!ok) throw new Error("บันทึกบรรทัดไม่สำเร็จ");
  };

  /** Used by the FO set dialog: append a line at the end and return its id once saved. */
  const createLineAtEnd = async (fields: Partial<GridLine>): Promise<string> => {
    const row = { ...blankRow(lines[lines.length - 1]), ...fields } as GridLine;
    const ok = await persistOrder([...lines, row], [row]);
    if (!ok) throw new Error("เพิ่มบรรทัดไม่สำเร็จ");
    return row.id;
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

  const addRowAfter = (index: number, kind = "priced") => {
    const base = index >= 0 ? lines[index] : undefined;
    const row = { ...blankRow(base), kind };
    const next = [...lines];
    next.splice(index + 1, 0, row);
    pendingFocus.current = { id: row.id, c: 0 };
    void persistOrder(next, [row]);
  };

  const removeRow = async (id: string) => {
    const wasRun = !!lines.find((r) => r.id === id && r.component_id && r.cut_lengths?.length);
    setLocal((rows) => rows.filter((r) => r.id !== id));
    const { error } = await supabase.from("quote_lines").delete().eq("id", id);
    if (error) toast.error(error.message);
    // a Jedi flex run gone → the rest of that model shares a new roll plan / price per metre
    if (!error && wasRun) await rebalanceNeon(quotationId).catch((e: Error) => toast.error(e.message));
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

  const commitText = (l: GridLine, k: Exclude<ColKey, "kind">, raw: string) => {
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

  const fade = (l: GridLine) => !!selectedOption && optKey(l) !== "" && optKey(l) !== selectedOption;

  return (
    <div className="mt-4">
      <div className="overflow-x-auto rounded-md border border-border">
        <table ref={tableRef} className="table-fixed border-collapse text-sm" style={{ width: columnWidths.reduce((sum, width, index) => sum + (index === COST_COL && !canSeeCost ? 0 : width), 0) }}>
          <colgroup>
            {columnWidths.map((width, index) => index === COST_COL && !canSeeCost ? null : <col key={index} style={{ width }} />)}
          </colgroup>
          <thead className="bg-secondary text-left text-sm text-muted-foreground">
            <tr>
              <th />
              <H>Option</H>
              <H>โซน</H>
              <H>เลขวงจร</H>
              <H>Item</H>
              <H>ประเภท</H>
              <H>รายละเอียด (ลูกค้าเห็น)</H>
              <H w="text-right">จำนวนรวม</H>
              <H>หน่วย</H>
              <H w="text-right">@ราคา</H>
              <H w="text-right">%ลด</H>
              <H w="text-right">รวม</H>
              {canSeeCost ? <H w="text-right" internal>ต้นทุน</H> : null}
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, r) => {
              const heading = l.kind === "heading";
              const buyer = l.kind === "by_buyer" || l.kind === "existing";
              const internal = l.kind === "internal";
              const rowCls = [
                "border-t border-border",
                internal ? "bg-accent/30 italic" : "",
                heading ? "bg-muted font-semibold" : "",
                buyer ? "italic text-by-buyer" : "",
                fade(l) ? "opacity-40" : "",
                overId === l.id && dragId ? "outline outline-2 outline-primary" : "",
              ].join(" ");
              const cost = lineCost(l);
              const amount = lineAmount(l);
              const lin = linBlockOf(l.id);
              const clp = clpBlockOf(l.id);
              const neo = neoBlockOf(l.id);
              const pvf = pvfBlockOf(l.id);
              const isFo = !!foLines?.has(l.id) || !!lin || !!clp || !!neo || !!pvf;
              const setName = pvf ? "ชุด Privacy film" : neo ? "ชุด Jedi flex" : clp ? "ชุด Clipso" : lin ? "ชุดไฟเส้น" : "ชุด FO";
              // first line of a linear / Clipso / Jedi flex block, or the FO line, carries the "edit set" shortcut
              const block = lin ?? clp ?? neo ?? pvf;
              const setStart = block
                ? lines.find((x) => block.rowIds.includes(x.id))?.id === l.id
                : !!foLines?.has(l.id);
              const txt = (k: Parameters<typeof commitText>[1], c: number, extra = "") => (
                <td className="px-0.5 py-0.5">
                  <CellInput
                    cell={`${r}:${c}`}
                    value={l[k] === null || l[k] === undefined ? "" : String(l[k])}
                    disabled={
                      !canEdit ||
                      (k === "unit" && !!l.component_id) ||
                      // FO sets: price, qty and unit are managed in the FO window (where discount limits apply)
                      (isFo && (k === "unit_price" || k === "qty" || k === "unit"))
                    }
                    className={extra}
                    onDraftChange={(value) => trackWidth(l.id, k, value)}
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
                        onDraftChange={(value) => trackWidth(l.id, "circuit_note", value)}
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
                      {setStart ? (
                        <button
                          type="button"
                          className="mx-1 mt-1 rounded border border-primary/40 bg-primary/5 px-2 py-0.5 text-xs font-medium not-italic text-primary hover:bg-primary/10"
                          onClick={() => openSet(l)}
                        >
                          ✎ {canEdit ? "แก้" : "ดู"}{setName}
                        </button>
                      ) : null}
                       <DescriptionCell
                        cell={`${r}:5`}
                        value={l.customer_text ?? ""}
                        placeholder={l.sales_components?.name ?? ""}
                        disabled={!canEdit && !isFo}
                        {...(isFo ? { onOpen: () => openSet(l) } : {})}
                         onDraftChange={(value) => trackWidth(l.id, "customer_text", value)}
                        onCommit={(v) => commitText(l, "customer_text", v)}
                         onKeyDown={(e) => {
                           if (["Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
                           onKey(e, r, 5);
                         }}
                      />
                    </td>
                    {txt("qty", 6, "text-right")}
                    {txt("unit", 7)}
                    {txt("unit_price", 8, "text-right")}
                    {(() => {
                      const max = !isFo && l.component_id ? compMap.get(l.component_id)?.max_discount_percent : null;
                      return (
                        <td
                          className="px-0.5 py-0.5"
                          title={isFo ? `แก้ราคา/ส่วนลดที่ปุ่ม แก้${setName}` : max != null ? `ลดได้สูงสุด ${max}%` : undefined}
                        >
                          <CellInput
                            cell={`${r}:9`}
                            value={String(l.discount_percent ?? "")}
                            placeholder={max != null ? `≤${max}` : ""}
                            disabled={!canEdit || isFo}
                            className="text-right"
                            onDraftChange={(value) => trackWidth(l.id, "discount_percent", value)}
                            onCommit={(v) => commitText(l, "discount_percent", v)}
                            onKeyDown={(e) => onKey(e, r, 9)}
                          />
                          {max != null ? <div className="px-1 text-right text-xs text-muted-foreground">สูงสุด<br />{max}%</div> : null}
                        </td>
                      );
                    })()}
                    <td className="px-1.5 text-right tabular-nums">
                      {l.kind === "priced" ? formatTHB(amount) : internal ? <span className="text-xs">ใบ Work เท่านั้น</span> : kindText(l.kind)}
                    </td>
                    {canSeeCost ? (
                      <td className="bg-accent/30 px-1.5 text-right tabular-nums text-muted-foreground">
                        {heading || cost === null ? "" : formatTHB(cost)}
                      </td>
                    ) : null}
                    <td className="whitespace-nowrap px-1 py-0.5 not-italic">
                      <div className="flex gap-1">
                        {lin || clp || neo || pvf ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-primary"
                            onClick={() => openSet(l)}
                          >
                            {canEdit ? "แก้" : "ดู"}{setName}
                          </Button>
                        ) : !heading && foLines?.has(l.id) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-primary"
                            onClick={() => setFoTarget({ mode: "edit", line: l })}
                          >
                            {canEdit ? "แก้ชุด FO" : "ดูชุด FO"}
                          </Button>
                        ) : !heading && !internal ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2"
                            onClick={() => setOpenRecipe(l.id)}
                          >
                            สูตรภายใน
                          </Button>
                        ) : heading && canEdit ? (
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
                <td colSpan={N_COLS} className="px-3 py-4 text-muted-foreground">
                  ยังไม่มีรายการ BOQ
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {canEdit ? (
          <>
            <Button size="sm" variant="outline" onClick={() => addRowAfter(lines.length - 1)}>
              + เพิ่มบรรทัด
            </Button>
            <Button size="sm" variant="outline" onClick={() => setLinTarget({ mode: "new", option: lines[lines.length - 1]?.option_name ?? null })}>
              + เพิ่มชุด LED linear
            </Button>
            <Button size="sm" variant="outline" onClick={() => setNeoTarget({ mode: "new", option: lines[lines.length - 1]?.option_name ?? null })}>
              + เพิ่มชุด Jedi flex
            </Button>
            <Button size="sm" variant="outline" onClick={() => setFoTarget({ mode: "new", option: lines[lines.length - 1]?.option_name ?? null })}>
              + เพิ่มชุด Fiber Optic
            </Button>
            <Button size="sm" variant="outline" onClick={() => setClpTarget({ mode: "new", option: lines[lines.length - 1]?.option_name ?? null })}>
              + เพิ่มชุด Clipso
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPvfTarget({ mode: "new", option: lines[lines.length - 1]?.option_name ?? null })}>
              + เพิ่มชุด Privacy film
            </Button>
          </>
        ) : null}
        <span className="text-xs text-muted-foreground">
          Tab/ลูกศร = ย้ายช่อง · Enter = ลงบรรทัดถัดไป · Enter ที่ช่องสุดท้าย = เพิ่มบรรทัดใต้ · ลาก ⋮⋮ เพื่อจัดลำดับ ·
          คอลัมน์พื้นสีเหลือง = <b>ภายใน</b> (ไม่พิมพ์ให้ลูกค้า)
        </span>
      </div>
      {linTarget ? (
        <LinearDialog
          target={linTarget}
          quotationId={quotationId}
          canSeeCost={canSeeCost}
          replaceRows={replaceRows}
          onClose={() => setLinTarget(null)}
        />
      ) : null}
      {pvfTarget ? (
        <FilmDialog
          target={pvfTarget}
          quotationId={quotationId}
          canSeeCost={canSeeCost}
          replaceRows={replaceRows}
          onClose={() => setPvfTarget(null)}
        />
      ) : null}
      {neoTarget ? (
        <NeonDialog
          target={neoTarget}
          quotationId={quotationId}
          canSeeCost={canSeeCost}
          replaceRows={replaceRows}
          onClose={() => setNeoTarget(null)}
        />
      ) : null}
      {clpTarget ? (
        <ClipsoDialog
          target={clpTarget}
          quotationId={quotationId}
          canSeeCost={canSeeCost}
          replaceRows={replaceRows}
          onClose={() => setClpTarget(null)}
        />
      ) : null}
      {foTarget ? (
        <FoSetDialog
          target={foTarget}
          quotationId={quotationId}
          canSeeCost={canSeeCost}
          createLine={createLineAtEnd}
          onClose={() => setFoTarget(null)}
        />
      ) : null}
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

function DescriptionCell({ cell, value, placeholder, disabled, onOpen, onCommit, onKeyDown, onDraftChange }: {
  cell: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  /** Rows made by the linear / FO windows: text is read-only here, click (or Enter) reopens the window. */
  onOpen?: () => void;
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
      readOnly={!!onOpen}
      title={onOpen ? "คลิกเพื่อแก้ในหน้าต่างชุด" : undefined}
       rows={Math.max(2, shown.split("\n").length)}
       wrap="off"
       className={"w-full min-w-0 max-w-none resize-y whitespace-pre border-transparent bg-transparent px-2 py-2 text-base shadow-none" + (onOpen ? " cursor-pointer hover:bg-primary/5" : "")}
      onClick={onOpen}
      onChange={(e) => { setDraft(e.target.value); onDraftChange?.(e.target.value); }}
      onKeyDown={(e) => {
        if (onOpen && e.key === "Enter") { e.preventDefault(); onOpen(); return; }
        onKeyDown(e);
      }}
      onBlur={() => { if (onOpen) return; if (!onCommit(draft)) { setDraft(value); onDraftChange?.(value || placeholder || ""); } }}
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
      onBlur={() => { if (v !== value && onCommit(v) === false) { setV(value); onDraftChange?.(value); } }}
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

