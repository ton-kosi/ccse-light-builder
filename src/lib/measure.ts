/** Site measurement (วัดหน้างาน) → final Rev helpers. Pure functions, unit tested. */
import { formatCutSpec, parseCutSpec } from "./cutSpec";

/** Lines a technician can measure: real work lines, not headings, notes or customer-supplied items. */
export function isMeasurable(kind: string | null | undefined): boolean {
  return !!kind && !["heading", "internal", "by_buyer", "existing"].includes(kind);
}

/** Units sold by length, where cut lengths add up to the quantity. */
export function isLengthUnit(unit: string | null | undefined): boolean {
  const u = (unit ?? "").trim().toLowerCase().replace(/\.$/, "");
  return ["ม", "เมตร", "m", "meter", "metre", "lm", "ม.ยาว"].includes(u);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * What to save from the measurement inputs. Lengths are typed in the WOS notation
 * ("0.682x2 + [3.015+3.515]x2", or a plain "1.5+2.25"); for a length unit the quantity
 * defaults to their sum when left empty.
 */
export function measurementFromInput(input: {
  qty: string;
  cuts: string;
  unit: string | null;
}):
  | { measured_qty: number | null; cut_lengths: number[] | null; cut_spec: string | null }
  | { error: string } {
  const cutsText = input.cuts.trim();
  let cut_lengths: number[] | null = null;
  let cut_spec: string | null = null;
  if (cutsText) {
    const spec = parseCutSpec(cutsText);
    if ("error" in spec) return { error: spec.error };
    cut_lengths = spec.pieces;
    cut_spec = formatCutSpec(spec.runs);
  }
  const qtyText = input.qty.trim().replace(/,/g, "");
  let measured_qty: number | null = null;
  if (qtyText) {
    const n = Number(qtyText);
    if (!Number.isFinite(n) || n < 0) return { error: "จำนวนที่วัดต้องเป็นตัวเลข 0 ขึ้นไป" };
    measured_qty = round3(n);
  } else if (cut_lengths && isLengthUnit(input.unit)) {
    measured_qty = round3(cut_lengths.reduce((s, n) => s + n, 0));
  }
  if (measured_qty === null && !cut_lengths) return { error: "ใส่จำนวนที่วัด หรือความยาวที่ตัด" };
  return { measured_qty, cut_lengths, cut_spec };
}

export type CompareRow = {
  contractQty: number;
  measuredQty: number;
  unitPrice: number;
  discountPercent: number;
};

/** +/- per line between the contract and the measurement (qty and money before VAT). */
export function compareLine(r: CompareRow) {
  const net = r.unitPrice * (1 - r.discountPercent / 100);
  const qtyDiff = round3(r.measuredQty - r.contractQty);
  const amountDiff = Math.round(qtyDiff * net * 100) / 100;
  return { qtyDiff, amountDiff };
}

/** Totals of a comparison: money difference before VAT and how many lines changed. */
export function compareTotals(rows: CompareRow[]) {
  let amount = 0;
  let changed = 0;
  for (const r of rows) {
    const d = compareLine(r);
    amount += d.amountDiff;
    if (d.qtyDiff !== 0) changed++;
  }
  return { amountDiff: Math.round(amount * 100) / 100, changed };
}
