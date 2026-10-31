// Barcode scanning: what a scan matches. Our labels carry the SKU code; skus.barcodes holds
// supplier barcodes and old SKU codes (kept automatically on rename).

type Scannable = { id: string; code: string; barcodes?: string[] | null };

/** Clean what a scanner or camera produced: trim, drop control characters (Enter, tab, GS). */
export function cleanScan(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;

/**
 * The SKU a scan points at. The SKU code wins over barcodes; a barcode shared by several SKUs
 * returns all of them so the person can pick.
 */
export function findByScan<T extends Scannable>(items: T[], raw: string): { match: T | null; candidates: T[] } {
  const text = cleanScan(raw);
  if (!text) return { match: null, candidates: [] };
  const byCode = items.find((k) => same(k.code, text));
  if (byCode) return { match: byCode, candidates: [byCode] };
  const byBarcode = items.filter((k) => (k.barcodes ?? []).some((b) => same(b, text)));
  return { match: byBarcode.length === 1 ? byBarcode[0]! : null, candidates: byBarcode };
}

/** "8851234567890, 885…" / one per line → unique, trimmed list (for the SKU form and CSV). */
export function parseBarcodeList(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const part of (text ?? "").split(/[\s,;|]+/)) {
    const v = cleanScan(part);
    if (v && !out.some((o) => same(o, v))) out.push(v);
  }
  return out;
}

/** Add one barcode to a list (no duplicates, never the SKU's own code). */
export function withBarcode(list: string[] | null | undefined, code: string, skuCode: string): string[] {
  const v = cleanScan(code);
  const cur = list ?? [];
  if (!v || same(v, skuCode) || cur.some((b) => same(b, v))) return cur;
  return [...cur, v];
}
