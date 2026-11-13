import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePasswordConfirm } from "@/components/ConfirmPasswordDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { numbersNotReady } from "@/lib/docNumbers";

type Counter = { kind: string; company_id: string; year: number; last_no: number };
// not in the generated types until Lovable applies migration 0034_doc_numbers
const counters = () => (supabase as unknown as { from: (t: string) => ReturnType<typeof supabase.from> }).from("doc_counters") as unknown as {
  select: (c: string) => { eq: (k: string, v: number) => PromiseLike<{ data: Counter[] | null; error: { message: string } | null }> };
  upsert: (rows: Counter[]) => PromiseLike<{ error: { message: string } | null }>;
};

// QC / QO count restarts every day by itself; only the P/J count runs through the year
const SLOTS = [
  { kind: "job", company_id: "-", label: "เลขงาน P/J" },
  { kind: "po", company_id: "ccse", label: "ใบสั่งซื้อ CCSE (26-…)" },
  { kind: "po", company_id: "one", label: "ใบสั่งซื้อ ONE (69-…)" },
];

/** The last P/J number used this year, so the automatic count carries on from the paper files. */
export function NumberingEditor() {
  const qc = useQueryClient();
  const { askPassword, passwordDialog } = usePasswordConfirm();
  const year = new Date().getFullYear();
  const { data, error } = useQuery({
    queryKey: ["doc_counters", year],
    retry: false,
    queryFn: async () => {
      const { data, error } = await counters().select("kind, company_id, year, last_no").eq("year", year);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  const [form, setForm] = useState<Record<string, string>>({});
  const key = (s: { kind: string; company_id: string }) => `${s.kind}:${s.company_id}`;
  useEffect(() => {
    if (!data) return;
    setForm(Object.fromEntries(SLOTS.map((s) => [key(s), String(data.find((c) => key(c) === key(s))?.last_no ?? 0)])));
  }, [data]);

  async function save() {
    const all = SLOTS.map((s) => ({ kind: s.kind, company_id: s.company_id, year, last_no: Number(form[key(s)]) }));
    if (all.some((r) => !Number.isInteger(r.last_no) || r.last_no < 0)) {
      toast.error("กรุณากรอกเลขจำนวนเต็ม");
      return;
    }
    // only what changed (PO counters need migration 0039 before they can be saved)
    const was = (r: { kind: string; company_id: string }) => data?.find((c) => c.kind === r.kind && c.company_id === r.company_id)?.last_no ?? 0;
    const rows = all.filter((r) => r.last_no !== was(r));
    if (!rows.length) {
      toast.success("ไม่มีอะไรเปลี่ยน");
      return;
    }
    if (!(await askPassword({ title: "ตั้งเลขล่าสุดที่ใช้" }))) return;
    const { error: e } = await counters().upsert(rows);
    if (e) {
      toast.error(e.message);
      return;
    }
    toast.success("บันทึกแล้ว");
    qc.invalidateQueries({ queryKey: ["doc_counters"] });
  }

  return (
    <div className="mt-4 max-w-md rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">เลขเอกสารอัตโนมัติ ปี {year}</h2>
      {error && numbersNotReady((error as Error).message) ? (
        <p className="mt-2 text-xs text-muted-foreground">ยังใช้ไม่ได้ — ให้ Lovable รันไฟล์ docs/sql/doc_numbers.sql ก่อน</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted-foreground">เลขล่าสุดที่ใช้ไปแล้ว ระบบจะออกเลขถัดจากนี้ · ใบเสนอราคา QC / QO เริ่ม 001 ใหม่ทุกวัน</p>
          <div className="mt-3 space-y-2">
            {SLOTS.map((s) => (
              <div key={key(s)} className="grid grid-cols-[1fr_6rem] items-center gap-2">
                <Label htmlFor={key(s)}>{s.label}</Label>
                <Input id={key(s)} inputMode="numeric" value={form[key(s)] ?? ""} onChange={(e) => setForm({ ...form, [key(s)]: e.target.value })} />
              </div>
            ))}
          </div>
          <Button className="mt-3" size="sm" onClick={save}>
            บันทึก
          </Button>
        </>
      )}
      {passwordDialog}
    </div>
  );
}
