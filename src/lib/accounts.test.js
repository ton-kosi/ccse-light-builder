import { test, expect } from "bun:test";
import {
  generatePassword,
  isPlaceholderEmail,
  loginEmailFor,
  looksLikeEmail,
  passwordError,
  usernameError,
} from "./accounts.ts";

test("User ID rules", () => {
  expect(usernameError("somchai.k")).toBeNull();
  expect(usernameError("  Somchai ")).toBeNull(); // trimmed + lower-cased
  expect(usernameError("ab")).not.toBeNull();
  expect(usernameError("สมชาย")).not.toBeNull();
  expect(usernameError("has space")).not.toBeNull();
});

test("placeholder login email", () => {
  expect(loginEmailFor(" Somchai ")).toBe("somchai@users.ccse-group.com");
  expect(isPlaceholderEmail("somchai@users.ccse-group.com")).toBe(true);
  expect(isPlaceholderEmail("ton@ccse-group.com")).toBe(false);
  expect(isPlaceholderEmail(null)).toBe(false);
});

test("login field: email or User ID", () => {
  expect(looksLikeEmail("ton@ccse-group.com")).toBe(true);
  expect(looksLikeEmail("somchai")).toBe(false);
});

test("password rules: lower, upper, digit, symbol, 8+", () => {
  expect(passwordError("Abc123!x")).toBeNull();
  expect(passwordError("Ab1!")).toContain("8");
  expect(passwordError("abc12345")).toContain("ตัวพิมพ์ใหญ่");
  expect(passwordError("Abc12345")).toContain("สัญลักษณ์");
  expect(passwordError("ABC!2345")).toContain("ตัวพิมพ์เล็ก");
  expect(passwordError("Abcdefg!")).toContain("ตัวเลข");
});

test("generated passwords pass the rules", () => {
  for (let i = 0; i < 200; i++) {
    const p = generatePassword();
    expect(p).toHaveLength(12);
    expect(passwordError(p)).toBeNull();
    expect(/[01lIO]/.test(p)).toBe(false);
  }
});
