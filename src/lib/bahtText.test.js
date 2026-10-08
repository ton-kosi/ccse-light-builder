import { test, expect } from "bun:test";
import { bahtText } from "./bahtText.ts";

test("whole baht", () => {
  expect(bahtText(10000)).toBe("หนึ่งหมื่นบาทถ้วน");
  expect(bahtText(21)).toBe("ยี่สิบเอ็ดบาทถ้วน");
  expect(bahtText(11)).toBe("สิบเอ็ดบาทถ้วน");
  expect(bahtText(1)).toBe("หนึ่งบาทถ้วน");
});

test("with satang", () => {
  expect(bahtText(10700.5)).toBe("หนึ่งหมื่นเจ็ดร้อยบาทห้าสิบสตางค์");
  expect(bahtText(0.25)).toBe("ยี่สิบห้าสตางค์");
});

test("millions", () => {
  expect(bahtText(1_000_000)).toBe("หนึ่งล้านบาทถ้วน");
  expect(bahtText(2_500_001)).toBe("สองล้านห้าแสนเอ็ดบาทถ้วน");
});
