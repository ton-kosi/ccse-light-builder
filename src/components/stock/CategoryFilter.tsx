import { categoryOf, categoryOptions } from "@/lib/skuCategory";

type SkuLike = { code: string; name: string; notes?: string | null };

/** Dropdown to show one stock category (หมวด) at a time, with counts. "" = all. */
export function CategoryFilter({
  skus,
  value,
  onChange,
}: {
  skus: SkuLike[];
  value: string;
  onChange: (v: string) => void;
}) {
  const count = new Map<string, number>();
  for (const s of skus) {
    const c = categoryOf(s);
    count.set(c, (count.get(c) ?? 0) + 1);
  }
  const options = categoryOptions(skus).filter((c) => count.has(c) || c === value);
  return (
    <select
      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="หมวด"
    >
      <option value="">ทุกหมวด ({skus.length})</option>
      {options.map((c) => (
        <option key={c} value={c}>
          {c} ({count.get(c) ?? 0})
        </option>
      ))}
    </select>
  );
}
