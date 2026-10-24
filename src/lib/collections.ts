/** Collections (ทวงเงิน): which bills to chase today and why. Dates yyyy-mm-dd. Pure, unit tested. */

export type OpenBill = {
  bill_id: string;
  due_date: string | null;
  outstanding: number;
  days_overdue: number | null;
};
export type Followup = {
  bill_id: string;
  followed_on: string;
  created_at: string;
  next_on: string | null;
  promised_on: string | null;
  channel: string;
};

export type ChaseReason = "next_due" | "promise_missed" | "overdue_no_followup" | "overdue_stale";

export const CHASE_LABEL: Record<ChaseReason, string> = {
  next_due: "ถึงวันติดตามที่นัดไว้",
  promise_missed: "เลยวันที่ลูกค้าสัญญาจะจ่าย",
  overdue_no_followup: "เกินกำหนด ยังไม่เคยติดตาม",
  overdue_stale: "เกินกำหนด ติดตามครั้งล่าสุดเกิน 7 วัน",
};

export const STALE_DAYS = 7;

const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86_400_000);

/** Latest follow-up per bill (by follow-up date, then when it was logged). */
export function latestByBill(list: Followup[]): Map<string, Followup> {
  const out = new Map<string, Followup>();
  for (const f of [...list].sort(
    (a, b) => b.followed_on.localeCompare(a.followed_on) || b.created_at.localeCompare(a.created_at),
  ))
    if (!out.has(f.bill_id)) out.set(f.bill_id, f);
  return out;
}

/** Why this bill should be chased today, or null when it can wait. */
export function chaseReason(bill: OpenBill, last: Followup | undefined, today: string): ChaseReason | null {
  if (!(bill.outstanding > 0.005)) return null;
  if (last?.next_on && last.next_on <= today) return "next_due";
  if (last?.promised_on && last.promised_on < today) return "promise_missed";
  const overdue = !!bill.due_date && bill.due_date < today;
  if (!overdue) return null;
  if (!last) return "overdue_no_followup";
  const planned = (last.next_on && last.next_on > today) || (last.promised_on && last.promised_on >= today);
  if (!planned && daysBetween(last.followed_on, today) > STALE_DAYS) return "overdue_stale";
  return null;
}

/** Bills to chase today, most overdue first. */
export function chaseList<T extends OpenBill>(bills: T[], followups: Followup[], today: string) {
  const last = latestByBill(followups);
  return bills
    .map((b) => ({ bill: b, last: last.get(b.bill_id), reason: chaseReason(b, last.get(b.bill_id), today) }))
    .filter((x): x is { bill: T; last: Followup | undefined; reason: ChaseReason } => x.reason !== null)
    .sort((a, b) => (b.bill.days_overdue ?? 0) - (a.bill.days_overdue ?? 0));
}

/** Which reminder letter to send next: 1st, 2nd, then final, counting letters already sent. */
export function nextNotice(followups: Followup[], billId: string): 1 | 2 | 3 {
  const letters = followups.filter((f) => f.bill_id === billId && f.channel === "letter").length;
  return Math.min(3, letters + 1) as 1 | 2 | 3;
}
