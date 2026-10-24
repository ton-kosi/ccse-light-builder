import { describe, expect, it } from "bun:test";
import { groupByDay, installDays, isWorkingDay, jobFilePath, runsOn, weekDays, weekStart } from "./jobs.ts";

describe("job queue", () => {
  it("starts the week on Monday", () => {
    expect(weekStart("2026-10-22")).toBe("2026-10-19"); // Thursday → Monday
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // Sunday belongs to the same week
    expect(weekDays("2026-10-26")).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
  });

  it("shows a multi-day job on every day it runs", () => {
    const job = { id: "a", scheduled_date: "2026-10-20", end_date: "2026-10-22" };
    expect(runsOn(job, "2026-10-19")).toBe(false);
    expect(runsOn(job, "2026-10-20")).toBe(true);
    expect(runsOn(job, "2026-10-22")).toBe(true);
    expect(runsOn(job, "2026-10-23")).toBe(false);
    expect(runsOn({ id: "b", scheduled_date: "2026-10-20", end_date: null }, "2026-10-21")).toBe(false);
  });

  it("groups jobs by day and keeps unscheduled ones apart", () => {
    const jobs = [
      { id: "a", scheduled_date: "2026-10-20", end_date: "2026-10-21" },
      { id: "b", scheduled_date: null, end_date: null },
      { id: "c", scheduled_date: "2026-10-21", end_date: null },
    ];
    const { byDay, unscheduled } = groupByDay(jobs, ["2026-10-20", "2026-10-21"]);
    expect(byDay.get("2026-10-20").map((j) => j.id)).toEqual(["a"]);
    expect(byDay.get("2026-10-21").map((j) => j.id)).toEqual(["a", "c"]);
    expect(unscheduled.map((j) => j.id)).toEqual(["b"]);
  });
});

describe("handover", () => {
  it("counts working days (Mon–Fri) including both ends", () => {
    expect(installDays("2026-10-20", "2026-10-20")).toBe(1); // Tue
    expect(installDays("2026-10-20", "2026-10-24")).toBe(4); // Tue → Sat: Sat not counted
    expect(installDays("2026-10-30", "2026-11-02")).toBe(2); // Fri → Mon: weekend skipped
    expect(installDays(null, "2026-10-24")).toBe(null);
    expect(installDays("2026-10-24", "2026-10-20")).toBe(null);
  });

  it("skips public holidays", () => {
    const holidays = new Set(["2026-10-23"]); // วันปิยมหาราช
    expect(installDays("2026-10-20", "2026-10-24", holidays)).toBe(3);
    expect(isWorkingDay("2026-10-23", holidays)).toBe(false);
    expect(isWorkingDay("2026-10-22", holidays)).toBe(true);
    expect(isWorkingDay("2026-10-25")).toBe(false); // Sunday
  });

  it("builds a safe storage path", () => {
    expect(jobFilePath("p1", "w1", "รูป หน้างาน.JPG", "abc")).toBe("p1/w1/abc.jpg");
    expect(jobFilePath("p1", null, "plan.pdf", "x")).toBe("p1/project/x.pdf");
    expect(jobFilePath("p1", null, "noext", "x")).toBe("p1/project/x");
  });
});
