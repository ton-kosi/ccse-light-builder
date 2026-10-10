/**
 * LED linear block builder (THE PANO style):
 *
 *   LTI1 : LED STRIP 18W/M 24V ... IP54 DALI-DIM          ← type heading
 *     CKT. NO. BRA-01                                      ← circuit heading
 *     - L = 3.20M                       3.20 M.  @price    ← LED row (always shown)
 *     - ALUMINIUM HEAT DISSIPATION & SINGLE JACKET  3.20 M. ← shown if ticked
 *     - <profile name>                  3.20 M.            ← IP54/IP65 only, shown if ticked
 *     - INDUSTRIAL SPRAY PAINTING (BLACK) 3.20 M.          ← when a colour is set, shown if ticked
 *     - POWER SUPPLY 24V 75W DALI-DIM   1 EA.              ← sized per circuit at 80 % load
 *
 * "Show price" per item: when off, the item is still listed by name (no qty/price) and still
 * goes to stock, but its price is folded into the LED row, so the customer total is the same.
 *
 * IP rules: IP44 = no profile, heat sink + single jacket
 *           IP54 = profile, heat sink + single jacket
 *           IP65 = profile, heat sink + double jacket
 */
import type { PartPrice } from "@/lib/fo";

export type IpRating = "IP44" | "IP54" | "IP65";
export type DimType = "NON-DIM" | "0-10V" | "DMX" | "DALI";
export const IP_RATINGS: IpRating[] = ["IP44", "IP54", "IP65"];
export const DIM_TYPES: DimType[] = ["NON-DIM", "0-10V", "DMX", "DALI"];

export const hasProfile = (ip: IpRating) => ip !== "IP44";
export const isDoubleJacket = (ip: IpRating) => ip === "IP65";

export type PsuOption = { skuId: string; watt: number };
export type Extra = { skuId: string; perM: number };
export type Circuit = { ckt: string; lengths: number[] };

export type LinearConfig = {
  v: 1;
  blockId: string;
  typeCode: string;
  ledSkuId: string;
  ledName: string;
  wattPerM: number;
  ip: IpRating;
  dim: DimType;
  heatsinkSkuId: string | null;
  singleJacketSkuId: string | null;
  doubleJacketSkuId: string | null;
  profileSkuId: string | null;
  profileName: string;
  profileExtras: Extra[];
  color: string;
  paintSkuId: string | null;
  psuOptions: PsuOption[];
  loadFactor: number;
  show: { heatsink: boolean; profile: boolean; paint: boolean; psu: boolean };
  circuits: Circuit[];
  /** quote_line ids created for this block (so it can be replaced when edited) */
  rowIds: string[];
};

export type LinRecipe = { sku_id: string; qty: number; note: string };
export type LinRow = {
  id: string;
  kind: "heading" | "priced" | "display";
  customer_text: string;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  recipes: LinRecipe[];
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
export const circuitLength = (c: Circuit) => r3(c.lengths.reduce((s, x) => s + (x > 0 ? x : 0), 0));
const m = (x: number) => `${x.toFixed(2)}M`;

export function dimLabel(d: DimType): string {
  return d === "NON-DIM" ? "NON-DIM" : d === "0-10V" ? "0-10V DIM" : `${d}-DIM`;
}

/** Smallest PSU whose rated watt × load ≥ needed; if none is big enough, several of the largest. */
export function pickPsu(
  watts: number,
  options: PsuOption[],
  load = 0.8,
): { skuId: string; watt: number; count: number } | null {
  const opts = options.filter((o) => o.watt > 0).sort((a, b) => a.watt - b.watt);
  if (!(watts > 0) || !opts.length) return null;
  const fit = opts.find((o) => o.watt * load >= watts - 1e-9);
  if (fit) return { ...fit, count: 1 };
  const big = opts[opts.length - 1]!;
  return { ...big, count: Math.ceil(watts / (big.watt * load) - 1e-9) };
}

export function typeHeading(c: Pick<LinearConfig, "typeCode" | "ledName" | "ip" | "dim">): string {
  const code = c.typeCode.trim();
  return `${code ? `${code} : ` : ""}${c.ledName.trim()} ${c.ip} ${dimLabel(c.dim)}`.trim();
}

export const TAG = "LIN ";
export const isLinNote = (n: string | null | undefined) => !!n && n.startsWith(TAG);

/**
 * Builds the BOQ rows (with materials and prices) for the whole block.
 * newId supplies ids for new rows so the config can remember them.
 */
export function buildLinear(c: LinearConfig, prices: Map<string, PartPrice>, newId: () => string) {
  const missing = new Set<string>();
  const price = (skuId: string | null) => {
    if (!skuId) return 0;
    const p = prices.get(skuId);
    if (!p) {
      missing.add(skuId);
      return 0;
    }
    return p.unitPrice;
  };
  const maxDisc = (skuId: string | null) => (skuId ? (prices.get(skuId)?.maxDiscount ?? 0) : 0);
  let list = 0;
  let allowed = 0;
  const add = (amount: number, skuId: string | null) => {
    list += amount;
    allowed += (amount * maxDisc(skuId)) / 100;
  };

  const rows: LinRow[] = [];
  const tag = (role: string) => `${TAG}${c.blockId} ${role}`;
  rows.push({
    id: newId(),
    kind: "heading",
    customer_text: typeHeading(c),
    qty: null,
    unit: null,
    unit_price: null,
    recipes: [],
  });

  const jacket = isDoubleJacket(c.ip) ? c.doubleJacketSkuId : c.singleJacketSkuId;
  const jacketWord = isDoubleJacket(c.ip) ? "DOUBLE" : "SINGLE";
  const withProfile = hasProfile(c.ip) && !!c.profileSkuId;

  c.circuits.forEach((ck, i) => {
    const L = circuitLength(ck);
    if (!(L > 0)) return;
    rows.push({
      id: newId(),
      kind: "heading",
      customer_text: `CKT. NO. ${ck.ckt.trim() || i + 1}`,
      qty: null,
      unit: null,
      unit_price: null,
      recipes: [],
    });

    const led: LinRow = {
      id: newId(),
      kind: "priced",
      customer_text: `- L = ${ck.lengths
        .filter((x) => x > 0)
        .map(m)
        .join(" + ")}`,
      qty: L,
      unit: "M.",
      unit_price: 0,
      recipes: [{ sku_id: c.ledSkuId, qty: L, note: tag("LED") }],
    };
    let ledAmount = L * price(c.ledSkuId);
    add(ledAmount, c.ledSkuId);
    const extraRows: LinRow[] = [];

    const item = (
      show: boolean,
      text: string,
      qty: number,
      unit: string,
      parts: { skuId: string | null; qty: number; stock: boolean }[],
      role: string,
      hiddenSuffix = "",
    ) => {
      let amount = 0;
      const recipes: LinRecipe[] = [];
      for (const p of parts) {
        if (!p.skuId || !(p.qty > 0)) continue;
        const a = p.qty * price(p.skuId);
        amount += a;
        add(a, p.skuId);
        if (p.stock) recipes.push({ sku_id: p.skuId, qty: r3(p.qty), note: tag(role) });
      }
      if (show) {
        extraRows.push({
          id: newId(),
          kind: "priced",
          customer_text: text,
          qty: r3(qty),
          unit,
          unit_price: qty ? r2(amount / qty) : 0,
          recipes,
        });
      } else {
        // price hidden: keep the line (name only) and its stock, fold the price into the LED row
        ledAmount += amount;
        extraRows.push({
          id: newId(),
          kind: "display",
          customer_text: text + hiddenSuffix,
          qty: null,
          unit: null,
          unit_price: null,
          recipes,
        });
      }
    };

    item(
      c.show.heatsink,
      `- ALUMINIUM HEAT DISSIPATION & ${jacketWord} JACKET`,
      L,
      "M.",
      [
        { skuId: c.heatsinkSkuId, qty: L, stock: true },
        { skuId: jacket, qty: L, stock: true },
      ],
      "HEATSINK",
    );
    if (withProfile)
      item(
        c.show.profile,
        `- ${c.profileName.trim()}`,
        L,
        "M.",
        [
          { skuId: c.profileSkuId, qty: L, stock: true },
          ...c.profileExtras.map((e) => ({ skuId: e.skuId, qty: e.perM * L, stock: true })),
        ],
        "PROFILE",
      );
    if (withProfile && c.color.trim() && c.paintSkuId)
      item(
        c.show.paint,
        `- INDUSTRIAL SPRAY PAINTING (${c.color.trim()})`,
        L,
        "M.",
        [
          // painting is a service: priced, not drawn from stock
          { skuId: c.paintSkuId, qty: L, stock: false },
        ],
        "PAINT",
      );
    const psu = pickPsu(L * c.wattPerM, c.psuOptions, c.loadFactor);
    if (psu)
      item(
        c.show.psu,
        `- POWER SUPPLY 24V ${psu.watt}W ${dimLabel(c.dim)}`,
        psu.count,
        "EA.",
        [{ skuId: psu.skuId, qty: psu.count, stock: true }],
        "PSU",
        ` x ${psu.count}`,
      );

    led.unit_price = r2(ledAmount / L);
    rows.push(led, ...extraRows);
  });

  // Remember the config (with the row ids) on the first LED material so the block can be edited later.
  const config: LinearConfig = { ...c, rowIds: rows.map((r) => r.id) };
  const firstLed = rows.find((r) => r.recipes.some((x) => x.note === tag("LED")));
  if (firstLed) {
    const rec = firstLed.recipes.find((x) => x.note === tag("LED"))!;
    rec.note = `${TAG}${c.blockId} LED ${JSON.stringify(config)}`;
  }
  const total = r2(rows.reduce((s, r) => s + (r.qty ?? 0) * (r.unit_price ?? 0), 0));
  return {
    rows,
    config,
    list: total,
    maxDiscount: list > 0 ? Math.floor((allowed / list) * 1000) / 10 : 0,
    missing: [...missing],
  };
}

/** Reads a block config back from the LED material note. */
export function parseLinear(note: string | null | undefined): LinearConfig | null {
  if (!isLinNote(note)) return null;
  const i = note!.indexOf("{");
  if (i < 0) return null;
  try {
    const c = JSON.parse(note!.slice(i)) as LinearConfig;
    return c && c.v === 1 ? c : null;
  } catch {
    return null;
  }
}

/** "0.70+0.70" or "0.7 0.7" → [0.7, 0.7] */
export function parseLengths(text: string): number[] {
  return text
    .split(/[+,\s]+/)
    .map((x) => Number(x))
    .filter((x) => x > 0);
}

/* ---------------------------------------------------------------- SKU suggestions */

type SkuLite = { id: string; code: string; name: string };
const txt = (s: SkuLite) => `${s.code} ${s.name}`;
export function wattOfPsu(s: SkuLite): number | null {
  const mm = txt(s).match(/(\d+(?:\.\d+)?)\s*W\b/i);
  return mm ? Number(mm[1]) : null;
}
export function wattPerMOf(s: SkuLite | undefined): number | null {
  const mm = s ? txt(s).match(/(\d+(?:\.\d+)?)\s*W\s*\/?\s*m/i) : null;
  return mm ? Number(mm[1]) : null;
}
const dimRe: Record<DimType, RegExp> = {
  DALI: /dali/i,
  DMX: /dmx/i,
  "0-10V": /0\s*-\s*10\s*v/i,
  "NON-DIM": /^(?!.*(dali|dmx|0\s*-\s*10\s*v|dim)).*$/i,
};

export function linearSkuGroups(skus: SkuLite[]) {
  const has = (re: RegExp) => skus.filter((s) => re.test(txt(s)));
  const psus = has(/power\s*supply|\bpsu\b|driver|switching/i);
  return {
    leds: has(/\bled\b|strip/i).filter((s) => !/power|psu|driver/i.test(txt(s))),
    heatsinks: has(/heat|alu(minium|minum)?\b|flat\s*bar/i).filter((s) => !/profile/i.test(txt(s))),
    jackets: has(/jacket/i),
    singleJackets: has(/jacket/i).filter((s) => !/double/i.test(txt(s))),
    doubleJackets: has(/double/i).filter((s) => /jacket/i.test(txt(s))),
    profiles: has(/profile/i),
    paints: has(/paint|สี/i),
    psuFor: (d: DimType): PsuOption[] =>
      psus
        .filter((s) => dimRe[d].test(txt(s)))
        .map((s) => ({ skuId: s.id, watt: wattOfPsu(s) ?? 0 }))
        .filter((o) => o.watt > 0),
  };
}
