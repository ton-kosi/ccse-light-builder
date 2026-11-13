/**
 * The database hands back at most 1,000 rows per request. For lists that can be longer
 * (customers: 1,088 after the import from the old system), read them page by page.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
}

/** Search text the way people type it: case, spaces and the Thai "ำ" written as "ํา" don't matter. */
export const normalizeSearch = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/ํา/g, "ำ").replace(/\s+/g, " ").trim();

/** True when every word of the query appears in one of the fields. */
export function matchesSearch(query: string, fields: (string | null | undefined)[]): boolean {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const hay = fields.map(normalizeSearch).join(" | ");
  return words.every((w) => hay.includes(w));
}
