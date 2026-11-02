// Parts lists (สูตรประกอบ): a SKU made from other SKUs.
//   stock   = assembled ahead and kept in stock ("ประกอบเข้าสต็อก" takes parts out, puts kits in)
//   phantom = never stocked; projects use its parts instead (exploded in project_demand, SQL)

export type KitMode = "none" | "stock" | "phantom";

export const KIT_MODES: { value: KitMode; label: string; hint: string }[] = [
  { value: "none", label: "ไม่มีสูตร", hint: "สินค้าปกติ" },
  {
    value: "stock",
    label: "ประกอบเก็บสต็อก",
    hint: "ประกอบเองล่วงหน้าแล้วเก็บเป็นสต็อก เช่น V2 Snap mount (housing อะคริลิก + แม่เหล็ก)",
  },
  {
    value: "phantom",
    label: "แตกตอนเบิก",
    hint: "ไม่เก็บสต็อกตัวมันเอง เบิกเป็นชิ้นส่วนแทน เช่น Power dimmer, Smart control",
  },
];

export const kitModeLabel = (m: string | null | undefined) =>
  KIT_MODES.find((k) => k.value === m)?.label ?? "ไม่มีสูตร";

export type Part = { component_sku_id: string; qty: number };

/** Parts needed to assemble `qty` kits, with what is on hand and how much is short. */
export function assembleNeeds(
  parts: Part[],
  qty: number,
  onHand: Map<string, number>,
): { component_sku_id: string; perKit: number; need: number; onHand: number; short: number }[] {
  return parts.map((p) => {
    const need = round(p.qty * qty);
    const have = onHand.get(p.component_sku_id) ?? 0;
    return { component_sku_id: p.component_sku_id, perKit: p.qty, need, onHand: have, short: round(Math.max(0, need - have)) };
  });
}

/** Most kits the parts on hand allow (0 when any part is missing). */
export function maxAssemble(parts: Part[], onHand: Map<string, number>): number {
  if (!parts.length) return 0;
  return Math.max(0, Math.min(...parts.map((p) => Math.floor((onHand.get(p.component_sku_id) ?? 0) / p.qty + 1e-9))));
}

/**
 * Same as the database: phantom kits in a demand list are replaced by their parts (one level);
 * a phantom kit without parts stays as itself. Used to preview / test the SQL rule.
 */
export function explodeDemand(
  demand: { sku_id: string; qty: number }[],
  modeOf: (skuId: string) => KitMode,
  partsOf: (skuId: string) => Part[],
): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string, q: number) => out.set(id, round((out.get(id) ?? 0) + q));
  for (const d of demand) {
    const parts = modeOf(d.sku_id) === "phantom" ? partsOf(d.sku_id) : [];
    if (parts.length) for (const p of parts) add(p.component_sku_id, d.qty * p.qty);
    else add(d.sku_id, d.qty);
  }
  return out;
}

export type BomCsvRow = { kit_code?: string; component_code?: string; qty?: string; kit_mode?: string };

const MODE_WORDS: Record<string, KitMode> = {
  stock: "stock",
  "ประกอบเก็บสต็อก": "stock",
  phantom: "phantom",
  "แตกตอนเบิก": "phantom",
  none: "none",
};

/**
 * CSV "kit_code, component_code, qty[, kit_mode]" → parts per kit. Every problem is reported with
 * its row number so nothing is saved half-way.
 */
export function parseBomCsv(
  rows: BomCsvRow[],
  idByCode: Map<string, string>,
): { kits: Map<string, { mode: KitMode | null; parts: Part[] }>; errors: string[] } {
  const kits = new Map<string, { mode: KitMode | null; parts: Part[] }>();
  const errors: string[] = [];
  const find = (code: string) => idByCode.get(code) ?? idByCode.get(code.toLowerCase()) ?? null;
  rows.forEach((r, i) => {
    const line = i + 2;
    const kitCode = (r.kit_code ?? "").trim();
    const partCode = (r.component_code ?? "").trim();
    if (!kitCode && !partCode) return;
    const kitId = find(kitCode);
    const partId = find(partCode);
    const qty = Number((r.qty ?? "").replace(/,/g, ""));
    if (!kitId) errors.push(`แถว ${line}: ไม่พบสินค้า ${kitCode || "(ว่าง)"}`);
    if (!partId) errors.push(`แถว ${line}: ไม่พบชิ้นส่วน ${partCode || "(ว่าง)"}`);
    if (!Number.isFinite(qty) || qty <= 0) errors.push(`แถว ${line}: qty ต้องมากกว่า 0`);
    if (kitId && partId && kitId === partId) errors.push(`แถว ${line}: ${kitCode} ใช้ตัวเองเป็นชิ้นส่วนไม่ได้`);
    const modeWord = (r.kit_mode ?? "").trim().toLowerCase();
    const mode = modeWord ? (MODE_WORDS[modeWord] ?? null) : null;
    if (modeWord && !mode) errors.push(`แถว ${line}: kit_mode ใช้ stock หรือ phantom`);
    if (!kitId || !partId || !(qty > 0) || kitId === partId) return;
    const kit = kits.get(kitId) ?? { mode: null, parts: [] };
    if (mode) kit.mode = mode;
    const same = kit.parts.find((p) => p.component_sku_id === partId);
    if (same) same.qty = round(same.qty + qty);
    else kit.parts.push({ component_sku_id: partId, qty });
    kits.set(kitId, kit);
  });
  return { kits, errors };
}

function round(n: number) {
  return Math.round(n * 1e6) / 1e6;
}
