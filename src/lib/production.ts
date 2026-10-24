/**
 * Production sheet (ใบผลิต) rules, taken from the CCSE production workbook (FORM WPS):
 * - LED cut = site length rounded to the strip's cut step (shorter or longer option)
 * - profile cut = LED cut − 0.4 cm
 * - heat shrink = LED cut + 2 cm per piece
 * - clips ≈ one every 40 cm; aluminium bars are 6 m
 * - load (A) = W/m × length (m) ÷ 24 V; power supply loaded to at most 80 %
 * Pure functions, unit tested. Lengths in cm unless the name says m.
 */
import type { CutRun } from "./cutSpec";

export const PROFILE_SHORTER_CM = 0.4;
export const SHRINK_EXTRA_CM = 2;
export const CLIP_EVERY_CM = 40;
export const BAR_LENGTH_CM = 600;
export const LED_VOLT = 24;
export const PSU_MAX_LOAD = 0.8;

/** 24 V switching supplies on the CCSE material list (A). */
export const PSU_24V_AMPS = [1.1, 1.5, 2.2, 3.2, 4.5, 6.5, 8.8, 14.6, 18.8];

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Cut steps are written rounded (16.67, 3.33, 4.16, 1.67) but are exact thirds / sixths of a
 * centimetre count (50/3, 10/3, 25/6, 5/3); use the exact value so long runs do not drift.
 */
export function exactStep(stepCm: number): number {
  for (const d of [3, 6]) {
    const n = Math.round(stepCm * d);
    if (Math.abs(n / d - stepCm) < 0.011) return n / d;
  }
  return stepCm;
}

/** Largest multiple of the step that fits, and the next one up (both in cm). */
export function ledCutOptions(siteCm: number, rawStepCm: number) {
  if (!(rawStepCm > 0)) return { shorter: r2(siteCm), longer: r2(siteCm), diffShorter: 0, diffLonger: 0 };
  const stepCm = exactStep(rawStepCm);
  const n = Math.floor(siteCm / stepCm + 1e-9);
  const shorter = r2(n * stepCm);
  const longer = shorter >= siteCm - 1e-9 ? shorter : r2((n + 1) * stepCm);
  return { shorter, longer, diffShorter: r2(siteCm - shorter), diffLonger: r2(siteCm - longer) };
}

export type Rounding = "down" | "up";

export type PieceInput = {
  /** site length of one piece, metres */
  lengthM: number;
  /** how many identical pieces (sets) */
  sets: number;
  stepCm: number | null;
  wattPerM: number | null;
  hasProfile: boolean;
  rounding: Rounding;
};

export type PieceRow = {
  siteCm: number;
  sets: number;
  ledCm: number;
  profileCm: number | null;
  diffCm: number;
  shrinkCm: number;
  clips: number;
  amps: number | null;
  shorter: number;
  longer: number;
};

/** One production row: a piece length × sets with its cut, profile, shrink, clips and load. */
export function pieceRow(p: PieceInput): PieceRow {
  const siteCm = r2(p.lengthM * 100);
  const o = ledCutOptions(siteCm, p.stepCm ?? 0);
  const ledCm = p.rounding === "up" ? o.longer : o.shorter;
  const amps = p.wattPerM ? r2(((p.wattPerM * ledCm) / 100 / LED_VOLT) * p.sets) : null;
  return {
    siteCm,
    sets: p.sets,
    ledCm,
    profileCm: p.hasProfile ? r2(ledCm - PROFILE_SHORTER_CM) : null,
    diffCm: r2(siteCm - ledCm),
    shrinkCm: r2((ledCm + SHRINK_EXTRA_CM) * p.sets),
    clips: Math.max(1, Math.ceil(ledCm / CLIP_EVERY_CM)) * p.sets,
    amps,
    shorter: o.shorter,
    longer: o.longer,
  };
}

/** Rows for a line: each run's pieces (joined pieces stay separate rows) × the run's sets. */
export function lineRows(
  runs: CutRun[],
  opts: Omit<PieceInput, "lengthM" | "sets">,
): PieceRow[] {
  return runs.flatMap((r) => r.pieces.map((len) => pieceRow({ ...opts, lengthM: len, sets: r.sets })));
}

/** Totals of a line's rows, in metres where it says m. */
export function lineTotals(rows: PieceRow[]) {
  const pieces = rows.reduce((s, r) => s + r.sets, 0);
  const ledCm = rows.reduce((s, r) => s + r.ledCm * r.sets, 0);
  const profileCm = rows.reduce((s, r) => s + (r.profileCm ?? 0) * r.sets, 0);
  const amps = rows.every((r) => r.amps === null) ? null : r2(rows.reduce((s, r) => s + (r.amps ?? 0), 0));
  return {
    pieces,
    ledM: r2(ledCm / 100),
    profileM: r2(profileCm / 100),
    shrinkM: r2(rows.reduce((s, r) => s + r.shrinkCm, 0) / 100),
    clips: rows.reduce((s, r) => s + r.clips, 0),
    bars: Math.ceil(ledCm / BAR_LENGTH_CM - 1e-9),
    amps,
  };
}

/** Smallest 24 V supply that carries the load at ≤ 80 %; null when the load is over the largest. */
export function suggestPsu(amps: number | null, list: number[] = PSU_24V_AMPS): number | null {
  if (!amps || amps <= 0) return null;
  return list.find((a) => a * PSU_MAX_LOAD >= amps) ?? null;
}

/** "14.4" from "LED strip 14.4W/m 24V", "7W/M" → 7. */
export function wattFromText(text: string | null | undefined): number | null {
  const m = (text ?? "").match(/(\d+(?:\.\d+)?)\s*W\s*\/\s*M/i);
  return m ? Number(m[1]) : null;
}

/** Colour temperature / colour from text: "2700K", "RGB", "RGBW". */
export function colourFromText(text: string | null | undefined): string | null {
  const t = text ?? "";
  const k = t.match(/\b(\d{4})\s*K\b/i);
  if (k) return `${k[1]}K`;
  const c = t.match(/\b(RGBW|RGB|BI-?COLOU?R)\b/i);
  return c ? c[1]!.toUpperCase() : null;
}

/** Fixture code before the colon of a BOQ heading: "LX-473.022.1 : LED STRIP …" → "LX-473.022.1". */
export function fixtureCode(text: string | null | undefined): string | null {
  const m = (text ?? "").match(/^\s*([A-Z]{1,4}-?[\w.\-/]+)\s*:/i);
  return m ? m[1]! : null;
}
