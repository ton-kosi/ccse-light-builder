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
  /** pieces set by hand: someone decided, so it is not held to the +5 / −10 cm limit */
  manual?: boolean;
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

/** A run with its pieces chosen by a person (e.g. 59 × 50 cm where automatic says 58 + 1 M). */
export function manualFit(lengthM: number, lengths: Lengths, counts: PieceCounts): CanoeFit {
  const used = zero();
  for (const k of CANOE_SIZES) if (lengths[k]) used[k] = Math.max(0, Math.round(counts[k] ?? 0));
  const pieces = CANOE_SIZES.reduce((n, k) => n + used[k], 0);
  const totalM = round(CANOE_SIZES.reduce((s, k) => s + used[k] * ((lengths[k] ?? 0) + JOINT_M), 0));
  return { counts: used, pieces, totalM, diffM: round(lengthM - totalM), ok: pieces > 0, manual: true };
}

export type CanoeRun = { length: number; sets: number; label?: string };

/*
 * Retrofit — new LED inside a housing already on site (SALA BANG PAIN QC25-54-304). Sealed pieces of
 * 50 cm, optionally 40 / 30 cm, with the usual 2 mm per joint because they can elongate. Each piece needs
 * one set of engraved acrylic + diffuser + IP68 cable. Housing and power supply stay as they are.
 * Rail: 4/8 for every Canoe (owner, 06/11/2026).
 */
export const RETRO_SIZES: CanoeSize[] = ["L", "M", "S"];

export type RetroOptions = {
  /** printed before the length, e.g. SWX-1 (STRAIGHT) */
  runName: string;
  jacket: "SINGLE" | "DOUBLE";
  diffuser: (typeof DIFFUSERS)[number];
  heatsinkSkuId: string;
  jacketSkuId: string;
  /** one per piece: engraved acrylic, diffuser, IP68 cable */
  kitSkuId: string;
  housingText: string;
  existingPsu: boolean;
};

export const defaultRetro = (): RetroOptions => ({
  runName: "",
  jacket: "DOUBLE",
  diffuser: "Jedi",
  heatsinkSkuId: "",
  jacketSkuId: "",
  kitSkuId: "",
  housingText: "EXISTING SS 316L HOUSING (t = 1 mm)",
  existingPsu: true,
});

/*
 * Stainless (SS) Canoe — spec sheets WSS.3150 / WSS.3155UB / WSS.3550SB (23 Dec 2025).
 * The housing is continuous: cut from 2.4 m SS bars and welded on site; an acrylic cover on top,
 * also 2.4 m pieces joined end to end. The LED inside is still cut in Canoe pieces (above).
 * Owner (04/11/2026): a custom cross-section is priced per metre + a surcharge; grade and diffuser
 * are chosen in the builder.
 */
export const SS_BAR_M = 2.4;
export const COVER_M = 2.4;
export const SS_MODELS = [
  { key: "3150", label: "WSS.3150", w: 31, h: 50 },
  { key: "3155UB", label: "WSS.3155UB", w: 31, h: 55 },
  { key: "3550SB", label: "WSS.3550SB", w: 35, h: 50 },
] as const;
export const SS_GRADES = ["SS304", "SS316", "SS316L"] as const;
export const DIFFUSERS = ["Jedi", "Opal", "Satin", "Prismatic"] as const;

export type SsOptions = {
  /** a model key from SS_MODELS, or "custom" */
  model: string;
  customW: number;
  customH: number;
  grade: (typeof SS_GRADES)[number];
  diffuser: (typeof DIFFUSERS)[number];
  housingSkuId: string;
  coverSkuId: string;
  /** custom cross-section only: one-off amount (THB) added to the set */
  surcharge: number;
};

export const defaultSs = (): SsOptions => ({
  model: "3150",
  customW: 0,
  customH: 0,
  grade: "SS304",
  diffuser: "Opal",
  housingSkuId: "",
  coverSkuId: "",
  surcharge: 0,
});

/** Whole 2.4 m bars (or covers) for one straight run — welded / joined, so offcuts stay offcuts. */
export const barsFor = (lengthM: number, barM = SS_BAR_M) => Math.max(1, Math.ceil(lengthM / barM - 1e-9));

/** "WSS.3150 (31 x 50 MM.)" or "CUSTOM 40 x 60 MM." */
export function ssSectionText(ss: SsOptions): string {
  const m = SS_MODELS.find((x) => x.key === ss.model);
  return m ? `${m.label} (${m.w} x ${m.h} MM.)` : `CUSTOM SECTION ${ss.customW} x ${ss.customH} MM.`;
}

export type CanoeConfig = {
  v: 1;
  blockId: string;
  /** item number printed on the heading */
  itemNo?: string | null;
  code: string;
  title: string;
  ledSkuId: string;
  double: boolean;
  /** housing SKU per piece size (single or double housings, as chosen) — aluminium housing */
  housing: Partial<Record<CanoeSize, string>>;
  /** "ss" = continuous stainless housing + acrylic cover; "retrofit" = housing already on site (older sets: aluminium) */
  housingType?: "alu" | "ss" | "retrofit";
  ss?: SsOptions;
  retro?: RetroOptions;
  runs: CanoeRun[];
  /** the lengths as typed ("2.49x2 + 4.18"), kept so the window reopens with the same text */
  spec?: string;
  /** pieces set by hand, by run length ("29.5"); a different measured length goes back to automatic */
  manualFits?: Record<string, PieceCounts>;
  rowIds: string[];
};

export type CanoeRow = {
  item_no?: string | null;
  id: string;
  kind: "heading" | "priced" | "existing" | "display";
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
export function planCanoe(
  c: Pick<CanoeConfig, "double" | "runs" | "housingType" | "manualFits">,
  led: SkuLite | undefined,
) {
  const retrofit = c.housingType === "retrofit";
  const all = led ? canoeLengths(led, c.double) : null;
  const lengths =
    all && retrofit ? (Object.fromEntries(RETRO_SIZES.filter((k) => all[k]).map((k) => [k, all[k]])) as Lengths) : all;
  const runs = c.runs
    .filter((r) => r.length > 0 && r.sets > 0)
    .map((r) => {
      const hand = c.manualFits?.[String(r.length)];
      const fit = !lengths ? null : hand ? manualFit(r.length, lengths, hand) : fitRun(r.length, lengths);
      return { ...r, fit, bars: barsFor(r.length) };
    });
  // stainless housing: 2.4 m bars and 2.4 m acrylic covers per run
  const ssBars = runs.reduce((n, r) => n + r.bars * r.sets, 0);
  const totals = zero();
  for (const r of runs) if (r.fit) for (const k of CANOE_SIZES) totals[k] += r.fit.counts[k] * r.sets;
  const ledM = round(CANOE_SIZES.reduce((m, k) => m + totals[k] * NOMINAL[k], 0) * (c.double ? 2 : 1));
  const runM = round(runs.reduce((m, r) => m + r.length * r.sets, 0));
  const pieces = CANOE_SIZES.reduce((n, k) => n + totals[k], 0);
  return { lengths, runs, totals, pieces, ledM, runM, ssBars, ssCovers: ssBars };
}

/** Retrofit rows, as on the SALA quotation: LED, heat sink + jacket and piece sets priced on their own lines. */
function buildRetrofit(
  c: CanoeConfig,
  led: SkuLite | undefined,
  prices: Map<string, PartPrice>,
  newId: () => string,
) {
  const r = c.retro ?? defaultRetro();
  const tag = (role: string) => `${CNO_TAG}${c.blockId} ${role}`;
  const plan = planCanoe(c, led);
  const problems: string[] = [];
  const missing = new Set<string>();
  let list = 0;
  let allowed = 0;
  const part = (id: string, qty: number) => {
    if (!id || !(qty > 0)) return 0;
    const p = prices.get(id);
    if (!p) missing.add(id);
    const amount = (p?.unitPrice ?? 0) * qty;
    list += amount;
    allowed += (amount * (p?.maxDiscount ?? 0)) / 100;
    return amount;
  };
  if (!c.ledSkuId) problems.push("เลือกไฟ LED");
  else if (!plan.lengths) problems.push("ไฟรุ่นนี้ยังไม่มีขนาดท่อน Canoe");
  if (!plan.runs.length) problems.push("ใส่ความยาวอย่างน้อย 1 ช่วง");
  for (const x of plan.runs)
    if (x.fit && !x.fit.ok) problems.push(`ช่วง ${m(x.length)} ม. ต่อท่อนให้ได้ในระยะ +5 / −10 ซม. ไม่ได้`);
  if (!r.kitSkuId) problems.push("เลือก SKU ชุดอะคริลิก + สาย IP68");

  const base = { qty: null, unit: null, unit_price: null, cut_lengths: null, recipes: [] };
  const code = c.code.trim() ? `${c.code.trim()} : ` : "";
  const name = r.runName.trim() ? `${r.runName.trim()} : ` : "";
  const lens = plan.runs.map((x) => `${m(x.length)}M${x.sets > 1 ? ` x ${x.sets}` : ""}`).join(" + ");
  const perRun = (amount: number) => (plan.runM > 0 ? round2(amount / plan.runM) : 0);
  const ledAmount = part(c.ledSkuId, plan.ledM);
  const railQty = round(plan.runM * (c.double ? 2 : 1));
  const railAmount = part(r.heatsinkSkuId, railQty) + part(r.jacketSkuId, railQty);
  const kitAmount = part(r.kitSkuId, plan.pieces);
  const rows: CanoeRow[] = [
    { ...base, id: newId(), kind: "heading", customer_text: `${code}${c.title.trim() || "CANOE LIGHT"}` },
    {
      id: newId(),
      kind: "priced",
      customer_text: `- ${name}L = ${lens}`,
      qty: plan.runM,
      unit: "M.",
      unit_price: perRun(ledAmount),
      cut_lengths: null,
      recipes: c.ledSkuId && plan.ledM > 0 ? [{ sku_id: c.ledSkuId, qty: plan.ledM, note: tag("LED") }] : [],
    },
    {
      id: newId(),
      kind: "priced",
      customer_text: `- ALUMINIUM HEAT DISSIPATION & ${r.jacket} JACKET`,
      qty: plan.runM,
      unit: "M.",
      unit_price: perRun(railAmount),
      cut_lengths: null,
      recipes: [
        ...(r.heatsinkSkuId ? [{ sku_id: r.heatsinkSkuId, qty: railQty, note: tag("HEATSINK") }] : []),
        ...(r.jacketSkuId ? [{ sku_id: r.jacketSkuId, qty: railQty, note: tag("JACKET") }] : []),
      ],
    },
    {
      id: newId(),
      kind: "priced",
      customer_text: `- WATERPROOF ENGRAVED ACRYLIC & ${r.diffuser.toUpperCase()} ACRYLIC DIFFUSER w/ IP68 CABLE`,
      qty: plan.pieces,
      unit: "SET",
      unit_price: plan.pieces ? round2(kitAmount / plan.pieces) : 0,
      cut_lengths: null,
      recipes: r.kitSkuId && plan.pieces ? [{ sku_id: r.kitSkuId, qty: plan.pieces, note: tag("KIT") }] : [],
    },
    { ...base, id: newId(), kind: "existing", customer_text: `- ${r.housingText.trim() || "EXISTING HOUSING"}` },
    ...(r.existingPsu
      ? [{ ...base, id: newId(), kind: "existing" as const, customer_text: "- EXISTING POWER SUPPLY 24V" }]
      : []),
    {
      ...base,
      id: newId(),
      kind: "display",
      customer_text: "NOTE : STANDARD LENGTH = 500 MM/PC., OPTION LENGTH 300 MM, 400 MM.",
    },
  ];
  rows[0]!.item_no = c.itemNo?.trim() || null;
  const config: CanoeConfig = { ...c, rowIds: rows.map((x) => x.id) };
  const first = rows.flatMap((x) => x.recipes)[0];
  if (first) first.note = `${first.note} ${JSON.stringify(config)}`;
  return {
    rows,
    config,
    plan,
    list: round2(rows.reduce((s, x) => s + (x.qty ?? 0) * (x.unit_price ?? 0), 0)),
    maxDiscount: list > 0 ? Math.floor((allowed / list) * 1000) / 10 : 0,
    missing: [...missing],
    problems: [...new Set(problems)],
  };
}

/** BOQ rows for a Canoe block: a heading and one line priced per metre of run. */
export function buildCanoe(
  c: CanoeConfig,
  led: SkuLite | undefined,
  prices: Map<string, PartPrice>,
  newId: () => string,
  /** unit of a SKU ("m" → housing / cover counted in metres, else in pieces) */
  unitOf: (skuId: string) => string | undefined = () => undefined,
) {
  if (c.housingType === "retrofit") return buildRetrofit(c, led, prices, newId);
  const tag = (role: string) => `${CNO_TAG}${c.blockId} ${role}`;
  const ss = c.housingType === "ss" ? (c.ss ?? defaultSs()) : null;
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
  if (ss) {
    const inM = (id: string) => /^m\.?$|เมตร/i.test(unitOf(id) ?? "");
    const part = (id: string, pieces: number, barM: number, role: string, what: string) => {
      if (!id) {
        problems.push(`เลือก SKU ${what}`);
        return;
      }
      const qty = inM(id) ? round(pieces * barM) : pieces;
      recipes.push({ sku_id: id, qty, note: tag(role) });
      add(id, qty);
    };
    if (plan.ssBars) {
      part(ss.housingSkuId, plan.ssBars, SS_BAR_M, "SS HOUSING", "ตัวเรือนสแตนเลส");
      part(ss.coverSkuId, plan.ssCovers, COVER_M, "COVER", "ฝาครอบอะคริลิก");
    }
    if (ss.model === "custom") {
      if (!(ss.customW > 0 && ss.customH > 0)) problems.push("ใส่ขนาดหน้าตัดพิเศษ (กว้าง × สูง มม.)");
      if (ss.surcharge > 0) list += ss.surcharge;
    }
  }
  for (const k of ss ? [] : CANOE_SIZES) {
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
      customer_text: ss
        ? `${c.double ? "DOUBLE CANOE" : "CANOE"} ${ss.grade} ${ssSectionText(ss)}, ${ss.diffuser.toUpperCase()} DIFFUSER${led ? ` - ${led.name}` : ""}`
        : `${c.double ? "DOUBLE CANOE" : "CANOE"}${led ? ` - ${led.name}` : ""}`,
      qty: plan.runM,
      unit: "M.",
      unit_price: perM,
      cut_lengths: plan.runs.flatMap((r) => Array.from({ length: r.sets }, () => r.length)),
      recipes,
    },
  ];
  rows[0]!.item_no = c.itemNo?.trim() || null;
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

/**
 * LED cut per piece for production (workbook "Canoe" tab, columns ด้านนอก / ด้านใน): the outer strip
 * is as long as the single-Canoe piece, the inner strip 5 mm shorter. Single Canoe uses the outer
 * strip only; Double Canoe has both.
 */
export function pieceCuts(led: SkuLite, double: boolean) {
  const single = canoeLengths(led, false);
  const housing = canoeLengths(led, double);
  if (!single || !housing) return [];
  return CANOE_SIZES.filter((k) => single[k]).map((k) => ({
    size: k,
    housingM: housing[k]!,
    outerCm: Math.round(single[k]! * 1000) / 10,
    innerCm: double ? Math.round((single[k]! - 0.005) * 1000) / 10 : null,
  }));
}

/**
 * Runs from typed lengths ("2.49x2 + [1.2+1.3]"). Each side of a joined run [a+b] — an L-shape
 * corner, pool steps — is a separate straight Canoe and gets its own pieces; its label "2.1", "2.2"
 * (run 2, side 1 / 2) keeps them together on the sheets.
 */
export function runsFromSpec(runs: { pieces: number[]; sets: number }[]): CanoeRun[] {
  return runs.flatMap((r, gi) =>
    r.pieces.map((p, pi) => ({
      length: Math.round(p * 1000) / 1000,
      sets: r.sets,
      ...(r.pieces.length > 1 ? { label: `${gi + 1}.${pi + 1}` } : {}),
    })),
  );
}
