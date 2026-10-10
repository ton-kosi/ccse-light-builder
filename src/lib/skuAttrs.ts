/**
 * Extra facts per stock category, entered on the SKU page and read by the BOQ builders.
 * Stored as tags in skus.notes (see skuCategory.ts); keys are the tag names.
 */
import { chipOf, pcbOf, PROFILE_MODELS, profileModelOfSku, railOf, usesEzClip } from "./profiles";
import { psuDimOf, wattOfPsu, wattPerMOf } from "./linear";
import { readTags } from "./skuCategory";

export type AttrField =
  | { key: string; label: string; kind: "number"; unit?: string; hint?: string }
  | { key: string; label: string; kind: "select"; options: { value: string; label: string }[]; hint?: string }
  | { key: string; label: string; kind: "bool"; hint?: string };

const DIMS = ["NON-DIM", "0-10V", "DMX", "DALI"].map((v) => ({ value: v, label: v }));

export const ATTR_FIELDS: Record<string, AttrField[]> = {
  "LED ribbon": [
    { key: "W/m", label: "วัตต์ต่อเมตร", kind: "number", unit: "W/m" },
    {
      key: "ชิป",
      label: "ชิป",
      kind: "select",
      options: [
        { value: "STANDARD", label: "Standard chip" },
        { value: "NICHIA", label: "Nichia chip" },
      ],
      hint: "ใช้หา Jedi % คู่กับวัตต์",
    },
    { key: "ปริ้น", label: "ความกว้างแผ่นปริ้น", kind: "number", unit: "มม.", hint: "เกิน 10 มม. ใส่ V2 W13 / 45° Reverse ไม่ได้" },
    { key: "EZ clip", label: "ใช้ EZ clip (ต้องใช้ราง 4/8)", kind: "bool" },
  ],
  "Neon flex": [{ key: "W/m", label: "วัตต์ต่อเมตร", kind: "number", unit: "W/m" }],
  "LED profile": [
    {
      key: "รุ่น",
      label: "รุ่น profile",
      kind: "select",
      options: PROFILE_MODELS.map((m) => ({ value: m.key, label: m.title })),
      hint: "ใช้คำนวณขนาดรวม Jedi % และขนาดราง",
    },
  ],
  "LED heat sink": [
    {
      key: "ราง",
      label: "ขนาดราง",
      kind: "select",
      options: [
        { value: "3/8", label: '3/8" (V2.13, 45° Reverse)' },
        { value: "4/8", label: '4/8" (V2.22, EZ clip)' },
      ],
    },
  ],
  "Power supply": [
    { key: "วัตต์", label: "วัตต์", kind: "number", unit: "W" },
    { key: "ดิม", label: "ระบบดิม", kind: "select", options: DIMS },
  ],
};

export const attrFieldsFor = (category: string) => ATTR_FIELDS[category] ?? [];

/** Tags other than the category, as editable strings. */
export function attrsOf(notes: string | null | undefined): Record<string, string> {
  const { หมวด: _cat, ...rest } = readTags(notes);
  return rest;
}

/** Keeps only the fields that belong to the category (switching category drops the others). */
export function attrsForCategory(category: string, attrs: Record<string, string>) {
  const keys = new Set(attrFieldsFor(category).map((f) => f.key));
  return Object.fromEntries(Object.entries(attrs).filter(([k]) => keys.has(k)));
}

type SkuLite = { id: string; code: string; name: string; notes?: string | null };

/** Fields read from the name (or already saved) — used to prefill the form and the bulk save. */
export function guessAttrs(s: SkuLite, category: string): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: string | number | boolean | null | undefined) => {
    if (v === true) out[k] = "ใช่";
    else if (v != null && v !== false && v !== "") out[k] = String(v);
  };
  if (category === "LED ribbon" || category === "Neon flex") {
    put("W/m", wattPerMOf(s));
    if (category === "LED ribbon") {
      put("ชิป", chipOf(s));
      put("ปริ้น", pcbOf(s));
      put("EZ clip", usesEzClip(s));
    }
  } else if (category === "LED profile") put("รุ่น", profileModelOfSku(s)?.key);
  else if (category === "LED heat sink") put("ราง", railOf(s));
  else if (category === "Power supply") {
    put("วัตต์", wattOfPsu(s));
    put("ดิม", psuDimOf(s));
  }
  return { ...out, ...attrsForCategory(category, attrsOf(s.notes)) };
}

/** Short summary for tables, e.g. "18 W/m · NICHIA · ปริ้น 10 มม.". */
export function attrSummary(category: string, attrs: Record<string, string>): string {
  return attrFieldsFor(category)
    .filter((f) => attrs[f.key] && (f.kind !== "bool" || attrs[f.key] === "ใช่"))
    .map((f) =>
      f.kind === "bool" ? f.key : f.kind === "number" ? `${f.key === "ปริ้น" ? "ปริ้น " : ""}${attrs[f.key]} ${f.unit ?? ""}`.trim() : attrs[f.key]!,
    )
    .join(" · ");
}
