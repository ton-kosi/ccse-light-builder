/**
 * Fiber optic (FO) starry set: one priced BOQ line (1 SET) whose real materials are stored as
 * tagged line_recipes, so stock demand, the pick list and cost all use real quantities while the
 * customer only sees machine count and points per size.
 *
 *   illuminator     = machines
 *   cable per size  = points × length per point (m)   (customer sees points only)
 *   end finishing   = total points of all sizes
 *   harness / port  = machines
 *   WP box          = machines, optional per job
 */
export type FoSize = { label: string; skuId: string; points: number };

export type FoConfig = {
  title: string;
  illuminatorSkuId: string;
  illuminatorName: string;
  locatedNote: string;
  machines: number;
  lengthPerPoint: number;
  sizes: FoSize[];
  endSkuId: string | null;
  harnessSkuId: string | null;
  portSkuId: string | null;
  /** null = no WP box in this job */
  wpSkuId: string | null;
  /** print the WP box line on the quotation */
  showWp: boolean;
};

export type FoRecipeRow = { sku_id: string; qty: number; note: string };

const TAG = "FO ";
export const isFoNote = (note: string | null | undefined) => !!note && note.startsWith(TAG);

const n2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function totalPoints(c: Pick<FoConfig, "sizes">): number {
  return c.sizes.reduce((s, z) => s + (z.points > 0 ? z.points : 0), 0);
}

/** Materials for the whole set (quantities are totals for the line, as line_recipes expects). */
export function buildFoRecipes(c: FoConfig): FoRecipeRow[] {
  const m = Math.max(0, c.machines);
  const rows: FoRecipeRow[] = [];
  if (c.illuminatorSkuId && m > 0) {
    const extra = c.locatedNote.trim() ? ` | ${c.locatedNote.trim()}` : "";
    rows.push({
      sku_id: c.illuminatorSkuId,
      qty: m,
      note: `${TAG}ILLUMINATOR: ${c.illuminatorName.trim()}${extra}`,
    });
  }
  for (const z of c.sizes) {
    if (!z.skuId || !(z.points > 0)) continue;
    rows.push({
      sku_id: z.skuId,
      qty: n2(z.points * c.lengthPerPoint),
      note: `${TAG}SIZE ${z.label.trim()}: ${z.points} จุด x ${c.lengthPerPoint} ม.`,
    });
  }
  const pts = totalPoints(c);
  if (c.endSkuId && pts > 0)
    rows.push({ sku_id: c.endSkuId, qty: pts, note: `${TAG}END FINISHING` });
  if (m > 0) {
    if (c.harnessSkuId) rows.push({ sku_id: c.harnessSkuId, qty: m, note: `${TAG}HARNESS` });
    if (c.portSkuId) rows.push({ sku_id: c.portSkuId, qty: m, note: `${TAG}OPTICAL PORT` });
    if (c.wpSkuId)
      rows.push({
        sku_id: c.wpSkuId,
        qty: m,
        note: `${TAG}WP BOX${c.showWp ? " (แสดงในใบ)" : ""}`,
      });
  }
  return rows.filter((r) => r.qty > 0);
}

/** Description printed for the customer: machine count and points only — no meters, no prices per item. */
export function buildFoText(c: FoConfig): string {
  const m = c.machines;
  const lines = [c.title.trim() || "FIBER OPTICS STARRY SET"];
  if (c.illuminatorName.trim() && m > 0) {
    const loc = c.locatedNote.trim() ? ` ${c.locatedNote.trim()}` : "";
    lines.push(`- ILLUMINATOR ${c.illuminatorName.trim()} x ${m}${loc}`);
  }
  const used = c.sizes.filter((z) => z.points > 0);
  if (used.length) {
    lines.push(
      used.length > 1
        ? `- FIBER OPTICS CABLES WITH ${used.length} MIXED DIAMETER`
        : "- FIBER OPTICS CABLES",
    );
    for (const z of used) lines.push(`  + SIZE ${z.label.trim()} x ${fmt(z.points)} POINTS`);
  }
  const pts = totalPoints(c);
  if (c.endSkuId && pts > 0) lines.push(`- END FINISHING (${fmt(pts)} POINTS)`);
  if (m > 0) {
    if (c.harnessSkuId) lines.push(`- HARNESS x ${m}`);
    if (c.portSkuId) lines.push(`- OPTICAL PORT x ${m}`);
    if (c.wpSkuId && c.showWp) lines.push(`- WP BOX x ${m}`);
  }
  return lines.join("\n");
}

/** Rebuilds the set from its saved line_recipes so it can be edited again; null if the line is not an FO set. */
export function parseFo(
  recipes: { sku_id: string; qty: number | string; note: string | null }[],
  customerText: string | null,
): FoConfig | null {
  const fo = recipes.filter((r) => isFoNote(r.note));
  if (!fo.length) return null;
  const c: FoConfig = {
    title: (customerText ?? "").split("\n")[0]?.trim() || "FIBER OPTICS STARRY SET",
    illuminatorSkuId: "",
    illuminatorName: "",
    locatedNote: "",
    machines: 0,
    lengthPerPoint: 0,
    sizes: [],
    endSkuId: null,
    harnessSkuId: null,
    portSkuId: null,
    wpSkuId: null,
    showWp: false,
  };
  for (const r of fo) {
    const note = r.note!.slice(TAG.length);
    const qty = Number(r.qty);
    let m: RegExpMatchArray | null;
    if ((m = note.match(/^ILLUMINATOR: (.*?)(?: \| (.*))?$/))) {
      c.illuminatorSkuId = r.sku_id;
      c.illuminatorName = m[1] ?? "";
      c.locatedNote = m[2] ?? "";
      c.machines = qty;
    } else if ((m = note.match(/^SIZE (.+?): ([\d.]+) จุด x ([\d.]+) ม\.$/))) {
      c.sizes.push({ label: m[1]!, skuId: r.sku_id, points: Number(m[2]) });
      c.lengthPerPoint = Number(m[3]);
    } else if (note === "END FINISHING") c.endSkuId = r.sku_id;
    else if (note === "HARNESS") c.harnessSkuId = r.sku_id;
    else if (note === "OPTICAL PORT") c.portSkuId = r.sku_id;
    else if (note.startsWith("WP BOX")) {
      c.wpSkuId = r.sku_id;
      c.showWp = note.includes("แสดงในใบ");
    }
  }
  return c;
}

/* ---------------------------------------------------------------- defaults from the SKU list */

type SkuLite = { id: string; code: string; name: string };
const text = (s: SkuLite) => `${s.code} ${s.name}`;
export const wattOf = (s: SkuLite | undefined): number | null => {
  const m = s ? text(s).match(/(\d+(?:\.\d+)?)\s*W\b/i) : null;
  return m ? Number(m[1]) : null;
};
const diameterOf = (s: SkuLite) => {
  const m = text(s).match(/(\d+(?:\.\d+)?)\s*mm/i) ?? s.code.match(/(\d+(?:\.\d+)?)\s*$/);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
};

export function foSkuGroups(skus: SkuLite[]) {
  const has = (re: RegExp) => skus.filter((s) => re.test(text(s)));
  return {
    illuminators: has(/illuminator/i),
    cables: has(/cable/i)
      .filter((s) => /\bfo|fiber|fibre/i.test(text(s)))
      .sort((a, b) => diameterOf(a) - diameterOf(b)),
    ends: has(/end\s*finish/i),
    harnesses: has(/harness/i),
    ports: has(/optical\s*port/i),
    wps: has(/\bwp\b|wp\s*box|waterproof/i),
  };
}

/** Prefer the accessory made for the same wattage as the illuminator (e.g. FOWP50W for FO50W). */
export function matchByWatt(list: SkuLite[], illuminator: SkuLite | undefined): string | null {
  if (!list.length) return null;
  const w = wattOf(illuminator);
  return (w !== null ? list.find((s) => wattOf(s) === w) : undefined)?.id ?? list[0]!.id;
}

export function illuminatorDisplayName(s: SkuLite | undefined): string {
  if (!s) return "";
  const w = wattOf(s);
  return w !== null
    ? `220Vac HALOGEN ${w}W STARRY MONO COLOR`
    : s.name
        .replace(/^FO\s*/i, "")
        .replace(/illuminator\s*/i, "")
        .trim();
}
