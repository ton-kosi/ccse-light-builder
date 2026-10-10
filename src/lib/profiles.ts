/**
 * CCSE LED profile catalogue (Jedi V2 W13 / W22 and 45° Reverse), from the product sheets
 * (Jan 2026 revision, trims May 2022).
 *
 * - Jedi %: how evenly the diffuser hides the LED dots, per LED option and profile depth.
 * - Overall size depends on mounting (mounting accessories vs silicone vs screw) and on the trim.
 * - Aluminium rail (heat sink): 3/8" fits V2.13 (W13) and 45° Reverse only; 4/8" fits V2.22 (W22)
 *   and strips that use EZ clips.
 * - Strips with a PCB wider than 10 mm (e.g. RGBW) do not fit V2.13 (W13) or 45° Reverse.
 */

import { readTags } from "./skuCategory";

export type MountType = "SNAP" | "SLIDE" | "CLIP" | "SLIDE LOCK" | "SILICONE" | "SCREW";
export type Diffuser = "JEDI" | "CLEAR" | "SATIN" | "CHARCOAL";
export type Chip = "STANDARD" | "NICHIA";
export type RailSize = "3/8" | "4/8";

export const DIFFUSERS: Diffuser[] = ["JEDI", "CLEAR", "SATIN", "CHARCOAL"];

/** [width, height] in mm */
type Size = [number, number];

export type ProfileModel = {
  key: string;
  /** what the customer sees, e.g. "JEDI V2 W13.20" */
  title: string;
  family: "V2.13" | "V2.22" | "45R";
  mounts: MountType[];
  /** overall size per mounting, without and with trim */
  size: (mount: MountType, trim: boolean) => Size;
  hasTrim: boolean;
  rail: RailSize;
  /** widest PCB that fits (mm); null = no limit known */
  maxPcbMm: number | null;
  jediBand: "13" | "20" | "25" | "45R";
  /** words that identify this profile's stock SKU */
  skuMatch: RegExp;
};

const V2_MOUNTS: MountType[] = ["CLIP", "SNAP", "SLIDE", "SILICONE"];

function v2(
  w: "13" | "22",
  h: "13" | "20" | "25",
  plain: { mount: Size; silicone: Size },
  trim: { mount: Size; silicone: Size },
): ProfileModel {
  return {
    key: `W${w}.${h}`,
    title: `JEDI V2 W${w}.${h}`,
    family: w === "13" ? "V2.13" : "V2.22",
    mounts: V2_MOUNTS,
    size: (m, t) => (t ? trim : plain)[m === "SILICONE" ? "silicone" : "mount"],
    hasTrim: true,
    rail: w === "13" ? "3/8" : "4/8",
    maxPcbMm: w === "13" ? 10 : null,
    jediBand: h,
    skuMatch: new RegExp(`w?${w}[.\\s_-]?${h}\\b`, "i"),
  };
}

export const PROFILE_MODELS: ProfileModel[] = [
  v2("13", "13", { mount: [13.4, 18.4], silicone: [13.4, 12.8] }, { mount: [22.6, 18.3], silicone: [22.6, 12.8] }),
  v2("13", "20", { mount: [13.4, 24.2], silicone: [13.4, 18.7] }, { mount: [22.6, 24.2], silicone: [22.6, 18.7] }),
  v2("13", "25", { mount: [13.4, 29.3], silicone: [13.4, 23.7] }, { mount: [22.6, 29.2], silicone: [22.6, 23.7] }),
  v2("22", "13", { mount: [22.0, 18.4], silicone: [22.0, 12.8] }, { mount: [31.2, 18.4], silicone: [31.2, 12.8] }),
  v2("22", "20", { mount: [22.0, 24.2], silicone: [22.0, 18.7] }, { mount: [31.2, 24.2], silicone: [31.2, 18.7] }),
  v2("22", "25", { mount: [22.0, 29.3], silicone: [22.0, 23.7] }, { mount: [31.2, 29.2], silicone: [31.2, 23.7] }),
  {
    key: "45R",
    title: "45° REVERSE",
    family: "45R",
    mounts: ["CLIP", "SNAP", "SLIDE LOCK", "SILICONE", "SCREW"],
    size: (m) => (m === "SILICONE" ? [18.9, 15.0] : m === "SCREW" ? [26.1, 17.0] : [18.9, 19.0]),
    hasTrim: false,
    rail: "3/8",
    maxPcbMm: 10,
    jediBand: "45R",
    skuMatch: /45\s*°?\s*(deg|องศา)?\s*rev|reverse/i,
  },
];

export const profileModel = (key: string | null | undefined) =>
  PROFILE_MODELS.find((p) => p.key === key) ?? null;

/* ---------------------------------------------------------------- Jedi % */

/** LED options on the sheets, in sheet order: W/m + chip. */
const LED_OPTIONS: [number, Chip][] = [
  [4.0, "STANDARD"],
  [4.5, "STANDARD"],
  [7.0, "NICHIA"],
  [8.0, "STANDARD"],
  [9.4, "STANDARD"],
  [12.0, "STANDARD"],
  [13.8, "STANDARD"],
  [13.8, "NICHIA"],
  [15.0, "STANDARD"],
  [18.0, "STANDARD"],
  [19.0, "STANDARD"],
];
const JEDI: Record<ProfileModel["jediBand"], number[]> = {
  "13": [90, 50, 25, 100, 90, 100, 100, 50, 100, 100, 100],
  "20": [100, 80, 45, 100, 100, 100, 100, 80, 100, 100, 100],
  "25": [100, 100, 80, 100, 100, 100, 100, 100, 100, 100, 100],
  "45R": [90, 85, 35, 100, 90, 100, 100, 85, 100, 100, 100],
};

/** Jedi % for an LED (W/m + chip) in a profile, or null when the sheet doesn't list that LED. */
export function jediPercent(model: ProfileModel, wattPerM: number, chip: Chip): number | null {
  const i = LED_OPTIONS.findIndex(([w, c]) => Math.abs(w - wattPerM) < 0.05 && c === chip);
  return i < 0 ? null : JEDI[model.jediBand][i]!;
}

/* ---------------------------------------------------------------- LED facts from the SKU */

// LED facts come from the SKU's own fields (set on the SKU page); the name is only a fallback.
type SkuLite = { id: string; code: string; name: string; notes?: string | null };
const txt = (s: SkuLite) => `${s.code} ${s.name}`;
const tag = (s: SkuLite | undefined, k: string) => (s ? readTags(s.notes)[k] : undefined);
const num = (v: string | undefined) => (v != null && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null);

export const chipOf = (s: SkuLite | undefined): Chip => {
  const t = tag(s, "ชิป");
  if (t) return /nichia/i.test(t) ? "NICHIA" : "STANDARD";
  return s && /nichia/i.test(txt(s)) ? "NICHIA" : "STANDARD";
};

export const usesEzClip = (s: SkuLite | undefined) => {
  const t = tag(s, "EZ clip");
  if (t != null) return t === "ใช่";
  return !!s && /ez\s*-?\s*clip/i.test(txt(s));
};

/** PCB width (mm): SKU field, else "12mm" in the name; RGBW-type strips are wider than 10 mm. */
export function pcbOf(s: SkuLite | undefined): number | null {
  if (!s) return null;
  const saved = num(tag(s, "ปริ้น"));
  if (saved != null) return saved;
  const t = txt(s);
  const mm = t.match(/(\d+(?:\.\d+)?)\s*mm\b/i);
  if (mm) return Number(mm[1]);
  if (/rgbw|rgb\s*\+\s*w|rgbww|rgbcct/i.test(t)) return 12;
  return null;
}

/** Why a profile can't take this strip, or null when it fits. */
export function fitProblem(model: ProfileModel, pcbMm: number | null): string | null {
  if (pcbMm != null && model.maxPcbMm != null && pcbMm > model.maxPcbMm)
    return `แผ่นปริ้นกว้าง ${pcbMm} มม. เกิน ${model.maxPcbMm} มม. ใส่ ${model.title} ไม่ได้`;
  return null;
}

/** Rail size the job needs: EZ-clip strips always 4/8; otherwise the profile decides. */
export function railNeeded(model: ProfileModel | null, ezClip: boolean): RailSize | null {
  if (ezClip) return "4/8";
  return model?.rail ?? null;
}

export function railOf(s: SkuLite): RailSize | null {
  const saved = tag(s, "ราง");
  if (saved === "3/8" || saved === "4/8") return saved;
  const t = txt(s);
  if (/3\s*\/\s*8/.test(t)) return "3/8";
  if (/4\s*\/\s*8|1\s*\/\s*2\s*(")?/.test(t)) return "4/8";
  return null;
}

/* ---------------------------------------------------------------- text + stock SKU */

const mm = (x: number) => x.toFixed(2);

export type ProfileChoice = {
  model: ProfileModel;
  mount: MountType;
  trim: boolean;
  diffuser: Diffuser;
};

export function profileSize(p: ProfileChoice): Size {
  return p.model.size(p.mount, p.trim && p.model.hasTrim);
}

/** e.g. "ALUMINIUM PROFILE JEDI V2 W13.20 w/ TRIM, JEDI DIFFUSER & CLIP MOUNTING (SIZE 22.60 x 24.20 MM)" */
export function profileText(p: ProfileChoice): string {
  const [w, h] = profileSize(p);
  const trim = p.trim && p.model.hasTrim ? "TRIM, " : "";
  return `ALUMINIUM PROFILE ${p.model.title} w/ ${trim}${p.diffuser} DIFFUSER & ${p.mount} MOUNTING (SIZE ${mm(w)} x ${mm(h)} MM)`;
}

/** Best stock SKU for the chosen profile: same model, then trim / silicone / screw variant. */
export function matchProfileSku<T extends SkuLite>(skus: T[], p: ProfileChoice): T | null {
  const same = skus.filter((s) => p.model.skuMatch.test(txt(s)));
  if (!same.length) return null;
  const want = {
    trim: p.trim && p.model.hasTrim,
    silicone: p.mount === "SILICONE",
    screw: p.mount === "SCREW",
  };
  const score = (s: T) => {
    const t = txt(s);
    let n = 0;
    if (/trim/i.test(t) === want.trim) n += 2;
    if (/silicone|\bsil\b/i.test(t) === want.silicone) n += 2;
    if (/screw/i.test(t) === want.screw) n += 1;
    return n;
  };
  return [...same].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Profile model of a stock SKU: the SKU's "รุ่น" field, else recognised from its name. */
export function profileModelOfSku(s: SkuLite | undefined): ProfileModel | null {
  if (!s) return null;
  const saved = profileModel(tag(s, "รุ่น"));
  if (saved) return saved;
  return PROFILE_MODELS.find((m) => m.skuMatch.test(txt(s))) ?? null;
}
