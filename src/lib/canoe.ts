// Canoe (ไฟ Canoe): a run is built from fixed pieces L / M / S / SS (nominally 50 / 40 / 30 / 20 cm).
// The exact piece length depends on the LED, so the strip inside is cut on its cut points
// (production workbook, tab "Canoe", FAIRMONT 68-013/1). Each piece adds 2 mm for the joint.
// Owner rules (04/11/2026): a run may end up to 5 cm longer or 10 cm shorter than measured; when
// several combinations fit, use the fewest pieces (then the closest); sold per metre of run;
// a Double Canoe has LED on both sides (2 × LED).

import type { PartPrice } from "@/lib/fo";
import { readTags } from "@/lib/skuCategory";

export const CANOE_SIZES = ["L", "M", "S", "SS"] as const;
export type CanoeSize = (typeof CANOE_SIZES)[number];

/** Nominal length per size (m) — the LED inside each piece. */
export const NOMINAL: Record<CanoeSize, number> = { L: 0.5, M: 0.4, S: 0.3, SS: 0.2 };
export const JOINT_M = 0.002;
export const OVER_M = 0.05;
export const SHORT_M = 0.1;

type Lengths = Partial<Record<CanoeSize, number>>;
const plus = (add: number): Lengths => ({ L: 0.5 + add, M: 0.4 + add, S: 0.3 + add, SS: 0.2 + add });

/** Single-Canoe piece lengths (m) per LED, from the workbook. Double = +5 mm each. */
const TABLE: { watt: number; dots: string; lengths: Lengths }[] = [
  { watt: 4.8, dots: "60", lengths: plus(0) },
  { watt: 4.8, dots: "144", lengths: plus(0) },
  { watt: 14.4, dots: "60", lengths: plus(0) },
  { watt: 19.2, dots: "60", lengths: plus(0) },
  { watt: 9.6, dots: "120", lengths: plus(0.005) },
  { watt: 8, dots: "COB", lengths: plus(0.015) },
  { watt: 9.6, dots: "210", lengths: plus(0.015) },
  { watt: 12, dots: "COB", lengths: plus(0.015) },
  { watt: 14.4, dots: "180", lengths: plus(0.015) },
  { watt: 15, dots: "COB", lengths: plus(0.015) },
  { watt: 19.2, dots: "240", lengths: plus(0.015) },
  // 16.67 cm cut step: no M piece
  { watt: 7.2, dots: "30", lengths: { L: 0.5, S: 0.34, SS: 0.24 } },
];

type SkuLite = { code: string; name: string; notes?: string | null };

/** Dots per metre ("60", "180", "COB") from the LED SKU's code or name. */
export function dotsOfLed(s: SkuLite): string | null {
  const t = `${s.code} ${s.name}`;
  if (/\bCOB\b/i.test(t)) return "COB";
  const named = t.match(/(\d{2,3})\s*dots/i)?.[1];
  if (named) return named;
  // codes like LED-Top-14.4-180-3000 → the part after the watt
  return t.match(/-\d+(?:\.\d+)?-(\d{2,3})-/)?.[1] ?? null;
}

export function wattOfLed(s: SkuLite): number | null {
  const saved = Number(readTags(s.notes)["W/m"]);
  if (saved > 0) return saved;
  const m = `${s.code} ${s.name}`.match(/(\d+(?:\.\d+)?)\s*W\s*\/?\s*m/i) ?? s.code.match(/-(\d+(?:\.\d+)?)-/);
  return m ? Number(m[1]) : null;
}

/** Piece lengths (m) for this LED, or null when the LED is not made as Canoe. */
export function canoeLengths(led: SkuLite, double: boolean): Lengths | null {
  const watt = wattOfLed(led);
  const dots = dotsOfLed(led);
  const row = TABLE.find((r) => r.watt === watt && r.dots === dots);
  if (!row) return null;
  if (!double) return row.lengths;
  const out: Lengths = {};
  for (const k of CANOE_SIZES) if (row.lengths[k]) out[k] = round(row.lengths[k]! + 0.005);
  return out;
}

export type PieceCounts = Record<CanoeSize, number>;
export type CanoeFit = {
  counts: PieceCounts;
  pieces: number;
  /** built length incl. 2 mm per joint (m) */
  totalM: number;
  /** measured − built: + = shorter than measured (เหลือ), − = longer (เกิน) */
  diffM: number;
  ok: boolean;
};

const zero = (): PieceCounts => ({ L: 0, M: 0, S: 0, SS: 0 });

/**
 * Pieces for one run: within +5 cm / −10 cm of the measured length, fewest pieces first, then the
 * closest, then the most L. When nothing fits (very short runs) the closest is returned with ok = false.
 */
export function fitRun(lengthM: number, lengths: Lengths): CanoeFit | null {
  if (!(lengthM > 0)) return null;
  const sizes = CANOE_SIZES.filter((k) => lengths[k]);
  const step = (k: CanoeSize) => lengths[k]! + JOINT_M;
  const maxL = Math.ceil((lengthM + OVER_M) / step("L")) + 1;
  let best: CanoeFit | null = null;
  let closest: CanoeFit | null = null;
  const better = (a: CanoeFit, b: CanoeFit | null) =>
    !b ||
    a.pieces < b.pieces ||
    (a.pieces === b.pieces && Math.abs(a.diffM) < Math.abs(b.diffM) - 1e-9) ||
    (a.pieces === b.pieces && Math.abs(Math.abs(a.diffM) - Math.abs(b.diffM)) <= 1e-9 && a.counts.L > b.counts.L);
  const small = sizes.filter((k) => k !== "L");
  const loops = (i: number, counts: PieceCounts) => {
    if (i === small.length) {
      const pieces = CANOE_SIZES.reduce((n, k) => n + counts[k], 0);
      if (!pieces) return;
      const totalM = round(sizes.reduce((sum, k) => sum + counts[k] * step(k), 0));
      const diffM = round(lengthM - totalM);
      const fit: CanoeFit = { counts: { ...counts }, pieces, totalM, diffM, ok: diffM <= SHORT_M + 1e-9 && -diffM <= OVER_M + 1e-9 };
      if (fit.ok && better(fit, best)) best = fit;
      if (!closest || Math.abs(diffM) < Math.abs(closest.diffM) - 1e-9) closest = fit;
      return;
    }
    // more than 4 of one small size never beats using L instead
    for (let n = 0; n <= 4; n++) loops(i + 1, { ...counts, [small[i]!]: n });
  };
  for (let l = 0; l <= maxL; l++) loops(0, { ...zero(), L: lengths.L ? l : 0 });
  return best ?? closest;
}

export type CanoeRun = { length: number; sets: number; label?: string };

export type CanoeConfig = {
  v: 1;
  blockId: string;
  code: string;
  title: string;
  ledSkuId: string;
  double: boolean;
  /** housing SKU per piece size (single or double housings, as chosen) */
  housing: Partial<Record<CanoeSize, string>>;
  runs: CanoeRun[];
  /** the lengths as typed ("2.49x2 + 4.18"), kept so the window reopens with the same text */
  spec?: string;
  rowIds: string[];
};

export type CanoeRow = {
  id: string;
  kind: "heading" | "priced";
  customer_text: string;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  cut_lengths: number[] | null;
  recipes: { sku_id: string; qty: number; note: string }[];
};

export const CNO_TAG = "CNO ";
export const isCanoeNote = (n: string | null | undefined) => !!n && n.startsWith(CNO_TAG);

/** All runs of a block: pieces per run, totals per size, LED metres. */
export function planCanoe(c: Pick<CanoeConfig, "double" | "runs">, led: SkuLite | undefined) {
  const lengths = led ? canoeLengths(led, c.double) : null;
  const runs = c.runs
    .filter((r) => r.length > 0 && r.sets > 0)
    .map((r) => ({ ...r, fit: lengths ? fitRun(r.length, lengths) : null }));
  const totals = zero();
  for (const r of runs) if (r.fit) for (const k of CANOE_SIZES) totals[k] += r.fit.counts[k] * r.sets;
  const ledM = round(CANOE_SIZES.reduce((m, k) => m + totals[k] * NOMINAL[k], 0) * (c.double ? 2 : 1));
  const runM = round(runs.reduce((m, r) => m + r.length * r.sets, 0));
  return { lengths, runs, totals, ledM, runM };
}

/** BOQ rows for a Canoe block: a heading and one line priced per metre of run. */
export function buildCanoe(
  c: CanoeConfig,
  led: SkuLite | undefined,
  prices: Map<string, PartPrice>,
  newId: () => string,
) {
  const tag = (role: string) => `${CNO_TAG}${c.blockId} ${role}`;
  const plan = planCanoe(c, led);
  const problems: string[] = [];
  const missing = new Set<string>();
  let list = 0;
  let allowed = 0;
  const add = (id: string, qty: number) => {
    const p = prices.get(id);
    if (!p) missing.add(id);
    const amount = (p?.unitPrice ?? 0) * qty;
    list += amount;
    allowed += (amount * (p?.maxDiscount ?? 0)) / 100;
  };
  if (!c.ledSkuId) problems.push("เลือกไฟ LED");
  else if (!plan.lengths) problems.push("ไฟรุ่นนี้ยังไม่มีขนาดท่อน Canoe");
  if (!plan.runs.length) problems.push("ใส่ความยาวอย่างน้อย 1 ช่วง");
  for (const r of plan.runs)
    if (r.fit && !r.fit.ok) problems.push(`ช่วง ${m(r.length)} ม. ต่อท่อนให้ได้ในระยะ +5 / −10 ซม. ไม่ได้`);
  const recipes: CanoeRow["recipes"] = [];
  if (c.ledSkuId && plan.ledM > 0) {
    recipes.push({ sku_id: c.ledSkuId, qty: plan.ledM, note: tag("LED") });
    add(c.ledSkuId, plan.ledM);
  }
  for (const k of CANOE_SIZES) {
    const n = plan.totals[k];
    if (!n) continue;
    const id = c.housing[k];
    if (!id) {
      problems.push(`เลือก SKU ตัวเรือน Canoe ขนาด ${k}`);
      continue;
    }
    recipes.push({ sku_id: id, qty: n, note: tag(`HOUSING ${k}`) });
    add(id, n);
  }
  const perM = plan.runM > 0 ? round2(list / plan.runM) : 0;
  const code = c.code.trim() ? `${c.code.trim()} : ` : "";
  const rows: CanoeRow[] = [
    {
      id: newId(),
      kind: "heading",
      customer_text: `${code}${c.title.trim() || "CANOE LIGHT"}`,
      qty: null,
      unit: null,
      unit_price: null,
      cut_lengths: null,
      recipes: [],
    },
    {
      id: newId(),
      kind: "priced",
      customer_text: `${c.double ? "DOUBLE CANOE" : "CANOE"}${led ? ` - ${led.name}` : ""}`,
      qty: plan.runM,
      unit: "M.",
      unit_price: perM,
      cut_lengths: plan.runs.flatMap((r) => Array.from({ length: r.sets }, () => r.length)),
      recipes,
    },
  ];
  const config: CanoeConfig = { ...c, rowIds: rows.map((r) => r.id) };
  const first = rows.flatMap((r) => r.recipes)[0];
  if (first) first.note = `${first.note} ${JSON.stringify(config)}`;
  return {
    rows,
    config,
    plan,
    list: round2(perM * plan.runM),
    maxDiscount: list > 0 ? Math.floor((allowed / list) * 1000) / 10 : 0,
    missing: [...missing],
    problems: [...new Set(problems)],
  };
}

export function parseCanoe(note: string | null | undefined): CanoeConfig | null {
  if (!isCanoeNote(note)) return null;
  const i = note!.indexOf("{");
  if (i < 0) return null;
  try {
    const c = JSON.parse(note!.slice(i)) as CanoeConfig;
    return c && c.v === 1 ? c : null;
  } catch {
    return null;
  }
}

const m = (n: number) => n.toFixed(2);
function round(n: number) {
  return Math.round(n * 1e6) / 1e6;
}
function round2(n: number) {
  return Math.round(n * 100) / 100;
}
