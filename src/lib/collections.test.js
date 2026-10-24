import { describe, expect, it } from "bun:test";
import { chaseList, chaseReason, latestByBill, nextNotice } from "./collections.ts";

const today = "2026-10-24";
const bill = (over = {}) => ({ bill_id: "b1", due_date: "2026-10-10", outstanding: 1000, days_overdue: 14, ...over });
const fu = (over = {}) => ({
  bill_id: "b1",
  followed_on: "2026-10-20",
  created_at: "2026-10-20T03:00:00Z",
  next_on: null,
  promised_on: null,
  channel: "call",
  ...over,
});

describe("who to chase today", () => {
  it("chases an overdue bill nobody has followed up", () => {
    expect(chaseReason(bill(), undefined, today)).toBe("overdue_no_followup");
  });

  it("waits for a planned next follow-up or a promise still ahead", () => {
    expect(chaseReason(bill(), fu({ next_on: "2026-10-28" }), today)).toBe(null);
    expect(chaseReason(bill(), fu({ promised_on: "2026-10-24" }), today)).toBe(null);
  });

  it("chases when the next follow-up date has come or the promise was missed", () => {
    expect(chaseReason(bill(), fu({ next_on: "2026-10-24" }), today)).toBe("next_due");
    expect(chaseReason(bill(), fu({ promised_on: "2026-10-23" }), today)).toBe("promise_missed");
  });

  it("chases again when the last call was over 7 days ago with nothing planned", () => {
    expect(chaseReason(bill(), fu({ followed_on: "2026-10-16" }), today)).toBe("overdue_stale");
    expect(chaseReason(bill(), fu({ followed_on: "2026-10-17" }), today)).toBe(null);
  });

  it("ignores paid bills and bills not yet due", () => {
    expect(chaseReason(bill({ outstanding: 0 }), undefined, today)).toBe(null);
    expect(chaseReason(bill({ due_date: "2026-10-30", days_overdue: null }), undefined, today)).toBe(null);
  });
});

describe("chase list", () => {
  it("uses the latest follow-up per bill and sorts by days overdue", () => {
    const bills = [bill({ bill_id: "a", days_overdue: 5, due_date: "2026-10-19" }), bill({ bill_id: "b", days_overdue: 30, due_date: "2026-09-24" })];
    const list = chaseList(
      bills,
      [
        fu({ bill_id: "a", followed_on: "2026-10-01", next_on: "2026-10-05" }),
        fu({ bill_id: "a", followed_on: "2026-10-22", created_at: "2026-10-22T01:00:00Z", next_on: "2026-11-01" }),
      ],
      today,
    );
    expect(list.map((x) => [x.bill.bill_id, x.reason])).toEqual([["b", "overdue_no_followup"]]);
    expect(latestByBill([fu({ bill_id: "a", followed_on: "2026-10-01" }), fu({ bill_id: "a", followed_on: "2026-10-22" })]).get("a").followed_on).toBe("2026-10-22");
  });

  it("suggests the 1st, 2nd, then final reminder letter", () => {
    expect(nextNotice([], "b1")).toBe(1);
    expect(nextNotice([fu({ channel: "letter" })], "b1")).toBe(2);
    expect(nextNotice([fu({ channel: "letter" }), fu({ channel: "letter" }), fu({ channel: "letter" })], "b1")).toBe(3);
    expect(nextNotice([fu({ channel: "call" })], "b1")).toBe(1);
  });
});
