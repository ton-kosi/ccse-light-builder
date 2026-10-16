/**
 * Privacy film (PDLC smart film) builder.
 *
 * - Priced per square metre of the cutting size of each piece (one priced line per size + busbar).
 * - One piece is at most 1.5 m x 3 m (either way round).
 * - Every piece needs its busbar stated: single or double, on the width (W) or height (H) side.
 * - Transformers per location: watts (≈10 W/m²) ÷ (transformer watts x 80 %), rounded up;
 *   priced, existing or by buyer. Optional 220 V wiring line and installation line.
 */
import type { PartPrice } from "./fo";
import { inCategory, readTags } from "./skuCategory";

export type Busbar = "1W" | "2W" | "1H" | "2H";
export const BUSBARS: { value: Busbar; label: string; text: string }[] = [
  { value: "1W", label: "1 ด้าน · ด้านกว้าง (W)", text: "SINGLE BUSBAR ON WIDTH SIDE" },
  { value: "2W", label: "2 ด้าน · ด้านกว้าง (W)", text: "DOUBLE BUSBAR ON WIDTH SIDES" },
  { value: "1H", label: "1 ด้าน · ด้านสูง (H)", text: "SINGLE BUSBAR ON HEIGHT SIDE" },
  { value: "2H", label: "2 ด้าน · ด้านสูง (H)", text: "DOUBLE BUSBAR ON HEIGHT SIDES" },
];
/** Customer text of a busbar choice; "" when not (validly) chosen. */
export const busbarText = (b: string | null | undefined) =>
  BUSBARS.find((x) => x.value === b)?.text ?? "";

export type FilmPiece = {
  w: number;
  h: number;
  qty: number;
  busbar: Busbar | "";
};
export type FilmLocation = { name: string; pieces: FilmPiece[] };
export type Status = "priced" | "existing" | "by_buyer" | "none";

export type FilmConfig = {
  v: 1;
  blockId: string;
  code: string;
  title: string;
  filmSkuId: string;
  maxW: number;
  maxH: number;
  wattPerM2: number;
  showBusbar: boolean;
  locations: FilmLocation[];
  transformer: {
    mode: Status;
    skuId: string | null;
    watt: number;
    text: string;
    loadFactor: number;
  };
  wiring: Status;
  install: { mode: "priced" | "included" | "none"; price: number; text: string };
  rowIds: string[];
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const m = (x: number) => `${x.toFixed(2)}M`;

export const pieceOk = (p: FilmPiece) => p.w > 0 && p.h > 0 && p.qty > 0;

/** Why a piece can't be made in one sheet (max size either way round), or null. */
export function sizeProblem(p: FilmPiece, maxW: number, maxH: number): string | null {
  const fits = (a: number, b: number) => a <= maxW + 1e-9 && b <= maxH + 1e-9;
  if (fits(p.w, p.h) || fits(p.h, p.w)) return null;
  return `${m(p.w)} x ${m(p.h)} ใหญ่เกินแผ่น ${maxW} x ${maxH} ม. — แบ่งเป็นหลายแผ่น`;
}

/** Transformers for one location. */
export function transformersFor(
  loc: FilmLocation,
  c: Pick<FilmConfig, "wattPerM2" | "transformer">,
): number {
  const area = loc.pieces.filter(pieceOk).reduce((s, p) => s + p.w * p.h * p.qty, 0);
  const cap = c.transformer.watt * c.transformer.loadFactor;
  if (!(area > 0)) return 0;
  if (!(cap > 0)) return 1;
  return Math.max(1, Math.ceil((area * c.wattPerM2) / cap - 1e-9));
}

export type FilmRow = {
  id: string;
  kind: "heading" | "priced" | "display" | "existing" | "by_buyer";
  customer_text: string;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  recipes: { sku_id: string; qty: number; note: string }[];
};

export const PVF_TAG = "PVF ";
export const isPvfNote = (n: string | null | undefined) => !!n && n.startsWith(PVF_TAG);

export function buildFilm(c: FilmConfig, prices: Map<string, PartPrice>, newId: () => string) {
  const tag = (role: string) => `${PVF_TAG}${c.blockId} ${role}`;
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
  const row = (p: Omit<FilmRow, "id" | "recipes"> & { recipes?: FilmRow["recipes"] }): FilmRow => ({
    id: newId(),
    recipes: [],
    ...p,
  });
  const rows: FilmRow[] = [];
  const perM2 = price(c.filmSkuId);
  const code = c.code.trim() ? `${c.code.trim()} : ` : "";
  let transformers = 0;

  c.locations.forEach((loc, li) => {
    const pieces = loc.pieces.filter(pieceOk);
    if (!pieces.length) return;
    for (const p of pieces) {
      const bad = sizeProblem(p, c.maxW, c.maxH);
      if (bad) problems.push(bad);
      if (!busbarText(p.busbar)) problems.push(`ระบุ busbar ของแผ่น ${m(p.w)} x ${m(p.h)}`);
    }
    rows.push(
      row({
        kind: "heading",
        customer_text: `${li === 0 ? code : ""}${loc.name.trim() || c.title.trim() || "PRIVACY FILM"}`,
        qty: null,
        unit: null,
        unit_price: null,
      }),
    );
    // one priced line per cutting size (+ busbar when shown)
    const groups = new Map<string, { w: number; h: number; bus: string; qty: number }>();
    for (const p of pieces) {
      const bus = c.showBusbar ? busbarText(p.busbar) : "";
      const k = `${p.w}x${p.h}|${bus}`;
      const g = groups.get(k) ?? { w: p.w, h: p.h, bus, qty: 0 };
      g.qty += p.qty;
      groups.set(k, g);
    }
    for (const g of groups.values()) {
      const each = r2(g.w * g.h * perM2);
      add(each * g.qty, c.filmSkuId);
      rows.push(
        row({
          kind: "priced",
          customer_text: `- CUTTING SIZE W: ${m(g.w)} x H: ${m(g.h)}${g.bus ? ` (${g.bus})` : ""}`,
          qty: g.qty,
          unit: "PCS.",
          unit_price: each,
          recipes: [{ sku_id: c.filmSkuId, qty: r2(g.w * g.h * g.qty), note: tag("FILM") }],
        }),
      );
    }
    transformers += transformersFor({ ...loc, pieces }, c);
  });

  const T = c.transformer;
  if (T.mode !== "none" && transformers > 0) {
    if (T.mode === "priced") {
      if (!T.skuId) problems.push("เลือกหม้อแปลง");
      const each = price(T.skuId);
      add(each * transformers, T.skuId);
      rows.push(
        row({
          kind: "priced",
          customer_text: T.text.trim() || "TRANSFORMER",
          qty: transformers,
          unit: "EA.",
          unit_price: each,
          recipes: T.skuId
            ? [{ sku_id: T.skuId, qty: transformers, note: tag("TRANSFORMER") }]
            : [],
        }),
      );
    } else
      rows.push(
        row({
          kind: T.mode,
          customer_text: T.text.trim() || "TRANSFORMER",
          qty: transformers,
          unit: "EA.",
          unit_price: null,
        }),
      );
  }
  if (c.wiring === "existing" || c.wiring === "by_buyer")
    rows.push(
      row({
        kind: c.wiring,
        customer_text: "220V WIRING & ON/OFF SWITCH",
        qty: 1,
        unit: "LOT",
        unit_price: null,
      }),
    );
  if (c.install.mode === "priced") {
    if (!(c.install.price > 0)) problems.push("ใส่ค่าติดตั้ง (หรือเลือก รวมแล้ว / ไม่ใส่)");
    list += c.install.price;
    rows.push(
      row({
        kind: "priced",
        customer_text: c.install.text.trim() || "INSTALLATION FEE",
        qty: 1,
        unit: "LOT",
        unit_price: c.install.price,
      }),
    );
  } else if (c.install.mode === "included")
    rows.push(
      row({
        kind: "display",
        customer_text: `${c.install.text.trim() || "INSTALLATION FEE"} (INCLUDED)`,
        qty: null,
        unit: null,
        unit_price: null,
      }),
    );

  const config: FilmConfig = { ...c, rowIds: rows.map((r) => r.id) };
  const first = rows.flatMap((r) => r.recipes)[0];
  if (first) first.note = `${first.note} ${JSON.stringify(config)}`;
  return {
    rows,
    config,
    list: r2(list),
    maxDiscount: list > 0 ? Math.floor((allowed / list) * 1000) / 10 : 0,
    transformers,
    missing: [...missing],
    problems: [...new Set(problems)],
  };
}

export function parseFilm(note: string | null | undefined): FilmConfig | null {
  if (!isPvfNote(note)) return null;
  const i = note!.indexOf("{");
  if (i < 0) return null;
  try {
    const c = JSON.parse(note!.slice(i)) as FilmConfig;
    return c && c.v === 1 ? c : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- SKUs */

type SkuLite = { id: string; code: string; name: string; notes?: string | null };

/** Transformer watts: the SKU's "วัตต์" field, else "100W" in the name. */
export function transformerWatt(s: SkuLite | undefined): number | null {
  if (!s) return null;
  const saved = Number(readTags(s.notes)["วัตต์"]);
  if (saved > 0) return saved;
  const mm = `${s.code} ${s.name}`.match(/(\d+(?:\.\d+)?)\s*W\b/i);
  return mm ? Number(mm[1]) : null;
}

export function filmSkuGroups<T extends SkuLite>(skus: T[]) {
  return {
    films: inCategory(skus, "Smart film"),
    transformers: inCategory(skus, "Film transformer"),
  };
}
