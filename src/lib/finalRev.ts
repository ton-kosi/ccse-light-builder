/**
 * Final Rev: what the site measurements change, line by line, before anyone bills it.
 * LED linear, Clipso and Canoe blocks are rebuilt from the measured lengths / sizes, so their materials,
 * power supplies and rails follow. Contract price levels stay: a row keeps the ratio between its contract
 * price and what the builder calculates today, so a later SKU price change or a special price is not lost.
 * Other lines keep their row; their one-off materials scale with the quantity. Pure functions.
 */
import { buildCanoe, parseCanoe, runsFromSpec, type CanoeConfig } from "./canoe";
import { buildClipso, parseClipso, type ClipsoConfig, type Panel } from "./clipso";
import { formatCutSpec, parseCutSpec, runsFromPieces, type CutRun } from "./cutSpec";
import type { PartPrice } from "./fo";
import { buildLinear, circuitQty, parseLinear, type Circuit, type LinearConfig } from "./linear";
import { decodeOpenings, roleOf, type WosSku } from "./wos";

export type FrLine = {
  id: string;
  kind: string;
  item_no: string | null;
  customer_text: string | null;
  option_name: string | null;
  zone: string | null;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  discount_percent: number;
};
export type FrRecipe = { quote_line_id: string; sku_id: string; qty: number | string; note: string | null };
export type FrMeasure = {
  measured_qty: number | null;
  cut_lengths: number[] | null;
  cut_spec?: string | null | undefined;
  note: string | null;
  measured_at: string;
};
export type FrSku = WosSku & { notes?: string | null };
export type BlockType = "linear" | "clipso" | "canoe";

type BuiltRow = {
  id: string;
  kind: string;
  item_no?: string | null | undefined;
  customer_text: string;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  cut_lengths?: number[] | null | undefined;
  recipes: { sku_id: string; qty: number; note: string }[];
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * The rows of a block. A new Rev copies the saved settings with the previous Rev's row ids, so when
 * those are gone the rows are found from the materials tagged with the block: its span, widened up
 * over the headings just above it and down over rows without materials (never a heading or a note,
 * which start something else), up to the row count it was saved with.
 */
export function healRowIds(
  saved: string[],
  lineIds: string[],
  tagged: Iterable<string>,
  withMaterials: Set<string>,
  kindOf: (id: string) => string | undefined = () => undefined,
): string[] {
  const have = new Set(lineIds);
  if (saved.length && saved.every((id) => have.has(id))) return saved;
  const mine = new Set(tagged);
  const at = lineIds.flatMap((id, i) => (mine.has(id) ? [i] : []));
  if (!at.length) return [];
  let a = at[0]!;
  let b = at[at.length - 1]!;
  while (b - a + 1 < saved.length && a > 0 && !withMaterials.has(lineIds[a - 1]!) && kindOf(lineIds[a - 1]!) === "heading") a--;
  const ends = (id: string) => withMaterials.has(id) || ["heading", "internal"].includes(kindOf(id) ?? "");
  while (b - a + 1 < saved.length && b < lineIds.length - 1 && !ends(lineIds[b + 1]!)) b++;
  return lineIds.slice(a, b + 1);
}

/** The LED linear, Clipso and Canoe blocks of a quotation, with their rows in order. */
export function findBlocks(lines: FrLine[], recipes: FrRecipe[]) {
  const ids = lines.map((l) => l.id);
  const kindOf = (id: string) => lines.find((l) => l.id === id)?.kind;
  const withMaterials = new Set(recipes.filter((r) => /^(LIN|CLP|CNO|NEO|PVF|FO) /.test(r.note ?? "")).map((r) => r.quote_line_id));
  const out: { type: BlockType; config: LinearConfig | ClipsoConfig | CanoeConfig; rows: FrLine[] }[] = [];
  for (const r of recipes) {
    const config = parseLinear(r.note) ?? parseClipso(r.note) ?? parseCanoe(r.note);
    if (!config) continue;
    const type: BlockType = r.note!.startsWith("LIN ") ? "linear" : r.note!.startsWith("CLP ") ? "clipso" : "canoe";
    const bid = r.note!.split(" ")[1];
    const tagged = recipes.filter((x) => x.note?.split(" ")[1] === bid).map((x) => x.quote_line_id);
    const rowIds = healRowIds(config.rowIds, ids, tagged, withMaterials, kindOf);
    out.push({ type, config, rows: lines.filter((l) => rowIds.includes(l.id)) });
  }
  return out;
}

/** "1.88M x 1.85M x 3PCS." / "DIA : 2.16M" → the opening; null = can't read it. */
export function panelFromSize(size: string, base: Panel): Panel | null {
  const rect = size.match(/^([\d.]+)M x ([\d.]+)M(?: x (\d+)PCS\.)?$/);
  if (rect) return { ...base, shape: "rect", w: Number(rect[1]), l: Number(rect[2]), qty: rect[3] ? Number(rect[3]) : base.qty };
  const dia = size.match(/^DIA : ([\d.]+)M$/);
  if (dia) return { ...base, shape: "circle", w: Number(dia[1]), l: Number(dia[1]) };
  return null;
}

const runsOf = (m: FrMeasure): CutRun[] | null => {
  if (m.cut_spec) {
    const spec = parseCutSpec(m.cut_spec);
    if (!("error" in spec)) return spec.runs;
  }
  return m.cut_lengths?.length ? runsFromPieces(m.cut_lengths.map(Number)) : null;
};

/** The block's settings with the measurements in; same object when nothing was measured. */
export function measuredConfig(
  type: BlockType,
  config: LinearConfig | ClipsoConfig | CanoeConfig,
  rows: FrLine[],
  recipesOf: (lineId: string) => FrRecipe[],
  measureOf: (lineId: string) => FrMeasure | undefined,
  /** quantity to bill for a measured line (the production sheet's cut length where there is one) */
  billedOf: (lineId: string, m: FrMeasure) => number,
): LinearConfig | ClipsoConfig | CanoeConfig {
  const hasRole = (id: string, role: string) => recipesOf(id).some((r) => roleOf(r.note) === role);
  if (type === "linear") {
    const c = config as LinearConfig;
    const ledRows = rows.filter((l) => hasRole(l.id, "LED"));
    let i = 0;
    let changed = false;
    const circuits = c.circuits.map((ck): Circuit => {
      if (!(circuitQty(ck, c) > 0)) return ck;
      const row = ledRows[i++];
      const m = row && measureOf(row.id);
      if (!m || (m.measured_qty == null && !m.cut_lengths?.length)) return ck;
      changed = true;
      const billed = billedOf(row.id, m);
      const lengths = m.cut_lengths?.length ? m.cut_lengths.map(Number) : [Number(m.measured_qty)];
      return { ...ck, lengths, runs: runsOf(m) ?? runsFromPieces(lengths), billedM: billed };
    });
    return changed ? { ...c, circuits } : c;
  }
  if (type === "clipso") {
    const c = config as ClipsoConfig;
    const valid = c.panels.filter((p) => p.w > 0 && (p.shape === "circle" || p.l > 0) && p.qty > 0);
    const fabricRows = rows.filter((l) => hasRole(l.id, "FABRIC"));
    const sizes: (string | undefined)[] = c.combined
      ? (decodeOpenings(measureOf(fabricRows[0]?.id ?? "")?.cut_spec) ?? [])
      : fabricRows.map((l) => decodeOpenings(measureOf(l.id)?.cut_spec)?.[0]);
    if (!sizes.some(Boolean)) return c;
    return { ...c, panels: valid.map((p, i) => (sizes[i] ? (panelFromSize(sizes[i]!, p) ?? p) : p)) };
  }
  const c = config as CanoeConfig;
  for (const l of rows) {
    const m = measureOf(l.id);
    const runs = m && runsOf(m);
    if (runs) return { ...c, runs: runsFromSpec(runs), spec: formatCutSpec(runs) };
  }
  return c;
}

/** Same kind of row in the two versions: kind + its material roles, or its words when it has none. */
const keyer = () => {
  const seen = new Map<string, number>();
  return (kind: string, roles: string[], text: string | null) => {
    const base = `${kind}|${roles.length ? [...roles].sort().join(",") : (text ?? "").replace(/[\d.]+/g, "#")}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}|${n}`;
  };
};

const amountOf = (qty: number | null, price: number | null, disc: number) => r2(Number(qty ?? 0) * Number(price ?? 0) * (1 - disc / 100));

export type DiffItem = { text: string; oldQty: number | null; newQty: number | null; unit: string | null; oldAmount: number; newAmount: number };
export type MaterialDiff = { skuId: string; oldQty: number; newQty: number };

/** Everything priced and material that differs between the contract rows and the rebuilt rows. */
export function diffRows(
  oldRows: { key: string; line: FrLine; recipes: FrRecipe[] }[],
  newRows: { key: string; row: BuiltRow; discount: number }[],
) {
  const oldBy = new Map(oldRows.map((x) => [x.key, x]));
  const newBy = new Map(newRows.map((x) => [x.key, x]));
  const label = (t: string | null) => (t ?? "").split("\n")[0] ?? "";
  const items: DiffItem[] = [];
  for (const n of newRows) {
    if (n.row.kind !== "priced") continue;
    const o = oldBy.get(n.key);
    const oldAmount = o ? amountOf(o.line.qty, o.line.unit_price, Number(o.line.discount_percent ?? 0)) : 0;
    const newAmount = amountOf(n.row.qty, n.row.unit_price, n.discount);
    const oldQty = o ? Number(o.line.qty ?? 0) : null;
    if (oldQty !== Number(n.row.qty ?? 0) || oldAmount !== newAmount)
      items.push({ text: label(n.row.customer_text), oldQty, newQty: Number(n.row.qty ?? 0), unit: n.row.unit, oldAmount, newAmount });
  }
  for (const o of oldRows) {
    if (o.line.kind === "priced" && !newBy.has(o.key))
      items.push({
        text: label(o.line.customer_text),
        oldQty: Number(o.line.qty ?? 0),
        newQty: null,
        unit: o.line.unit,
        oldAmount: amountOf(o.line.qty, o.line.unit_price, Number(o.line.discount_percent ?? 0)),
        newAmount: 0,
      });
  }
  const totals = new Map<string, { a: number; b: number }>();
  const put = (id: string, a: number, b: number) => {
    const t = totals.get(id) ?? { a: 0, b: 0 };
    totals.set(id, { a: r3(t.a + a), b: r3(t.b + b) });
  };
  for (const o of oldRows) for (const r of o.recipes) put(r.sku_id, Number(r.qty), 0);
  for (const n of newRows) for (const r of n.row.recipes) put(r.sku_id, 0, Number(r.qty));
  const materials: MaterialDiff[] = [...totals]
    .filter(([, t]) => t.a !== t.b)
    .map(([skuId, t]) => ({ skuId, oldQty: t.a, newQty: t.b }));
  return { items, materials };
}

export type RebuiltBlock = {
  rows: (BuiltRow & { discount_percent: number; option_name: string | null; zone: string | null })[];
  /** measurements to keep on the new rows (for the WOS and the production sheet) */
  carry: { rowId: string; measure: FrMeasure; measuredQty: number | null }[];
  items: DiffItem[];
  materials: MaterialDiff[];
  amountDiff: number;
  /** rows that changed but have no selling price today: they stay at the contract price */
  noPrice: boolean;
};

/** Rebuilds one block from its measurements; null when nothing in it was measured. */
export function rebuildBlock(
  type: BlockType,
  config: LinearConfig | ClipsoConfig | CanoeConfig,
  rows: FrLine[],
  ctx: {
    recipesOf: (lineId: string) => FrRecipe[];
    measureOf: (lineId: string) => FrMeasure | undefined;
    billedOf: (lineId: string, m: FrMeasure) => number;
    prices: Map<string, PartPrice>;
    skuOf: (id: string) => FrSku | undefined;
    newId: () => string;
  },
): RebuiltBlock | null {
  const itemNo = rows[0]?.item_no ?? (config as { itemNo?: string | null }).itemNo ?? null;
  const original = { ...config, itemNo } as typeof config;
  const measured = measuredConfig(type, original, rows, ctx.recipesOf, ctx.measureOf, ctx.billedOf);
  if (measured === original) return null;
  const build = (c: typeof config): BuiltRow[] => {
    if (type === "linear") return buildLinear(c as LinearConfig, ctx.prices, ctx.newId).rows as BuiltRow[];
    if (type === "clipso") return buildClipso(c as ClipsoConfig, ctx.prices, ctx.newId).rows as BuiltRow[];
    const cc = c as CanoeConfig;
    return buildCanoe(cc, ctx.skuOf(cc.ledSkuId), ctx.prices, ctx.newId, (id) => ctx.skuOf(id)?.unit ?? undefined).rows as BuiltRow[];
  };
  const rolesOf = (rs: { note: string | null }[]) => rs.map((r) => roleOf(r.note));
  const keyOld = keyer();
  const oldRows = rows.map((line) => {
    const recipes = ctx.recipesOf(line.id);
    return { key: keyOld(line.kind, rolesOf(recipes), line.customer_text), line, recipes };
  });
  const keyBase = keyer();
  const baseBy = new Map(build(original).map((b) => [keyBase(b.kind, rolesOf(b.recipes), b.customer_text), b]));
  const firstPriced = rows.find((l) => l.kind === "priced");
  const oldBy = new Map(oldRows.map((x) => [x.key, x]));
  const keyNew = keyer();
  let noPrice = false;
  const built = build(measured).map((row) => {
    const key = keyNew(row.kind, rolesOf(row.recipes), row.customer_text);
    const old = oldBy.get(key)?.line;
    const base = baseBy.get(key);
    let unit_price = row.unit_price;
    if (row.kind === "priced" && old) {
      const contract = Number(old.unit_price ?? 0);
      const calculated = Number(base?.unit_price ?? 0);
      unit_price = calculated > 0 ? r2(Number(row.unit_price ?? 0) * (contract / calculated)) : contract > 0 ? contract : row.unit_price;
      if (!(calculated > 0) && contract > 0) noPrice = true;
    }
    const discount = row.kind === "priced" ? Number((old ?? firstPriced)?.discount_percent ?? 0) : 0;
    return { key, row: { ...row, unit_price }, discount };
  });
  const { items, materials } = diffRows(oldRows, built);
  const carry: RebuiltBlock["carry"] = [];
  for (const b of built) {
    const old = oldBy.get(b.key)?.line;
    const m = old && ctx.measureOf(old.id);
    if (m) carry.push({ rowId: b.row.id, measure: m, measuredQty: m.measured_qty != null || m.cut_lengths?.length ? b.row.qty : null });
  }
  return {
    rows: built.map((b, i) => ({
      ...b.row,
      discount_percent: b.discount,
      option_name: rows[0]?.option_name ?? null,
      zone: i === 0 ? (rows[0]?.zone ?? null) : null,
    })),
    carry,
    items,
    materials,
    amountDiff: r2(items.reduce((s, x) => s + x.newAmount - x.oldAmount, 0)),
    noPrice,
  };
}

/** Additions and reductions of the lines chosen, in money before VAT. */
export function splitDiffs(diffs: number[]) {
  const add = r2(diffs.filter((d) => d > 0).reduce((s, d) => s + d, 0));
  const cut = r2(diffs.filter((d) => d < 0).reduce((s, d) => s + d, 0));
  return { add, cut, net: r2(add + cut) };
}
