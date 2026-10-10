import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Minimal CSV parser (handles quotes, commas, newlines in quotes, BOM). */
type CsvKey = "code" | "name" | "unit" | "source" | "lead_time_days" | "min_stock" | "is_roll" | "roll_length_m" | "roll_family" | "cut_step_cm" | "max_piece_m" | "install_category" | "is_roll_product" | "component_code" | "sku_code" | "qty_per_unit" | "category" | "notes";
export type CsvRow = Partial<Record<CsvKey, string>>;

export function parseCsv(text: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const t = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((x) => x.trim() !== ""));
  if (!nonEmpty.length) return [];
  const header = (nonEmpty[0] ?? []).map((h) => h.trim().toLowerCase());
  return nonEmpty.slice(1).map((r) =>
    Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])) as CsvRow,
  );
}

export function CsvImport({
  label,
  columns,
  onRows,
}: {
  label: string;
  columns: string;
  onRows: (rows: CsvRow[]) => Promise<number>;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          try {
            const rows = parseCsv(await f.text());
            if (!rows.length) { toast.error("ไฟล์ไม่มีข้อมูล"); return; }
            const n = await onRows(rows);
            toast.success(`นำเข้าแล้ว ${n} แถว`);
          } catch (err) {
            toast.error((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        title={`คอลัมน์: ${columns}`}
        onClick={() => ref.current?.click()}
      >
        <Upload className="h-4 w-4" />
        {busy ? "กำลังนำเข้า..." : label}
      </Button>
    </>
  );
}

export const boolCsv = (v: string | undefined) =>
  ["1", "true", "yes", "y", "ใช่"].includes((v ?? "").toLowerCase());
export const numCsv = (v: string | undefined) => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v.replace(/,/g, ""));
  if (Number.isNaN(n)) throw new Error(`ค่าไม่ใช่ตัวเลข: ${v}`);
  return n;
};
