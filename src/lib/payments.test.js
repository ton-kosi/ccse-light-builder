import { test, expect } from "bun:test";
import { addDays, isFullyPaid, outstanding } from "./payments.ts";

test("due date = billing date + 15 credit days", () => {
  expect(addDays("2026-10-08", 15)).toBe("2026-10-23");
  expect(addDays("2026-12-20", 15)).toBe("2027-01-04");
});

test("received + withholding tax >= amount is fully paid", () => {
  expect(isFullyPaid(10000, 9700, 300)).toBe(true);
  expect(isFullyPaid(10000, 9700, 0)).toBe(false);
});

test("outstanding never negative", () => {
  expect(outstanding(10000, 6000, 300)).toBe(3700);
  expect(outstanding(10000, 11000, 0)).toBe(0);
});
