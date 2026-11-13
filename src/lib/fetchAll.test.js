import { test, expect } from "bun:test";
import { fetchAll, matchesSearch } from "./fetchAll.ts";

test("reads every page, not just the first 1,000 rows", async () => {
  const rows = Array.from({ length: 2345 }, (_, i) => i);
  const calls = [];
  const all = await fetchAll(async (from, to) => {
    calls.push([from, to]);
    return { data: rows.slice(from, to + 1), error: null };
  });
  expect(all.length).toBe(2345);
  expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
});

test("a page error stops the read", async () => {
  await expect(fetchAll(async () => ({ data: null, error: { message: "boom" } }))).rejects.toThrow("boom");
});

test("search: any order of words, code or name, Thai sara am either way", () => {
  expect(matchesSearch("centara grand", ["C003-1", "CENTARA GRAND ISLAND RESORT"])).toBe(true);
  expect(matchesSearch("c003", ["C003-1", "CENTARA"])).toBe(true);
  expect(matchesSearch("ศาลา จํากัด", ["ศ005", "บริษัท ศาลา บางปะอิน จำกัด"])).toBe(true);
  expect(matchesSearch("hilton", ["C003", "CENTARA"])).toBe(false);
  expect(matchesSearch("  ", ["x"])).toBe(true);
});
