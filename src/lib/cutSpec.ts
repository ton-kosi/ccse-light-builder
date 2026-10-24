/**
 * "Length × sets" notation used on CCSE work order sheets, e.g.
 *   L = (0.682M x 2SETS) + ([3.015M + 3.515M] x 2SETS)
 * A run is one piece or several pieces joined in [ ]; "x N" repeats the run N times.
 * Short forms are accepted too: "0.682x2 + [3.015+3.515]x2", "1.5+2.25, 3".
 */

export type CutRun = { pieces: number[]; sets: number };
export type CutSpec = { runs: CutRun[]; pieces: number[]; total: number };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Splits on "+" or "," that are not inside [ ]. */
function splitTop(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "[") depth++;
    if (ch === "]") depth = Math.max(0, depth - 1);
    if ((ch === "+" || ch === ",") && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const num = (s: string) => {
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Parses the notation; returns an error message for anything it cannot read. */
export function parseCutSpec(input: string): CutSpec | { error: string } {
  const text = input
    .replace(/^\s*L\s*=\s*/i, "")
    .replace(/[×*]/g, "x")
    .replace(/(\d)\s*(?:m|ม\.?)(?![a-z])/gi, "$1") // 0.682M → 0.682
    .replace(/\s*(?:sets?|ชุด)\b/gi, "") // 2SETS → 2
    .replace(/\s*(?:sets?|ชุด)/gi, "")
    .trim();
  if (!text) return { error: "ยังไม่ได้ใส่ความยาว" };
  const runs: CutRun[] = [];
  for (let term of splitTop(text)) {
    term = term.trim();
    // drop wrapping ( ) around a whole term: "(0.682 x 2)"
    while (term.startsWith("(") && term.endsWith(")")) term = term.slice(1, -1).trim();
    const m = term.match(/^(\[[^\]]*\]|[\d.,]+)\s*(?:x\s*(\d+))?$/i);
    if (!m) return { error: `อ่านไม่ออก: "${term}" (ตัวอย่าง 0.682x2 + [3.015+3.515]x2)` };
    const body = m[1]!;
    const sets = m[2] ? Number(m[2]) : 1;
    if (!(sets >= 1)) return { error: `จำนวนชุดต้องเป็น 1 ขึ้นไป: "${term}"` };
    const pieces = body.startsWith("[")
      ? body.slice(1, -1).split("+").map((p) => num(p.trim()))
      : [num(body)];
    if (!pieces.length || pieces.some((p) => p === null))
      return { error: `ความยาวต้องเป็นตัวเลขมากกว่า 0: "${term}"` };
    runs.push({ pieces: (pieces as number[]).map(round3), sets });
  }
  const pieces = runs.flatMap((r) => Array.from({ length: r.sets }, () => r.pieces).flat());
  return { runs, pieces, total: round3(pieces.reduce((s, n) => s + n, 0)) };
}

/** Plain piece list → runs, folding repeats next to each other into "x N" (0.682, 0.682 → 0.682x2). */
export function runsFromPieces(pieces: number[]): CutRun[] {
  const runs: CutRun[] = [];
  for (const raw of pieces) {
    const p = round3(Number(raw));
    const last = runs[runs.length - 1];
    if (last && last.pieces.length === 1 && last.pieces[0] === p) last.sets++;
    else runs.push({ pieces: [p], sets: 1 });
  }
  return runs;
}

const fmt = (n: number) => String(round3(n));

/** Canonical short text, e.g. "0.682x2 + [3.015+3.515]x2". */
export function formatCutSpec(runs: CutRun[]): string {
  return runs
    .map((r) => {
      const body = r.pieces.length > 1 ? `[${r.pieces.map(fmt).join("+")}]` : fmt(r.pieces[0]!);
      return r.sets > 1 ? `${body}x${r.sets}` : body;
    })
    .join(" + ");
}

/** WOS style for print, e.g. "(0.682M x 2SETS) + ([3.015M + 3.515M] x 2SETS)". */
export function formatCutSpecWos(runs: CutRun[]): string {
  return runs
    .map((r) => {
      const body = r.pieces.length > 1 ? `[${r.pieces.map((p) => fmt(p) + "M").join(" + ")}]` : `${fmt(r.pieces[0]!)}M`;
      return `(${body} x ${r.sets}${r.sets > 1 ? "SETS" : "SET"})`;
    })
    .join(" + ");
}
