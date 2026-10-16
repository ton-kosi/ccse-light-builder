/**
 * Neon flex (offered to customers as JEDI FLEX).
 *
 * - Sold by the roll: 5 m and 10 m rolls; offcuts can't be joined, so every run is cut from one
 *   roll (runs longer than a roll are split into roll-length pieces).
 * - Pieces are rounded up to the cut step (e.g. 5 cm / 3.33 cm) and packed into rolls so the
 *   rolls bought cost as little as possible (10 m rolls, or 5 m / two 5 m when cheaper).
 * - Customer price per metre = (rolls + accessories) of that model across the WHOLE quotation ÷
 *   metres, so every line of the same model shows the same price per metre.
 * - Long leftovers go back to stock as remnants when the material is issued (existing roll plan).
 */
import type { PartPrice } from "./fo";
import { dimLabel, pickPsu, type DimType, type PsuOption } from "./linear";
import { inCategory, readTags } from "./skuCategory";

/* ---------------------------------------------------------------- models (CCSE spec sheets) */

export type JediFlexModel = { key: string; title: string; wattPerM: number; cutMm: number; reelM: number };

export const JEDI_FLEX_MODELS: JediFlexModel[] = [
  { key: "0410", title: "0410 SIDE BEND", wattPerM: 10, cutMm: 50, reelM: 5 },
  { key: "0612", title: "0612 SIDE BEND", wattPerM: 10, cutMm: 50, reelM: 5 },
  { key: "0816", title: "0816 SIDE BEND", wattPerM: 12, cutMm: 50, reelM: 5 },
  { key: "1010", title: "1010 UP-DOWN BEND", wattPerM: 14, cutMm: 33.3, reelM: 5 },
  { key: "1018", title: "1018 SIDE BEND", wattPerM: 14, cutMm: 50, reelM: 5 },
  { key: "1018RGB", title: "1018 RGB SIDE BEND", wattPerM: 14, cutMm: 100, reelM: 5 },
  { key: "1307", title: "1307 UP-DOWN BEND", wattPerM: 18, cutMm: 33.3, reelM: 5 },
  { key: "1616B", title: "1616B UP-DOWN BEND", wattPerM: 16, cutMm: 50, reelM: 5 },
  { key: "R15", title: "R15 360°", wattPerM: 11, cutMm: 50, reelM: 5 },
];
export const jediFlexModel = (key: string | null | undefined) =>
  JEDI_FLEX_MODELS.find((m) => m.key === key) ?? null;

/* ---------------------------------------------------------------- roll packing */

export type RollPrice = { skuId: string; length: number; price: number | null };
export type Roll = { skuId: string; length: number; pieces: number[]; used: number; left: number };

const cm = (m: number) => Math.round(m * 100);
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Pieces actually cut: rounded up to the cut step, runs longer than a roll split up. */
export function cutPieces(lengths: number[], stepCm: number, maxPieceM: number): number[] {
  const out: number[] = [];
  for (const raw of lengths) {
    if (!(raw > 0)) continue;
    let x = raw;
    while (x > maxPieceM + 1e-9) {
      out.push(maxPieceM);
      x -= maxPieceM;
    }
    const rounded = stepCm > 0 ? (Math.ceil(Math.round((x * 100) / stepCm * 1e6) / 1e6) * stepCm) / 100 : x;
    out.push(r2(rounded));
  }
  return out;
}

/** Can these pieces be split into two groups that each fit `cap`? */
function splitsInTwo(pieces: number[], cap: number): [number[], number[]] | null {
  const total = pieces.reduce((s, p) => s + cm(p), 0);
  const C = cm(cap);
  if (total > 2 * C) return null;
  // subset-sum over centimetres, remembering which piece got us there
  const from = new Map<number, { prev: number; i: number }>();
  from.set(0, { prev: -1, i: -1 });
  pieces.forEach((p, i) => {
    for (const s of [...from.keys()].sort((a, b) => b - a)) {
      const n = s + cm(p);
      if (n <= C && !from.has(n)) from.set(n, { prev: s, i });
    }
  });
  const best = [...from.keys()].filter((s) => total - s <= C).sort((a, b) => b - a)[0];
  if (best === undefined) return null;
  const pick = new Set<number>();
  for (let s = best; s > 0; ) {
    const st = from.get(s)!;
    pick.add(st.i);
    s = st.prev;
  }
  return [pieces.filter((_, i) => pick.has(i)), pieces.filter((_, i) => !pick.has(i))];
}

/**
 * Packs pieces into rolls: longest first into the biggest roll that has room; then each roll is
 * swapped for a 5 m roll (or split into two 5 m rolls) when that costs less.
 */
export function packRolls(pieces: number[], rolls: RollPrice[]): Roll[] {
  const sizes = [...rolls].filter((r) => r.length > 0).sort((a, b) => b.length - a.length);
  const big = sizes[0];
  const small = sizes.find((r) => r.length < (big?.length ?? 0));
  if (!big) return [];
  const bins: number[][] = [];
  const room: number[] = [];
  for (const p of [...pieces].sort((a, b) => b - a)) {
    let at = -1;
    for (let i = 0; i < bins.length; i++)
      if (room[i]! >= cm(p) && (at < 0 || room[i]! < room[at]!)) at = i;
    if (at < 0) {
      bins.push([p]);
      room.push(cm(big.length) - cm(p));
    } else {
      bins[at]!.push(p);
      room[at]! -= cm(p);
    }
  }
  const price = (r: RollPrice | undefined) => r?.price ?? Number.POSITIVE_INFINITY;
  const out: Roll[] = [];
  const roll = (r: RollPrice, ps: number[]): Roll => {
    const used = r2(ps.reduce((s, x) => s + x, 0));
    return { skuId: r.skuId, length: r.length, pieces: ps, used, left: r2(r.length - used) };
  };
  for (const b of bins) {
    const used = b.reduce((s, x) => s + x, 0);
    if (small && used <= small.length + 1e-9 && price(small) <= price(big)) {
      out.push(roll(small, b));
      continue;
    }
    const two = small ? splitsInTwo(b, small.length) : null;
    if (small && two && 2 * price(small) < price(big)) {
      out.push(roll(small, two[0]), roll(small, two[1]));
      continue;
    }
    out.push(roll(big, b));
  }
  return out;
}

/* ---------------------------------------------------------------- config + rows */

export type NeonRun = { ckt: string; lengths: number[] };

export type NeonConfig = {
  v: 1;
  blockId: string;
  typeCode: string;
  /** roll family (skus.roll_family) = one model + colour */
  family: string;
  /** customer name, e.g. JEDI FLEX 0410 SIDE BEND 10W/M 24V 3000K IP67 */
  name: string;
  wattPerM: number;
  dim: DimType;
  psuOptions: PsuOption[];
  loadFactor: number;
  /** accessories priced into the metre price */
  endCapSkuId: string | null; // per piece
  mountSkuId: string | null; // per metre
  mountPerM: number;
  runs: NeonRun[];
  rowIds: string[];
};

export type NeonFamily = {
  family: string;
  rolls: RollPrice[];
  stepCm: number;
  maxPieceM: number;
  wattPerM: number | null;
  model: JediFlexModel | null;
  componentId: string | null;
  sample: string;
};

export const NEO_TAG = "NEO ";
export const isNeoNote = (n: string | null | undefined) => !!n && n.startsWith(NEO_TAG);
const m = (x: number) => `${x.toFixed(2)}M`;
export const runLength = (r: NeonRun) => r2(r.lengths.reduce((s, x) => s + (x > 0 ? x : 0), 0));

/** One run line of a family in the quotation: its cut lengths and the accessories on it. */
export type NeonItem = { lengths: number[]; extras: { skuId: string; qty: number }[] };

/** The run lines a config will create (for pricing before it is saved). */
export function configItems(c: NeonConfig, f: NeonFamily): NeonItem[] {
  return c.runs
    .filter((r) => runLength(r) > 0)
    .map((r) => {
      const extras: NeonItem["extras"] = [];
      const pieces = cutPieces(r.lengths, f.stepCm, f.maxPieceM).length;
      if (c.endCapSkuId) extras.push({ skuId: c.endCapSkuId, qty: pieces });
      if (c.mountSkuId && c.mountPerM > 0) extras.push({ skuId: c.mountSkuId, qty: r2(runLength(r) * c.mountPerM) });
      return { lengths: r.lengths.filter((x) => x > 0), extras };
    });
}

/**
 * Price per metre of one family across the quotation: rolls for every run of that family packed
 * together + their accessories, ÷ metres — the same price on every line of that model.
 */
export function familyPrice(family: NeonFamily, items: NeonItem[], prices: Map<string, PartPrice>) {
  const pieces = cutPieces(items.flatMap((i) => i.lengths), family.stepCm, family.maxPieceM);
  const rolls = packRolls(
    pieces,
    family.rolls.map((r) => ({ ...r, price: prices.get(r.skuId)?.unitPrice ?? r.price })),
  );
  const missing = new Set<string>();
  let cost = 0;
  let allowed = 0;
  const add = (qty: number, id: string) => {
    const p = prices.get(id);
    if (!p) missing.add(id);
    const amount = qty * (p?.unitPrice ?? 0);
    cost += amount;
    allowed += (amount * (p?.maxDiscount ?? 0)) / 100;
  };
  for (const r of rolls) add(1, r.skuId);
  for (const i of items) for (const e of i.extras) add(e.qty, e.skuId);
  const meters = r2(items.reduce((s, i) => s + i.lengths.reduce((a, x) => a + x, 0), 0));
  return {
    rolls,
    meters,
    cost: r2(cost),
    perM: meters > 0 ? r2(cost / meters) : 0,
    maxDiscount: cost > 0 ? Math.floor((allowed / cost) * 1000) / 10 : 0,
    missing: [...missing],
  };
}

export type NeoRow = {
  id: string;
  kind: "heading" | "priced";
  customer_text: string;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  cut_lengths: number[] | null;
  component_id: string | null;
  recipes: { sku_id: string; qty: number; note: string }[];
};

export function buildNeon(
  c: NeonConfig,
  family: NeonFamily,
  perM: number,
  prices: Map<string, PartPrice>,
  newId: () => string,
) {
  const tag = (role: string) => `${NEO_TAG}${c.blockId} ${role}`;
  const rows: NeoRow[] = [];
  let list = 0;
  let allowed = 0;
  const missing = new Set<string>();
  const price = (id: string) => {
    const p = prices.get(id);
    if (!p) missing.add(id);
    return p?.unitPrice ?? 0;
  };
  const code = c.typeCode.trim();
  rows.push({
    id: newId(),
    kind: "heading",
    customer_text: `${code ? `${code} : ` : ""}${c.name.trim()} ${dimLabel(c.dim)}`.trim(),
    qty: null,
    unit: null,
    unit_price: null,
    cut_lengths: null,
    component_id: null,
    recipes: [],
  });
  for (const run of c.runs) {
    const L = runLength(run);
    if (!(L > 0)) continue;
    if (run.ckt.trim())
      rows.push({
        id: newId(),
        kind: "heading",
        customer_text: `CKT. NO. ${run.ckt.trim()}`,
        qty: null,
        unit: null,
        unit_price: null,
        cut_lengths: null,
        component_id: null,
        recipes: [],
      });
    const pieces = cutPieces(run.lengths, family.stepCm, family.maxPieceM).length;
    const recipes = [];
    if (c.endCapSkuId) recipes.push({ sku_id: c.endCapSkuId, qty: pieces, note: tag("ENDCAP") });
    if (c.mountSkuId && c.mountPerM > 0)
      recipes.push({ sku_id: c.mountSkuId, qty: r2(L * c.mountPerM), note: tag("MOUNT") });
    list += L * perM;
    rows.push({
      id: newId(),
      kind: "priced",
      // total here; the quotation prints the cut lengths underneath ("- 4.00m + 3.00m")
      customer_text: `- L = ${m(L)}`,
      qty: L,
      unit: "M.",
      unit_price: perM,
      // the existing roll plan (work order) reads these to cut the rolls
      cut_lengths: run.lengths.filter((x) => x > 0),
      component_id: family.componentId,
      recipes,
    });
    const psu = pickPsu(L * c.wattPerM, c.psuOptions, c.loadFactor);
    if (psu) {
      const each = price(psu.skuId);
      list += each * psu.count;
      allowed += (each * psu.count * (prices.get(psu.skuId)?.maxDiscount ?? 0)) / 100;
      rows.push({
        id: newId(),
        kind: "priced",
        customer_text: `- POWER SUPPLY 24V ${psu.watt}W ${dimLabel(c.dim)}`,
        qty: psu.count,
        unit: "EA.",
        unit_price: each,
        cut_lengths: null,
        component_id: null,
        recipes: [{ sku_id: psu.skuId, qty: psu.count, note: tag("PSU") }],
      });
    }
  }
  const config: NeonConfig = { ...c, rowIds: rows.map((r) => r.id) };
  // the config rides on the block's first material line so the block can be reopened
  const first = rows.flatMap((r) => r.recipes)[0];
  if (first) first.note = `${first.note} ${JSON.stringify(config)}`;
  return { rows, config, list: r2(list), psuAllowed: allowed, missing: [...missing], hasCarrier: !!first };
}

export function parseNeon(note: string | null | undefined): NeonConfig | null {
  if (!isNeoNote(note)) return null;
  const i = note!.indexOf("{");
  if (i < 0) return null;
  try {
    const c = JSON.parse(note!.slice(i)) as NeonConfig;
    return c && c.v === 1 ? c : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- SKUs → families */

export type RollSku = {
  id: string;
  code: string;
  name: string;
  notes?: string | null;
  is_roll?: boolean | null;
  roll_family?: string | null;
  roll_length_m?: number | null;
  cut_step_cm?: number | null;
  max_piece_m?: number | null;
};

/** Roll families of the Neon flex category (one family = one model + colour, 5 m / 10 m rolls). */
export function neonFamilies(
  skus: RollSku[],
  components: { id: string; roll_family: string | null; is_roll_product: boolean }[] = [],
): NeonFamily[] {
  const neon = inCategory(skus, "Neon flex").filter((s) => s.is_roll && s.roll_family?.trim());
  const map = new Map<string, NeonFamily>();
  for (const s of neon) {
    const fam = s.roll_family!.trim();
    const tags = readTags(s.notes);
    const model = jediFlexModel(tags["รุ่น"]);
    const f =
      map.get(fam) ??
      ({
        family: fam,
        rolls: [],
        stepCm: 0,
        maxPieceM: 0,
        wattPerM: null,
        model,
        componentId: components.find((c) => c.is_roll_product && c.roll_family === fam)?.id ?? null,
        sample: s.name,
      } as NeonFamily);
    f.rolls.push({ skuId: s.id, length: Number(s.roll_length_m) || 5, price: null });
    f.stepCm = Math.max(f.stepCm, Number(s.cut_step_cm) || (model ? model.cutMm / 10 : 0));
    f.maxPieceM = Math.max(f.maxPieceM, Number(s.max_piece_m) || Number(s.roll_length_m) || 5);
    f.wattPerM = f.wattPerM ?? (Number(tags["W/m"]) || model?.wattPerM || null);
    f.model = f.model ?? model;
    map.set(fam, f);
  }
  for (const f of map.values()) f.rolls.sort((a, b) => a.length - b.length);
  return [...map.values()].sort((a, b) => a.family.localeCompare(b.family));
}

/** Customer name for a family, e.g. "JEDI FLEX 0410 SIDE BEND 10W/M 24V IP67". */
export function defaultNeonName(f: NeonFamily): string {
  const w = f.wattPerM ? `${f.wattPerM}W/M ` : "";
  return `JEDI FLEX ${f.model?.title ?? f.family} ${w}24V IP67`.replace(/\s+/g, " ").trim();
}
