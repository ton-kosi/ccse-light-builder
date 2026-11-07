/**
 * LED linear block builder (THE PANO style):
 *
 *   LTI1 : LED STRIP 18W/M 24V ... IP54 DALI-DIM          ← type heading
 *     CKT. NO. BRA-01                                      ← circuit heading (only when a number is given)
 *     - L = 3.20M                       3.20 M.  @price    ← LED row (always shown)
 *     - ALUMINIUM HEAT DISSIPATION & SINGLE JACKET  3.20 M. ← shown if ticked
 *     - <profile name>                  3.20 M.            ← when the block has a profile, shown if ticked
 *     - INDUSTRIAL SPRAY PAINTING (BLACK) 3.20 M.          ← when a colour is set, shown if ticked
 *     - POWER SUPPLY 24V 75W DALI-DIM   1 EA.              ← sized per circuit at 80 % load
 *
 * "Show price" per item: when off, the item is still listed by name (no qty/price) and still
 * goes to stock, but its price is folded into the LED row, so the customer total is the same.
 *
 * IP decides the jacket only: IP65 = double jacket, IP44 / IP54 = single jacket.
 * A profile is a separate choice (THE PANO has IP44 with profile and IP54 / IP65 bare strips).
 * A bare strip is fixed with EZ clips unless switched off (printed "w/ EZ-CLIP", rail 4/8).
 *
 * 1-10V = ordinary 24V non-dim power supply + one mini dimmer per power supply.
 *
 * BOQ quantity: LEDs of 120 dots/m or fewer (spare LED can be folded) and COB (too dense to fold, cut
 * full) are rounded up to the cut step, piece by piece, so 1.35 × 6 at a 10 cm step is 8.40 M. Other
 * dense strips stay as typed. Production may round down on site; the final Rev then bills that length.
 */
import type { PartPrice } from "@/lib/fo";
import { inCategory, readTags } from "./skuCategory";
import { jediPercent, profileModel, type Chip, type Diffuser, type MountType } from "./profiles";
import { exactStep } from "./production";

export type IpRating = "IP44" | "IP54" | "IP65";
export type DimType = "NON-DIM" | "0-10V" | "1-10V" | "DMX" | "DALI";
export const IP_RATINGS: IpRating[] = ["IP44", "IP54", "IP65"];
export const DIM_TYPES: DimType[] = ["NON-DIM", "0-10V", "DMX", "DALI"];

/** Dimming choices of the LED linear builder (the other builders keep DIM_TYPES). */
export const LINEAR_DIM_TYPES: DimType[] = ["NON-DIM", "1-10V", "0-10V", "DMX", "DALI"];
export const isDoubleJacket = (ip: IpRating) => ip === "IP65";

export type PsuOption = {
  skuId: string;
  watt: number;
  /** waterproof unit (IP6x): automatic takes the ordinary SWP first */
  waterproof?: boolean;
};
export type Extra = { skuId: string; perM: number };
export type Circuit = {
  ckt: string;
  lengths: number[];
  /** power supply picked by hand (e.g. sized for a load shared with another item); absent = automatic */
  psuSkuId?: string | null;
  /** runs on another item's power supply, e.g. "ITEM 8.1": no PSU of its own, printed as a note */
  sharedWith?: string | null;
};

export type LinearConfig = {
  v: 1;
  blockId: string;
  /** item number of the heading; circuits print as <item>.1, <item>.2 … */
  itemNo?: string | null;
  /** has a profile; absent (older blocks) = the old rule, every IP except IP44 */
  withProfile?: boolean;
  /** LED cut step (cm) the quantity is rounded up to; absent = quantity as typed */
  cutStepCm?: number | null;
  /** bare strip not fixed with EZ clips */
  noEzClip?: boolean;
  /** mini dimmer per circuit, for 1-10V */
  dimmerSkuId?: string | null;
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
  /** customer text of the profile line (generated from the choices below, still editable) */
  profileName: string;
  /** catalogue profile (see profiles.ts); null/absent = profile picked by SKU only */
  profileModel?: string | null;
  mount?: MountType;
  trim?: boolean;
  diffuser?: Diffuser;
  /** Jedi % typed by hand; null/absent = from the catalogue */
  jediPct?: number | null;
  /** LED facts used for profile / rail fit */
  chip?: Chip;
  pcbMm?: number | null;
  ezClip?: boolean;
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
  item_no?: string | null;
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

/** Cut step to round up to: LEDs of 120 dots/m or fewer and COB; denser strips stay as typed. */
export function roundUpStep(dots: string | null, cutStepCm: number | null | undefined): number | null {
  if (!cutStepCm || !(cutStepCm > 0) || !dots) return null;
  return dots === "COB" || Number(dots) <= 120 ? cutStepCm : null;
}

/** Metres quoted for a circuit: each piece rounded up to the LED's cut step. */
export function circuitQty(ck: Circuit, c: Pick<LinearConfig, "cutStepCm">): number {
  if (!c.cutStepCm) return circuitLength(ck);
  const step = exactStep(c.cutStepCm);
  return r3(
    ck.lengths.reduce((s, x) => s + (x > 0 ? (Math.ceil((x * 100) / step - 1e-6) * step) / 100 : 0), 0),
  );
}
// keeps millimetres when they were typed: 3.20M, 2.848M
const m = (x: number) => `${x.toFixed(Number.isInteger(Math.round(x * 1000) / 10) ? 2 : 3)}M`;

export function dimLabel(d: DimType): string {
  return d === "NON-DIM" ? "NON-DIM" : d === "0-10V" || d === "1-10V" ? `${d} DIM` : `${d}-DIM`;
}

export const usesProfile = (c: Pick<LinearConfig, "withProfile" | "ip">) =>
  c.withProfile ?? c.ip !== "IP44";

/** EZ clips: a bare strip unless switched off, or an LED whose SKU says it uses them. */
export const usesEz = (c: Pick<LinearConfig, "withProfile" | "ip" | "noEzClip" | "ezClip">) =>
  !!c.ezClip || (!usesProfile(c) && !c.noEzClip);

/** What a PSU is sold as: real 26.4 / 76.8 / 156 W SWPs are the 25 / 75 / 150 W on quotations. */
export function nominalWatt(w: number): number {
  const down = Math.floor(w / 25 + 1e-9) * 25;
  return down > 0 && w - down <= down * 0.1 ? down : Math.round(w);
}

/** Smallest PSU whose rated watt × load ≥ needed; if none is big enough, several of the largest. */
export function pickPsu(
  watts: number,
  options: PsuOption[],
  load = 0.8,
): { skuId: string; watt: number; count: number } | null {
  const opts = options.filter((o) => o.watt > 0).sort((a, b) => a.watt - b.watt);
  if (!(watts > 0) || !opts.length) return null;
  const swp = opts.filter((o) => !o.waterproof);
  const fit =
    swp.find((o) => o.watt * load >= watts - 1e-9) ?? opts.find((o) => o.watt * load >= watts - 1e-9);
  if (fit) return { ...fit, count: 1 };
  const big = (swp.length ? swp : opts).at(-1)!;
  return { ...big, count: Math.ceil(watts / (big.watt * load) - 1e-9) };
}

/**
 * Jedi % shown after the LED name: only with a catalogue profile and the Jedi diffuser.
 * A hand-typed value wins over the catalogue.
 */
export function jediOf(c: LinearConfig): number | null {
  const model = profileModel(c.profileModel);
  if (!usesProfile(c) || !model || (c.diffuser ?? "JEDI") !== "JEDI") return null;
  if (c.jediPct != null) return c.jediPct;
  return jediPercent(model, c.wattPerM, c.chip ?? "STANDARD");
}

export function typeHeading(
  c: Pick<LinearConfig, "typeCode" | "ledName" | "ip" | "dim">,
  jedi: number | null = null,
): string {
  const code = c.typeCode.trim();
  const j = jedi != null ? ` (JEDI ${jedi}%)` : "";
  return `${code ? `${code} : ` : ""}${c.ledName.trim()}${j} ${c.ip} ${dimLabel(c.dim)}`.trim();
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
  const itemNo = c.itemNo?.trim() || null;
  rows.push({
    id: newId(),
    kind: "heading",
    item_no: itemNo,
    customer_text: typeHeading(c, jediOf(c)),
    qty: null,
    unit: null,
    unit_price: null,
    recipes: [],
  });

  const jacket = isDoubleJacket(c.ip) ? c.doubleJacketSkuId : c.singleJacketSkuId;
  const jacketWord = isDoubleJacket(c.ip) ? "DOUBLE" : "SINGLE";
  const withProfile = usesProfile(c) && !!c.profileSkuId;
  const ezText = !usesProfile(c) && usesEz(c) ? " w/ EZ-CLIP" : "";
  const switching = c.dim === "NON-DIM" || c.dim === "1-10V";
  const psuWords = switching ? "SWITCHING POWER SUPPLY 24V" : "POWER SUPPLY 24V";
  const psuDim = switching ? "" : ` ${dimLabel(c.dim)}`;
  let cktNo = 0;

  c.circuits.forEach((ck) => {
    const L = circuitQty(ck, c);
    if (!(L > 0)) return;
    // no circuit number = no "CKT. NO." line on the quotation
    cktNo += 1;
    if (ck.ckt.trim())
      rows.push({
        id: newId(),
        kind: "heading",
        item_no: itemNo ? `${itemNo}.${cktNo}` : null,
        customer_text: `CKT. NO. ${ck.ckt.trim()}`,
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
      `- ALUMINIUM HEAT DISSIPATION & ${jacketWord} JACKET${ezText}`,
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
    const psu = psuOfCircuit(ck, c);
    const shared = ck.sharedWith?.trim();
    if (shared)
      extraRows.push({
        id: newId(),
        kind: "display",
        customer_text: `- ${psuWords}${psuDim} (SHARED w/ ${shared})`,
        qty: null,
        unit: null,
        unit_price: null,
        recipes: [],
      });
    else if (psu)
      item(
        c.show.psu,
        `- ${psuWords} ${nominalWatt(psu.watt)}W${psuDim}`,
        psu.count,
        "EA.",
        [{ skuId: psu.skuId, qty: psu.count, stock: true }],
        "PSU",
        ` x ${psu.count}`,
      );
    if (c.dim === "1-10V" && !shared)
      item(
        c.show.psu,
        "- MINI DIMMER FOR 1-10V",
        psu?.count ?? 1,
        "SET",
        [{ skuId: c.dimmerSkuId ?? null, qty: psu?.count ?? 1, stock: true }],
        "DIMMER",
        ` x ${psu?.count ?? 1}`,
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

/** The circuit's PSU: none when shared, the one picked by hand if still offered, else automatic. */
export function psuOfCircuit(ck: Circuit, c: Pick<LinearConfig, "wattPerM" | "psuOptions" | "loadFactor" | "cutStepCm">) {
  if (ck.sharedWith?.trim()) return null;
  const hand = ck.psuSkuId ? c.psuOptions.find((o) => o.skuId === ck.psuSkuId) : null;
  if (hand) return { ...hand, count: 1 };
  return pickPsu(circuitQty(ck, c) * c.wattPerM, c.psuOptions, c.loadFactor);
}

/** A smaller SWP that is just over the load limit (at most 90 %): someone may confirm it by hand. */
export function nearFitPsu(watts: number, options: PsuOption[], load = 0.8): PsuOption | null {
  const fits = (o: PsuOption) => o.watt * load >= watts - 1e-9;
  return (
    options
      .filter((o) => !o.waterproof && !fits(o) && watts <= o.watt * 0.9 + 1e-9)
      .sort((a, b) => b.watt - a.watt)[0] ?? null
  );
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

type SkuLite = { id: string; code: string; name: string; notes?: string | null };
const txt = (s: SkuLite) => `${s.code} ${s.name}`;
/**
 * PSU wattage from code + name: "100W", "100 w", "100วัตต์", "PSU100W24V";
 * Mean Well style codes without a W ("LPV-100-24", "HLG-150H-24") also work.
 */
export function wattOfPsu(s: SkuLite): number | null {
  const saved = Number(readTags(s.notes)["วัตต์"]);
  if (saved > 0) return saved;
  const t = txt(s);
  const mm = t.match(/(\d+(?:\.\d+)?)\s*(?:W|วัตต์)(?![a-zA-Z/])/i);
  if (mm) return Number(mm[1]);
  // Mean Well style: HLG-150H-24A, ELG-100-700A
  const mw = t.match(/\b[A-Z]{2,5}-(\d{2,4})[A-Z]*-\d{2,4}[A-Z]*\b/i);
  return mw ? Number(mw[1]) : null;
}
export function wattPerMOf(s: SkuLite | undefined): number | null {
  const saved = s ? Number(readTags(s.notes)["W/m"]) : 0;
  if (saved > 0) return saved;
  const mm = s ? txt(s).match(/(\d+(?:\.\d+)?)\s*W\s*\/?\s*m/i) : null;
  return mm ? Number(mm[1]) : null;
}
/**
 * Dimming type a PSU is for. "non dim" / "no dim" / "ไม่ดิม" = NON-DIM; a protocol name wins;
 * no dimming word at all = NON-DIM; "dim" without a protocol = unknown (null).
 */
export function psuDimOf(s: SkuLite): DimType | null {
  const saved = readTags(s.notes)["ดิม"];
  if (saved && (DIM_TYPES as string[]).includes(saved)) return saved as DimType;
  const t = txt(s);
  if (/non[\s_-]*dim|\bno[\s_-]*dim|ไม่\s*(ดิม|หรี่)/i.test(t)) return "NON-DIM";
  if (/dali/i.test(t)) return "DALI";
  if (/dmx/i.test(t)) return "DMX";
  if (/(?<!\d)[01]\s*-\s*10\s*v/i.test(t)) return "0-10V";
  if (/dim|หรี่/i.test(t)) return null;
  return "NON-DIM";
}

/** Output of a PSU: volts, "CC" for constant current (350–700 mA), null when the SKU doesn't say. */
export function psuVoltOf(s: SkuLite): number | "CC" | null {
  const t = txt(s);
  if (/\d\s*mA\b|(^|[-_\s])CC([-_\s]|$)/i.test(t)) return "CC";
  const v = t.match(/(?<![\d.-])(\d{1,2})\s*V(?:dc)?\b/i);
  if (v) return Number(v[1]);
  const m = t.match(/-CV-[^\s]*?-(\d{2})-/i) ?? t.match(/\b[A-Z]{2,5}-\d{2,4}[A-Z]*-(\d{2})[A-Z]*\b/i);
  return m ? Number(m[1]) : null;
}

export type PsuSkip = { id: string; code: string; name: string; reason: string };

/** PSUs usable for a dimming type, plus the ones in the category that were skipped and why. */
export function psuReport(psus: SkuLite[], d: DimType): { options: PsuOption[]; skipped: PsuSkip[] } {
  const options: PsuOption[] = [];
  const skipped: PsuSkip[] = [];
  for (const s of psus) {
    const dim = psuDimOf(s);
    const watt = wattOfPsu(s);
    const base = { id: s.id, code: s.code, name: s.name };
    if (dim !== d)
      skipped.push({
        ...base,
        reason: dim ? `เป็น ${dim}` : "ยังไม่ได้ตั้งระบบดิม (ตั้งที่หน้า SKU)",
      });
    else if (!watt) skipped.push({ ...base, reason: "ยังไม่ได้ตั้งวัตต์ (ตั้งที่หน้า SKU)" });
    else options.push({ skuId: s.id, watt });
  }
  return { options, skipped };
}

/** PSUs for an LED of this kind (volts or constant current): the others are skipped, with the reason. */
export function psuKindReport(
  psus: SkuLite[],
  d: DimType,
  want: number | "CC",
): { options: PsuOption[]; skipped: PsuSkip[] } {
  const fits = (s: SkuLite) => {
    const v = psuVoltOf(s);
    return v === null || v === want;
  };
  const words = (v: number | "CC" | null) => (v === "CC" ? "constant current" : `${v}V`);
  const r = psuReport(psus.filter(fits), d === "1-10V" ? "NON-DIM" : d);
  const wet = new Set(psus.filter((s) => /\bIP\s*6\d/i.test(txt(s))).map((s) => s.id));
  const options = r.options
    .map((o) => (wet.has(o.skuId) ? { ...o, waterproof: true } : o))
    .sort((a, b) => a.watt - b.watt);
  const other = psus.filter((s) => !fits(s)).map((s) => {
    const v = psuVoltOf(s);
    return { id: s.id, code: s.code, name: s.name, reason: `เป็น ${words(v)} ไม่ใช่ ${words(want)}` };
  });
  return { options, skipped: [...r.skipped, ...other] };
}

export const psu24Report = (psus: SkuLite[], d: DimType) => psuKindReport(psus, d, 24);

/** SKU options per part, by stock category (หมวดในหน้าสต๊อก); names only split sub-types. */
export function linearSkuGroups<T extends SkuLite>(skus: T[]) {
  const jackets = inCategory(skus, "LED jacket");
  const profiles = inCategory(skus, "LED profile");
  const service = inCategory(skus, "Service");
  const paints = service.filter((s) => /paint|สี/i.test(txt(s)));
  const psus = inCategory(skus, "Power supply");
  return {
    leds: inCategory(skus, "LED ribbon"),
    heatsinks: inCategory(skus, "LED heat sink"),
    jackets,
    singleJackets: jackets.filter((s) => !/double/i.test(txt(s))),
    doubleJackets: jackets.filter((s) => /double/i.test(txt(s))),
    profiles,
    profileExtras: [...profiles, ...inCategory(skus, "LED accessory")],
    paints: paints.length ? paints : service,
    psus,
    psuFor: (d: DimType): PsuOption[] => psuReport(psus, d).options,
    psuReport: (d: DimType) => psuReport(psus, d),
    dimmers: inCategory(skus, "Dimmer / controller"),
    /** LED linear / neon run on 24V: leaves out 12V, 15V and constant-current units; 1-10V uses non-dim units */
    psu24Report: (d: DimType) => psu24Report(psus, d),
    psu24For: (d: DimType): PsuOption[] => psu24Report(psus, d).options,
    /** for any LED: its own kind of supply (a LED that doesn't say is taken as 24V) */
    psuForLed: (led: SkuLite | undefined, d: DimType): PsuOption[] =>
      psuKindReport(psus, d, (led ? psuVoltOf(led) : null) ?? 24).options,
  };
}
