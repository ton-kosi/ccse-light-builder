/**
 * Work order sheet (WOS): builder lines sold as one SET / per metre are printed with their real
 * materials and quantities (from line_recipes), so workers, production and stock see what to make
 * and issue. The customer's quotation is not affected. No prices here.
 */
import { CANOE_SIZES, isCanoeNote, parseCanoe, type CanoeConfig } from "./canoe";
import { isClpNote, lightFor, parseClipso, type ClipsoConfig } from "./clipso";

export type WosRecipe = { sku_id: string; qty: number | string; note: string | null };
export type WosSku = { id: string; code: string; name: string; unit: string | null };
export type WosPart = { text: string; qty: number | null; unit: string | null; remark: string | null };

/** Role of a material in its builder block: "CLP ab12 TRACK {…}" → "TRACK". */
export function roleOf(note: string | null): string {
  const n = (note ?? "").replace(/ \{.*$/s, "");
  if (n.startsWith("FO ")) return n.slice(3).split(":")[0]!.trim();
  return n.split(" ").slice(2).join(" ");
}

/** Saved block settings by block id, so lines without the settings can still find them. */
export function blockConfigs(recipes: WosRecipe[]) {
  const clipso = new Map<string, ClipsoConfig>();
  const canoe = new Map<string, CanoeConfig>();
  for (const r of recipes) {
    const id = (r.note ?? "").split(" ")[1] ?? "";
    if (isClpNote(r.note)) {
      const c = parseClipso(r.note);
      if (c) clipso.set(id, c);
    } else if (isCanoeNote(r.note)) {
      const c = parseCanoe(r.note);
      if (c) canoe.set(id, c);
    }
  }
  return { clipso, canoe };
}

const fmtPoints = (n: string) => Number(n).toLocaleString("en-US");

/**
 * The rows printed for one BOQ line. `parts` empty = print the line as it is.
 * `lineQty` false = the line's own qty (1 SET, 11 SET) means nothing on site: only the parts show one.
 */
export function explodeLine(
  text: string,
  recipes: WosRecipe[],
  skuOf: (id: string) => WosSku | undefined,
  configs: ReturnType<typeof blockConfigs>,
): { intro: string; lineQty: boolean; parts: WosPart[]; remark: string | null } {
  const plain = { intro: text, lineQty: true, parts: [] as WosPart[], remark: null as string | null };
  if (!recipes.length) return plain;
  const of = (role: string) => recipes.filter((r) => roleOf(r.note) === role);
  const named = (r: WosRecipe) => skuOf(r.sku_id)?.name ?? "";
  const qty = (r: WosRecipe | undefined) => (r ? Number(r.qty) : null);
  const unit = (r: WosRecipe | undefined) => (r ? (skuOf(r.sku_id)?.unit ?? null) : null);
  const lines = text.split("\n");
  const note = recipes[0]!.note ?? "";

  // ---- Fiber optic: one SET line
  if (note.startsWith("FO ")) {
    const parts: WosPart[] = [];
    const intro: string[] = [];
    for (const line of lines) {
      const t = line.trim();
      const one = (role: string, u: string | null = null) => {
        const r = of(role)[0];
        parts.push({ text: line, qty: qty(r), unit: u ?? unit(r), remark: r ? skuOf(r.sku_id)?.code ?? null : null });
      };
      const size = t.match(/^\+ SIZE (.+?) x ([\d,]+) POINTS/);
      if (size) {
        const r = of(`SIZE ${size[1]}`)[0];
        parts.push({ text: `  + SIZE ${size[1]} x ${fmtPoints(size[2]!.replace(/,/g, ""))} POINTS`, qty: qty(r), unit: unit(r), remark: r ? skuOf(r.sku_id)?.code ?? null : null });
      } else if (/^- ILLUMINATOR/.test(t)) one("ILLUMINATOR");
      else if (/^- END FINISHING/.test(t)) one("END FINISHING");
      else if (/^- HARNESS/.test(t)) one("HARNESS");
      else if (/^- OPTICAL PORT/.test(t)) one("OPTICAL PORT");
      else if (/^- WP BOX/.test(t)) one("WP BOX (แสดงในใบ)");
      else if (parts.length) parts.push({ text: line, qty: null, unit: null, remark: null });
      else intro.push(line);
    }
    return { intro: intro.join("\n"), lineQty: false, parts, remark: null };
  }

  // ---- Clipso: fabric line and lighting line
  if (isClpNote(note)) {
    const id = note.split(" ")[1] ?? "";
    const cfg = configs.clipso.get(id);
    const single = lines.length === 1;
    if (single) {
      const r = recipes[0];
      return { ...plain, remark: r ? skuOf(r.sku_id)?.code ?? null : null };
    }
    const parts: WosPart[] = [];
    const intro: string[] = [];
    for (const line of lines) {
      const t = line.trim();
      if (/^- CALCULATION SIZE/.test(t)) {
        // stock cuts metres from a roll of this width; sq.m is only for the price
        const r = of("FABRIC")[0];
        const width = r ? cfg?.fabrics?.find((f) => f.skuId === r.sku_id)?.width : null;
        const code = r ? skuOf(r.sku_id)?.code ?? "" : "";
        parts.push({ text: line, qty: qty(r), unit: "M.", remark: [width ? `ตัดจากม้วน ${width.toFixed(2)}M` : "", code].filter(Boolean).join(" · ") || null });
      } else if (/^- CEILING PROFILE/.test(t)) {
        const r = of("TRACK")[0];
        const len = cfg?.trackLength || 2;
        parts.push({ text: line, qty: r ? Number(r.qty) * len : null, unit: "M.", remark: r ? `${r.qty} เส้น · ${skuOf(r.sku_id)?.code ?? ""}` : null });
      } else if (/^- LED (MODULE|STRIP)/.test(t)) {
        const r = of("LED")[0];
        const grid =
          cfg?.light && cfg.panels.length
            ? cfg.panels
                .filter((p) => p.w > 0 && (p.shape === "circle" || p.l > 0) && p.qty > 0)
                .map((p) => `${lightFor(p, cfg.light!).text}${p.qty > 1 ? ` x ${p.qty} ช่อง` : ""}`)
                .join(", ")
            : null;
        parts.push({ text: r ? `- ${named(r)}` : line, qty: qty(r), unit: unit(r), remark: grid });
      } else if (/^- POWER SUPPLY/.test(t)) {
        const psus = of("PSU");
        if (!psus.length) parts.push({ text: line, qty: null, unit: null, remark: null });
        for (const r of psus) parts.push({ text: line, qty: qty(r), unit: unit(r), remark: named(r) });
      } else if (/^- MISCELLANEOUS/.test(t)) {
        const r = of("MISC")[0];
        parts.push({ text: line, qty: qty(r) ?? 1, unit: unit(r) ?? "LOT", remark: r ? named(r) : null });
      } else if (/ x \d+(\.\d+)?$/.test(t)) {
        const m = t.match(/^(.*) x (\d+(?:\.\d+)?)$/)!;
        parts.push({ text: m[1]!, qty: Number(m[2]), unit: null, remark: null });
      } else if (parts.length) parts.push({ text: line, qty: null, unit: null, remark: null });
      else intro.push(line);
    }
    return { intro: intro.join("\n"), lineQty: false, parts, remark: null };
  }

  // ---- Canoe: per-metre line (retrofit lines are already separate)
  if (isCanoeNote(note)) {
    const cfg = configs.canoe.get(note.split(" ")[1] ?? "");
    if (cfg?.housingType === "retrofit") {
      const r = of("LED")[0] ?? of("KIT")[0];
      return { ...plain, remark: r ? named(r) : null };
    }
    const parts: WosPart[] = [];
    const add = (r: WosRecipe | undefined, label: string, remark?: string | null) => {
      if (r) parts.push({ text: `- ${label}`, qty: qty(r), unit: unit(r), remark: remark ?? skuOf(r.sku_id)?.code ?? null });
    };
    add(of("LED")[0], named(of("LED")[0] ?? recipes[0]!));
    add(of("RAIL")[0], "ALUMINIUM HEAT DISSIPATION (ราง 4/8 ในตัว Canoe)");
    add(of("JACKET")[0], "JACKET");
    for (const k of CANOE_SIZES) add(of(`HOUSING ${k}`)[0], `ท่อน Canoe ${k}`);
    add(of("KIT")[0], "ENGRAVED ACRYLIC w/ IP68 CABLE");
    add(of("SS HOUSING")[0], "SS PROFILE (เชื่อมหน้างาน)");
    add(of("COVER")[0], "ACRYLIC DIFFUSER");
    for (const r of of("PSU")) add(r, "SWITCHING POWER SUPPLY 24V", named(r));
    add(of("WP BOX")[0], "กล่องกันน้ำ");
    return { intro: lines[0]!, lineQty: true, parts, remark: null };
  }

  // ---- LED linear and the rest: already line by line, show the real model
  const led = of("LED")[0];
  const psu = of("PSU")[0] ?? of("DIMMER")[0];
  const r = led ?? psu;
  return { ...plain, remark: r ? named(r) : null };
}

/* ---------------------------------------------------------------- measured Clipso openings */

const OPEN_TAG = "OPEN ";
const OPENING_LINE = /^(\s*-?\s*(?:OPENING )?SIZE\s*:\s*)(.+)$/;

/** The opening sizes printed in a Clipso fabric line, one per line of the text. */
export const openingLines = (text: string) =>
  text.split("\n").flatMap((l) => {
    const m = l.match(OPENING_LINE);
    return m ? [m[2]!.trim()] : [];
  });

const size = (n: string) => `${Number(n).toFixed(2)}M`;

/** "1.88x1.85x3" → "1.88M x 1.85M x 3PCS."; "2.16" (circle) → "DIA : 2.16M". */
export function formatOpeningInput(input: string): string | { error: string } {
  const t = input.trim().toLowerCase().replace(/[×*]/g, "x").replace(/\s+/g, "");
  const m = t.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?:x(\d+))?$/);
  if (m) {
    const pcs = m[3] ? Number(m[3]) : 1;
    return `${size(m[1]!)} x ${size(m[2]!)}${pcs > 1 ? ` x ${pcs}PCS.` : ""}`;
  }
  const dia = t.match(/^(?:dia:?)?(\d+(?:\.\d+)?)$/);
  if (dia) return `DIA : ${size(dia[1]!)}`;
  return { error: `อ่านขนาดไม่ออก: "${input.trim()}" (ตัวอย่าง 1.96x1.60 หรือ 1.88x1.85x3)` };
}

/** Back to what is typed in the box: "1.88M x 1.85M x 3PCS." → "1.88x1.85x3". */
export const openingInputOf = (saved: string) => saved.replace(/DIA : /, "").replace(/PCS\./, "").replace(/M/g, "").replace(/\s+/g, "");

/** Saved in site_measurements.cut_spec; the "OPEN" tag keeps it apart from cut lengths. An empty slot = unchanged. */
export const encodeOpenings = (sizes: string[]) => `${OPEN_TAG}${sizes.join("; ")}`;
export const decodeOpenings = (spec: string | null | undefined): string[] | null =>
  spec?.startsWith(OPEN_TAG) ? spec.slice(OPEN_TAG.length).split(";").map((s) => s.trim()) : null;

/** The line's text, with the measured size next to the contract size it replaces. */
export function markOpenings(text: string, spec: string | null | undefined) {
  const sizes = decodeOpenings(spec);
  let i = 0;
  return text.split("\n").map((line) => {
    const m = line.match(OPENING_LINE);
    if (!m) return { text: line, old: null as string | null, next: null as string | null };
    const next = sizes?.[i++] || null;
    return next ? { text: m[1]!, old: m[2]!.trim(), next } : { text: line, old: null, next: null };
  });
}

/** Internal notes go in the remark column of the line above; with nothing above, they stay a row of their own. */
export function attachNotes<T extends { id: string; kind: string; heading_text?: string | null; component_name?: string | null }>(
  lines: T[],
): { rows: T[]; notes: Map<string, string[]> } {
  const notes = new Map<string, string[]>();
  const rows: T[] = [];
  for (const l of lines) {
    const prev = rows[rows.length - 1];
    if (l.kind === "internal" && prev && prev.kind !== "internal") {
      notes.set(prev.id, [...(notes.get(prev.id) ?? []), l.component_name ?? l.heading_text ?? ""]);
    } else rows.push(l);
  }
  return { rows, notes };
}
