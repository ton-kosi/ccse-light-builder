/** "INVOICE PAYMENT" billing document: summary of payment rows and the money block. */

export type BillDoc = {
  id: string;
  created_at: string;
  cancelled_at: string | null;
  description: string;
  term_seq: number | null;
  amount: number | string;
  request_amount: number | string | null;
  deduct_amount: number | string | null;
  vat_percent: number | string;
  vat_amount: number | string;
  grand_total: number | string;
  wht_percent: number | string | null;
  wht_amount: number | string | null;
  net_payment: number | string | null;
};

export type SummaryLine = {
  id: string;
  item: number;
  description: string;
  request: number;
  deduct: number;
  payable: number;
  current: boolean;
};

/**
 * This bill plus the project's earlier (not cancelled) bills, oldest first — columns (1) payment
 * request, (2) deduct of deposit, (3) = (1) − (2) payable, and the accumulated total of (3).
 */
export function summaryOfPayment(current: BillDoc, all: BillDoc[]) {
  const earlier = all
    .filter((d) => d.id !== current.id && !d.cancelled_at && d.created_at < current.created_at)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const lines: SummaryLine[] = [...earlier, current].map((d, i) => {
    const payable = Number(d.amount);
    const deduct = Number(d.deduct_amount ?? 0);
    return {
      id: d.id,
      item: i + 1,
      description: d.description,
      request: d.request_amount === null ? payable + deduct : Number(d.request_amount),
      deduct,
      payable,
      current: d.id === current.id,
    };
  });
  return { lines, accumulated: round2(lines.reduce((s, l) => s + l.payable, 0)) };
}

/** TOTAL → VAT → GRAND TOTAL → withholding tax → THIS TIME PAYMENT. */
export function billMoney(d: BillDoc) {
  const total = Number(d.amount);
  const vat = Number(d.vat_amount);
  const grand = Number(d.grand_total);
  const whtPercent = Number(d.wht_percent ?? 0);
  const wht = Number(d.wht_amount ?? 0);
  const pay = d.net_payment === null ? round2(grand - wht) : Number(d.net_payment);
  return { total, vatPercent: Number(d.vat_percent), vat, grand, whtPercent, wht, pay };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2026-07-16" → "16 July 2026" */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "-";
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
