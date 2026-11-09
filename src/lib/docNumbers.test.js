import { test, expect } from "bun:test";
import { isAutoRef, isJobNo, jobBase, nextPartCode } from "./docNumbers.ts";

test("job and quotation numbers are recognised", () => {
  expect(isJobNo("69-047")).toBe(true);
  expect(isJobNo("68-013/1")).toBe(true);
  expect(isJobNo("QC26-55-207")).toBe(false);
  expect(isAutoRef("QC26-11-09-001")).toBe(true);
  expect(isAutoRef("QO26-11-09-012")).toBe(true);
  expect(isAutoRef("QC26-55-207")).toBe(false);
});

test("parts of a job: /1, /2 … after the highest one used", () => {
  expect(jobBase("69-037/1")).toBe("69-037");
  expect(nextPartCode("69-037", ["69-037", "69-038"])).toBe("69-037/1");
  expect(nextPartCode("69-037/1", ["69-037", "69-037/1", "69-037/3", "69-0370/9"])).toBe("69-037/4");
});
