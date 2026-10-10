/**
 * Stock categories (หมวดสินค้า) for SKUs.
 *
 * The `skus` table has no category column, so the category is kept as a tag at the start of
 * `skus.notes` — "[หมวด: LED ribbon] the rest of the note". Screens strip the tag before showing
 * the note. SKUs without a tag fall back to a guess from their code/name so existing data keeps
 * working; the SKU page shows guesses and can save them in one click.
 */

/** Query key for the SKU list with category tags, shared by the FO and linear builders. */
export const SKU_OPTIONS_KEY = ["skus", "options", "with-category"];

export const SKU_CATEGORIES = [
  "LED ribbon",
  "Power supply",
  "LED profile",
  "LED heat sink",
  "LED jacket",
  "LED accessory",
  "FO illuminator",
  "FO cable",
  "FO accessory",
  "Neon flex",
  "Stretch ceiling",
  "Smart film",
  "Service",
  "อื่นๆ",
] as const;

export type SkuCategoryName = (typeof SKU_CATEGORIES)[number];

/** Short Thai hint shown next to each category in pickers. */
export const CATEGORY_HINT: Partial<Record<SkuCategoryName, string>> = {
  "LED ribbon": "เส้น LED / strip",
  "Power supply": "หม้อแปลง / driver",
  "LED profile": "รางอลูมิเนียม + ฝาครอบ",
  "LED heat sink": "อลูมิเนียมระบายความร้อน",
  "LED jacket": "ปลอกซิลิโคน single / double",
  "LED accessory": "ฝาปิดท้าย, คลิป, diffuser เสริม",
  "FO illuminator": "เครื่องกำเนิดแสง",
  "FO cable": "สาย fiber แต่ละขนาด",
  "FO accessory": "end finishing, harness, optical port, WP box",
  Service: "งานบริการ เช่น พ่นสี (ไม่ตัดสต๊อก)",
};

type SkuLike = { code: string; name: string; notes?: string | null };

const TAG_RE = /^\s*\[หมวด:\s*([^\]]+?)\s*\]\s*/;

/** Category saved on the SKU, or null when none was saved. */
export function savedCategory(notes: string | null | undefined): string | null {
  const m = notes ? TAG_RE.exec(notes) : null;
  return m ? m[1]! : null;
}

/** The note without the category tag (what users see and edit). */
export function noteText(notes: string | null | undefined): string {
  return (notes ?? "").replace(TAG_RE, "").trim();
}

/** Builds the `notes` value to store: category tag + note. */
export function withCategory(note: string, category: string | null): string | null {
  const rest = noteText(note);
  const cat = category?.trim();
  const out = cat ? `[หมวด: ${cat}]${rest ? " " + rest : ""}` : rest;
  return out || null;
}

/** Best guess from code + name, used until a category is saved. */
export function guessCategory(s: SkuLike): SkuCategoryName {
  const t = `${s.code} ${s.name}`;
  const fo = /\bfo|fiber|fibre|starry/i.test(t);
  if (/illuminator/i.test(t)) return "FO illuminator";
  if (/end\s*finish|harness|optical\s*port/i.test(t)) return "FO accessory";
  if (fo && /cable|สาย/i.test(t)) return "FO cable";
  if (fo && /\bwp\b|wp\s*box|waterproof/i.test(t)) return "FO accessory";
  if (/power\s*supply|\bpsu\b|driver|switching|adapter|transformer|หม้อแปลง|ไดรเวอร์|\b(lpv|hlg|lpf|elg|xlg)-/i.test(t))
    return "Power supply";
  if (/paint|พ่นสี|ค่าแรง|labou?r|service/i.test(t)) return "Service";
  if (/profile/i.test(t)) return "LED profile";
  if (/jacket|cover\d/i.test(t)) return "LED jacket";
  if (/heat|alu(minium|minum)?\b|flat\s*bar/i.test(t)) return "LED heat sink";
  if (/diffuser|end\s*cap|clip|bracket|connector/i.test(t)) return "LED accessory";
  if (/neon|flex/i.test(t)) return "Neon flex";
  if (/clipso|stretch/i.test(t)) return "Stretch ceiling";
  if (/smart\s*film/i.test(t)) return "Smart film";
  if (/\bled\b|strip|ribbon|jedi/i.test(t)) return "LED ribbon";
  if (fo) return "FO accessory";
  return "อื่นๆ";
}

/** Saved category, or the guess when none is saved. */
export function categoryOf(s: SkuLike): string {
  return savedCategory(s.notes) ?? guessCategory(s);
}

export function inCategory<T extends SkuLike>(skus: T[], ...cats: string[]): T[] {
  const want = new Set(cats.map((c) => c.toLowerCase()));
  return skus.filter((s) => want.has(categoryOf(s).toLowerCase()));
}

/** All categories in use plus the standard ones, standard ones first. */
export function categoryOptions(skus: SkuLike[]): string[] {
  const extra = new Set<string>();
  const std = new Set<string>(SKU_CATEGORIES.map((c) => c.toLowerCase()));
  for (const s of skus) {
    const c = savedCategory(s.notes);
    if (c && !std.has(c.toLowerCase())) extra.add(c);
  }
  return [...SKU_CATEGORIES, ...[...extra].sort()];
}
