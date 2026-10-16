/**
 * Clipso stretch-ceiling builder.
 *
 * Fabric
 *  - rolls come in widths 3.4 m / 5.1 m, 50 m long
 *  - each piece is cut 10 cm larger than the opening on every side (editable per opening for the
 *    odd case where it has to be shorter)
 *  - pieces are laid out across the roll width in "strips"; several pieces share a strip when
 *    their widths fit side by side; the customer pays for roll width × length cut, so the
 *    selvage left over on the side is included
 *  - the width (3.4 / 5.1) that costs least is used unless one is forced
 * Track (CC / CW): 2 m lengths, per opening ceil(perimeter / 2) — offcuts are paid for.
 * Lighting above (optional): LED rows spaced at 1.5 × cavity depth (20 cm → 30 cm),
 *   PSU per opening at 80 % load for the chosen dimming.
 */
import type { PartPrice } from "./fo";
import { pickPsu, dimLabel, type DimType, type PsuOption } from "./linear";
import { inCategory, readTags } from "./skuCategory";

export type Shape = "rect" | "circle";
export type Panel = {
  shape: Shape;
  /** opening size (m); circle: w = diameter */
  w: number;
  l: number;
  qty: number;
  /** cut allowance per side (cm); null = default 10 */
  allowW?: number | null;
  allowL?: number | null;
};
export type FabricOption = { skuId: string; width: number; rollLength: number };
export type TrackType = "CC" | "CW";

export type ClipsoConfig = {
  v: 1;
  blockId: string;
  code: string;
  /** fabric name the customer sees, e.g. 308T */
  fabricName: string;
  /** all widths stocked for this fabric */
  fabrics: FabricOption[];
  /** force one width (skuId) instead of the cheapest */
  forceFabricSkuId: string | null;
  track: TrackType;
  trackSkuId: string | null;
  trackLength: number;
  panels: Panel[];
  /** true: one SET line, pieces laid out together; false: one line per opening size */
  combined: boolean;
  /** cut length rounded up per strip (m), e.g. 0.1 */
  lengthStep: number;
  light: null | {
    /** strip: rows along the long side · module: grid of modules in both directions (x and y) */
    kind?: "strip" | "module";
    depthCm: number;
    spacingCm: number;
    ledSkuId: string;
    /** strip: W per metre · module: W per module */
    wattPerM: number;
    cct: string;
    dim: DimType;
    psuOptions: PsuOption[];
    loadFactor: number;
    miscSkuId: string | null;
  };
  rowIds: string[];
};

export const DEFAULT_ALLOW_CM = 10;
export const spacingFor = (depthCm: number) => Math.round(depthCm * 1.5);

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const m = (x: number) => `${x.toFixed(2)}M`;
const ceilTo = (x: number, step: number) => (step > 0 ? Math.ceil(x / step - 1e-9) * step : x);

/** Cut size (m): opening + allowance on both sides. */
export function cutSize(p: Panel): [number, number] {
  const aw = (p.allowW ?? DEFAULT_ALLOW_CM) / 100;
  const al = (p.allowL ?? DEFAULT_ALLOW_CM) / 100;
  if (p.shape === "circle") return [r3(p.w + 2 * aw), r3(p.w + 2 * aw)];
  return [r3(p.w + 2 * aw), r3(p.l + 2 * al)];
}

export const perimeter = (p: Panel) => (p.shape === "circle" ? Math.PI * p.w : 2 * (p.w + p.l));

/** Track lengths for one piece of this opening. */
export const trackPieces = (p: Panel, len = 2) => Math.ceil(perimeter(p) / len - 1e-9);

type Item = { a: number; b: number; panel: number };
export type Strip = { length: number; used: number; items: { across: number; along: number; panel: number }[] };
export type Layout = {
  width: number;
  strips: Strip[];
  /** total length cut (m, after rounding each strip) */
  length: number;
  /** widest use of the roll width (m) — the "calculation size" width */
  usedWidth: number;
  /** charged area (roll width × length), m² */
  area: number;
  rolls: number;
  problems: string[];
};

/**
 * Lays pieces out on a roll of the given width: largest first; a piece joins an existing strip
 * when it fits beside the others without making the strip longer, otherwise it opens a new strip
 * turned so it uses as little length as possible.
 */
export function layout(panels: Panel[], width: number, rollLength = 50, step = 0.1): Layout {
  // two ways to turn a piece when it starts a new strip; keep whichever cuts less length
  const a = packOnce(panels, width, rollLength, step, "short");
  const b = packOnce(panels, width, rollLength, step, "narrow");
  return b.length < a.length - 1e-9 ? b : a;
}

function packOnce(
  panels: Panel[],
  width: number,
  rollLength: number,
  step: number,
  turn: "short" | "narrow",
): Layout {
  const items: Item[] = [];
  const problems: string[] = [];
  panels.forEach((p, i) => {
    const [a, b] = cutSize(p);
    if (Math.min(a, b) > width + 1e-9)
      problems.push(`ช่อง ${i + 1} ตัด ${m(a)} x ${m(b)} กว้างเกินหน้าผ้า ${width}M`);
    else for (let k = 0; k < p.qty; k++) items.push({ a, b, panel: i });
  });
  items.sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b) || Math.min(y.a, y.b) - Math.min(x.a, x.b));
  const strips: Strip[] = [];
  for (const it of items) {
    const turns = [
      { across: it.a, along: it.b },
      { across: it.b, along: it.a },
    ].filter((t) => t.across <= width + 1e-9);
    // join the strip where the piece wastes the least fabric beside it (then the tightest fit)
    let best: { s: Strip; t: (typeof turns)[number]; waste: number; left: number } | null = null;
    for (const s of strips)
      for (const t of turns)
        if (t.along <= s.length + 1e-9 && s.used + t.across <= width + 1e-9) {
          const waste = (s.length - t.along) * t.across;
          const left = width - s.used - t.across;
          if (!best || waste < best.waste - 1e-9 || (Math.abs(waste - best.waste) < 1e-9 && left < best.left))
            best = { s, t, waste, left };
        }
    if (best) {
      best.s.items.push({ ...best.t, panel: it.panel });
      best.s.used = r3(best.s.used + best.t.across);
    } else {
      const t = [...turns].sort((x, y) => (turn === "short" ? x.along - y.along : x.across - y.across))[0]!;
      strips.push({ length: t.along, used: t.across, items: [{ ...t, panel: it.panel }] });
    }
  }
  for (const s of strips) {
    s.length = r3(ceilTo(s.length, step));
    if (s.length > rollLength + 1e-9) problems.push(`ชิ้นยาว ${m(s.length)} เกินความยาวม้วน ${rollLength}M`);
  }
  // rolls needed: strips can't be split between rolls (first fit, longest first)
  const rolls: number[] = [];
  for (const len of strips.map((s) => s.length).sort((x, y) => y - x)) {
    const i = rolls.findIndex((left) => left >= len - 1e-9);
    if (i >= 0) rolls[i] = r3(rolls[i]! - len);
    else rolls.push(r3(rollLength - len));
  }
  const length = r3(strips.reduce((s, x) => s + x.length, 0));
  return {
    width,
    strips,
    length,
    usedWidth: r3(Math.max(0, ...strips.map((s) => s.used))),
    area: r2(width * length),
    rolls: rolls.length,
    problems,
  };
}

/** Cheapest width (by fabric price) that can take every piece, or the forced one. */
export function bestLayout(
  panels: Panel[],
  fabrics: FabricOption[],
  prices: Map<string, PartPrice>,
  step: number,
  forceSkuId: string | null = null,
) {
  const tries = fabrics
    .filter((f) => !forceSkuId || f.skuId === forceSkuId)
    .map((f) => {
      const lay = layout(panels, f.width, f.rollLength, step);
      return { fabric: f, lay, cost: lay.area * (prices.get(f.skuId)?.unitPrice ?? 0) };
    });
  const ok = tries.filter((t) => !t.lay.problems.length && t.lay.strips.length);
  const pick = (ok.length ? ok : tries).sort((x, y) => x.cost - y.cost || x.lay.area - y.lay.area)[0];
  return { pick: pick ?? null, tries };
}

/* ---------------------------------------------------------------- lighting */

/** LED rows across the opening at the given spacing; total LED metres for one piece. */
export function ledMeters(p: Panel, spacingCm: number): { rows: number; meters: number } {
  const s = spacingCm / 100;
  if (!(s > 0)) return { rows: 0, meters: 0 };
  if (p.shape === "circle") {
    const r = p.w / 2;
    const rows = Math.max(1, Math.ceil(p.w / s - 1e-9));
    const gap = p.w / rows;
    let meters = 0;
    for (let i = 0; i < rows; i++) {
      const y = -r + gap * (i + 0.5);
      meters += 2 * Math.sqrt(Math.max(0, r * r - y * y));
    }
    return { rows, meters: r2(meters) };
  }
  const short = Math.min(p.w, p.l);
  const long = Math.max(p.w, p.l);
  const rows = Math.max(1, Math.ceil(short / s - 1e-9));
  return { rows, meters: r2(rows * long) };
}

/** LED modules in a grid at the given spacing both ways (x and y); circle: cells inside the circle. */
export function ledModules(p: Panel, spacingCm: number): { cols: number; rows: number; count: number } {
  const s = spacingCm / 100;
  if (!(s > 0)) return { cols: 0, rows: 0, count: 0 };
  if (p.shape === "circle") {
    const n = Math.max(1, Math.ceil(p.w / s - 1e-9));
    const gap = p.w / n;
    const r = p.w / 2;
    let count = 0;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const x = -r + gap * (i + 0.5);
        const y = -r + gap * (j + 0.5);
        if (x * x + y * y <= r * r + 1e-9) count++;
      }
    return { cols: n, rows: n, count: Math.max(1, count) };
  }
  const cols = Math.max(1, Math.ceil(p.w / s - 1e-9));
  const rows = Math.max(1, Math.ceil(p.l / s - 1e-9));
  return { cols, rows, count: cols * rows };
}

/** Amount of LED for one piece: metres (strip) or modules (module), and its watts. */
export function lightFor(p: Panel, L: NonNullable<ClipsoConfig["light"]>) {
  if (L.kind === "module") {
    const g = ledModules(p, L.spacingCm);
    return { qty: g.count, watts: g.count * L.wattPerM, text: `${g.cols} × ${g.rows} = ${g.count} ชิ้น` };
  }
  const one = ledMeters(p, L.spacingCm);
  return { qty: one.meters, watts: one.meters * L.wattPerM, text: `${one.rows} แถว · ${one.meters} ม.` };
}

/* ---------------------------------------------------------------- BOQ rows */

export type ClpRecipe = { sku_id: string; qty: number; note: string };
export type ClpRow = {
  id: string;
  kind: "heading" | "priced";
  customer_text: string;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  recipes: ClpRecipe[];
};

export const CLP_TAG = "CLP ";

/**
 * "Calculation size" for the quotation: a single piece is shown the same way round as its opening
 * (width x length, with the rounded cut length); several pieces show roll width used x total length.
 */
function calcSize(lay: Layout, group: Panel[]): string {
  const only = lay.strips.length === 1 && lay.strips[0]!.items.length === 1 ? lay.strips[0]!.items[0]! : null;
  if (only) {
    const [a] = cutSize(group[only.panel]!);
    const turned = Math.abs(only.across - a) > 1e-9; // laid with its length across the roll
    const len = lay.strips[0]!.length;
    return turned ? `${m(len)} x ${m(only.across)}` : `${m(only.across)} x ${m(len)}`;
  }
  return `${m(lay.usedWidth)} x ${m(lay.length)}`;
}
const sizeText = (p: Panel) =>
  p.shape === "circle" ? `DIA : ${m(p.w)}` : `${m(p.w)} x ${m(p.l)}`;

export function buildClipso(c: ClipsoConfig, prices: Map<string, PartPrice>, newId: () => string) {
  const missing = new Set<string>();
  const problems: string[] = [];
  let list = 0;
  let allowed = 0;
  const price = (id: string | null) => {
    if (!id) return 0;
    const p = prices.get(id);
    if (!p) missing.add(id);
    return p?.unitPrice ?? 0;
  };
  const add = (amount: number, id: string | null) => {
    list += amount;
    allowed += (amount * (id ? (prices.get(id)?.maxDiscount ?? 0) : 0)) / 100;
  };
  const tag = (role: string) => `${CLP_TAG}${c.blockId} ${role}`;
  const panels = c.panels.filter((p) => p.w > 0 && (p.shape === "circle" || p.l > 0) && p.qty > 0);
  const title = `CLIPSO FABRIC${c.fabricName.trim() ? ` "${c.fabricName.trim()}"` : ""}`;
  const code = c.code.trim() ? `${c.code.trim()} : ` : "";
  const rows: ClpRow[] = [];
  const profileLine = `- CEILING PROFILE "${c.track}"`;
  const pieces = (p: Panel) => trackPieces(p, c.trackLength || 2);

  /** fabric + track for one set made of `group`; the BOQ line has `mult` sets */
  const fabricPart = (group: Panel[], mult: number) => {
    const { pick } = bestLayout(group, c.fabrics, prices, c.lengthStep, c.forceFabricSkuId);
    if (!pick) {
      problems.push("ยังไม่มีผ้าในหมวด Clipso fabric");
      return null;
    }
    problems.push(...pick.lay.problems);
    const trackQty = group.reduce((s, p) => s + pieces(p) * p.qty, 0);
    const fab = pick.lay.area * price(pick.fabric.skuId);
    const trk = trackQty * price(c.trackSkuId);
    add(fab * mult, pick.fabric.skuId);
    add(trk * mult, c.trackSkuId);
    const recipes: ClpRecipe[] = [
      { sku_id: pick.fabric.skuId, qty: r3(pick.lay.area * mult), note: tag("FABRIC") },
    ];
    if (c.trackSkuId) recipes.push({ sku_id: c.trackSkuId, qty: trackQty * mult, note: tag("TRACK") });
    return { pick, amount: fab + trk, recipes };
  };

  // heading: when the block has several lines (separate sizes, or fabric + lighting)
  if (!c.combined || c.light) {
    rows.push({
      id: newId(),
      kind: "heading",
      customer_text: `${code}${title}${c.light ? " w/ LUMINOUS CEILING" : ""}`,
      qty: null,
      unit: null,
      unit_price: null,
      recipes: [],
    });
  }

  if (c.combined) {
    const f = panels.length ? fabricPart(panels, 1) : null;
    if (f) {
      const lines = [
        c.light ? "CLIPSO FABRIC" : `${code}${title}`,
        ...panels.map(
          (p) =>
            `- OPENING SIZE : ${sizeText(p)}${p.qty > 1 ? ` x ${p.qty}PCS.` : ""}`,
        ),
        `- CALCULATION SIZE : ${calcSize(f.pick.lay, panels)}`,
        profileLine,
      ];
      rows.push({
        id: newId(),
        kind: "priced",
        customer_text: lines.join("\n"),
        qty: 1,
        unit: "SET",
        unit_price: r2(f.amount),
        recipes: f.recipes,
      });
    }
  } else {
    for (const p of panels) {
      const f = fabricPart([{ ...p, qty: 1 }], p.qty);
      if (!f) continue;
      const lay = f.pick.lay;
      rows.push({
        id: newId(),
        kind: "priced",
        customer_text: [
          `SIZE : ${sizeText(p)}`,
          `- CALCULATION SIZE ${calcSize(lay, [p])}`,
          profileLine,
        ].join("\n"),
        qty: p.qty,
        unit: "SET",
        unit_price: r2(f.amount),
        recipes: f.recipes,
      });
    }
  }

  if (c.light && panels.length) {
    const L = c.light;
    let ledM = 0;
    const psuCount = new Map<string, { watt: number; count: number }>();
    for (const p of panels) {
      const one = lightFor(p, L);
      ledM += one.qty * p.qty;
      const psu = pickPsu(one.watts, L.psuOptions, L.loadFactor);
      if (psu) {
        const cur = psuCount.get(psu.skuId) ?? { watt: psu.watt, count: 0 };
        cur.count += psu.count * p.qty;
        psuCount.set(psu.skuId, cur);
      } else if (one.watts > 0) problems.push(`ไม่มีหม้อแปลง ${L.dim} ในหมวด Power supply`);
    }
    ledM = r2(ledM);
    let amount = ledM * price(L.ledSkuId);
    add(ledM * price(L.ledSkuId), L.ledSkuId);
    const recipes: ClpRecipe[] = [{ sku_id: L.ledSkuId, qty: ledM, note: tag("LED") }];
    let totalPsu = 0;
    for (const [skuId, v] of psuCount) {
      amount += v.count * price(skuId);
      add(v.count * price(skuId), skuId);
      recipes.push({ sku_id: skuId, qty: v.count, note: tag("PSU") });
      totalPsu += v.count;
    }
    if (L.miscSkuId) {
      amount += price(L.miscSkuId);
      add(price(L.miscSkuId), L.miscSkuId);
      recipes.push({ sku_id: L.miscSkuId, qty: 1, note: tag("MISC") });
    }
    rows.push({
      id: newId(),
      kind: "priced",
      customer_text: [
        `LED ABOVE THE FABRIC (ceiling to clipso ${L.depthCm}cm.)`,
        `- ${L.kind === "module" ? "LED MODULE" : "LED STRIP"} (${L.cct.trim() || "TBD"})`,
        `- POWER SUPPLY ${dimLabel(L.dim)} x ${totalPsu}`,
        ...(L.miscSkuId ? ["- MISCELLANEOUS x 1"] : []),
      ].join("\n"),
      qty: 1,
      unit: "SET",
      unit_price: r2(amount),
      recipes,
    });
  }

  // remember the config on the first fabric material so the block can be reopened
  const config: ClipsoConfig = { ...c, rowIds: rows.map((r) => r.id) };
  const first = rows.flatMap((r) => r.recipes).find((x) => x.note === tag("FABRIC"));
  if (first) first.note = `${tag("FABRIC")} ${JSON.stringify(config)}`;
  const total = r2(rows.reduce((s, r) => s + (r.qty ?? 0) * (r.unit_price ?? 0), 0));
  return {
    rows,
    config,
    list: total,
    maxDiscount: list > 0 ? Math.floor((allowed / list) * 1000) / 10 : 0,
    missing: [...missing],
    problems: [...new Set(problems)],
  };
}

export const isClpNote = (n: string | null | undefined) => !!n && n.startsWith(CLP_TAG);

export function parseClipso(note: string | null | undefined): ClipsoConfig | null {
  if (!isClpNote(note)) return null;
  const i = note!.indexOf("{");
  if (i < 0) return null;
  try {
    const c = JSON.parse(note!.slice(i)) as ClipsoConfig;
    return c && c.v === 1 ? c : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- SKUs */

type SkuLite = { id: string; code: string; name: string; notes?: string | null };
const txt = (s: SkuLite) => `${s.code} ${s.name}`;

/** Fabric width of a SKU: its "หน้าผ้า" field, else "3.4m" / "5.1m" in the name. */
export function fabricWidthOf(s: SkuLite): number | null {
  const saved = Number(readTags(s.notes)["หน้าผ้า"]);
  if (saved > 0) return saved;
  const mm = txt(s).match(/\b([35])[.,]([14])0?\s*m\b/i);
  return mm ? Number(`${mm[1]}.${mm[2]}`) : null;
}

/** Fabric type shown to the customer (e.g. 308T): the "รุ่นผ้า" field, else the name minus the width. */
export function fabricTypeOf(s: SkuLite): string {
  const saved = readTags(s.notes)["รุ่นผ้า"]?.trim();
  if (saved) return saved;
  return s.name
    .replace(/\b[35][.,][14]0?\s*m\b/i, "")
    .replace(/clipso|fabric|ผ้า/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function trackTypeOf(s: SkuLite): TrackType | null {
  const saved = readTags(s.notes)["ราง"];
  if (saved === "CC" || saved === "CW") return saved;
  const mm = txt(s).match(/\b(C[CW])\b/i);
  return mm ? (mm[1]!.toUpperCase() as TrackType) : null;
}

export function clipsoSkuGroups<T extends SkuLite>(skus: T[]) {
  const fabrics = inCategory(skus, "Clipso fabric");
  const tracks = inCategory(skus, "Clipso track");
  const types = new Map<string, FabricOption[]>();
  for (const s of fabrics) {
    const w = fabricWidthOf(s);
    if (!w) continue;
    const key = fabricTypeOf(s) || s.code;
    const roll = Number(readTags(s.notes)["ยาวม้วน"]) || 50;
    types.set(key, [...(types.get(key) ?? []), { skuId: s.id, width: w, rollLength: roll }]);
  }
  for (const list of types.values()) list.sort((a, b) => a.width - b.width);
  return {
    fabrics,
    tracks,
    /** fabric type → its widths */
    types,
    /** fabric SKUs with no width set (can't be laid out until the width is set on the SKU page) */
    noWidth: fabrics.filter((s) => !fabricWidthOf(s)),
    trackFor: (t: TrackType) => tracks.filter((s) => trackTypeOf(s) === t),
    trackLength: (s: SkuLite | undefined) => (s ? Number(readTags(s.notes)["ยาวเส้น"]) || 2 : 2),
  };
}

/** Watts per LED module: the SKU's "W/ชิ้น" field, else "1.2W" in the name. */
export function wattPerModuleOf(s: SkuLite | undefined): number | null {
  if (!s) return null;
  const saved = Number(readTags(s.notes)["W/ชิ้น"]);
  if (saved > 0) return saved;
  const mm = txt(s).match(/(\d+(?:\.\d+)?)\s*W\b(?!\s*\/)/i);
  return mm ? Number(mm[1]) : null;
}
