/** Billing due date = billing date + credit days (yyyy-mm-dd). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A term is fully paid when received + withholding tax covers the term amount. */
export function isFullyPaid(amount: number, received: number, wht: number): boolean {
  return received + wht >= amount - 0.005;
}

export function outstanding(amount: number, received: number, wht: number): number {
  return Math.max(0, Math.round((amount - received - wht) * 100) / 100);
}

export const PAY_METHODS: { value: string; label: string }[] = [
  { value: "transfer", label: "โอน" },
  { value: "cheque", label: "เช็ค" },
  { value: "cash", label: "เงินสด" },
];
export const methodLabel = (m: string) => PAY_METHODS.find((x) => x.value === m)?.label ?? m;
