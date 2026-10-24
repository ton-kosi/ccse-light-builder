/**
 * ใบเบิกของ / ใบคืนของ summary per SKU, laid out like the CCSE workbook:
 * ใบงาน (WOS need) · หน้างาน (actual, e.g. LED from the production sheet) · เบิกครั้งที่ 1…n ·
 * เบิกรวม · คืน · ใช้จริง. Round 1 is the first "ยืนยันเบิกของ"; later rounds and returns are
 * material moves. Pure function, unit tested.
 */

export type SkuInfo = { id: string; code: string; name: string; unit: string };
export type Move = { kind: "issue" | "return"; round_no: number | null; sku_id: string; qty: number };

export type MaterialRow = {
  sku: SkuInfo;
  wos: number;
  site: number | null;
  rounds: number[];
  issued: number;
  returned: number;
  used: number;
  /** issued − returned − need: + = more out than the WOS asked for */
  overWos: number;
};

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function materialSummary(input: {
  skus: Map<string, SkuInfo>;
  demand: { sku_id: string; qty: number }[];
  firstIssue: { sku_id: string; qty: number }[];
  moves: Move[];
  site?: Map<string, number>;
}): { rows: MaterialRow[]; roundCount: number } {
  const roundCount = Math.max(
    input.firstIssue.length ? 1 : 0,
    ...input.moves.filter((m) => m.kind === "issue").map((m) => m.round_no ?? 1),
  );
  const ids = new Set<string>([
    ...input.demand.map((d) => d.sku_id),
    ...input.firstIssue.map((d) => d.sku_id),
    ...input.moves.map((m) => m.sku_id),
  ]);
  const rows: MaterialRow[] = [];
  for (const id of ids) {
    const sku = input.skus.get(id) ?? { id, code: "?", name: "(ไม่พบ SKU)", unit: "" };
    const wos = r3(input.demand.filter((d) => d.sku_id === id).reduce((s, d) => s + Number(d.qty), 0));
    const rounds = Array.from({ length: roundCount }, () => 0);
    for (const f of input.firstIssue) if (f.sku_id === id) rounds[0]! += Number(f.qty);
    for (const m of input.moves)
      if (m.sku_id === id && m.kind === "issue" && m.round_no) rounds[m.round_no - 1]! += Number(m.qty);
    const issued = r3(rounds.reduce((s, n) => s + n, 0));
    const returned = r3(
      input.moves.filter((m) => m.sku_id === id && m.kind === "return").reduce((s, m) => s + Number(m.qty), 0),
    );
    const used = r3(issued - returned);
    rows.push({
      sku,
      wos,
      site: input.site?.get(id) ?? null,
      rounds: rounds.map(r3),
      issued,
      returned,
      used,
      overWos: r3(used - wos),
    });
  }
  rows.sort((a, b) => a.sku.code.localeCompare(b.sku.code));
  return { rows, roundCount };
}

/** Next extra issue round number (round 1 is the first confirm). */
export function nextRound(moves: Move[]): number {
  return Math.max(1, ...moves.filter((m) => m.kind === "issue").map((m) => m.round_no ?? 1)) + 1;
}
