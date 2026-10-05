import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { Field, Td, Th } from "@/routes/_authenticated/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatQty, formatTHB, toNumber } from "@/lib/format";

export const PAY_TRIGGERS: { value: string; label: string }[] = [
  { value: "deposit", label: "มัดจำ (ขั้น 4)" },
  { value: "before_delivery", label: "ก่อนส่งของ (ขั้น 7)" },
  { value: "material_on_site", label: "ของถึงหน้างาน (ขั้น 8)" },
  { value: "after_delivery", label: "หลังส่งของ (ขั้น 8)" },
  { value: "substantial_completion", label: "งานแล้วเสร็จ (ขั้น 9)" },
  { value: "progress", label: "ตามความคืบหน้า (เช็คเอง)" },
];

export const DUE_LABELS: Record<string, { label: string; cls: string }> = {
  received: { label: "รับแล้ว", cls: "bg-success/15 text-success" },
  due: { label: "ถึงเวลาเบิก", cls: "bg-destructive/15 text-destructive" },
  check_progress: { label: "เช็ค progress", cls: "bg-warning/20 text-warning-foreground" },
  not_yet: { label: "ยังไม่ถึง", cls: "bg-muted text-muted-foreground" },
};

export function DueBadge({ s }: { s: string }) {
  const d = DUE_LABELS[s] ?? DUE_LABELS.not_yet;
  return <span className={"rounded px-2 py-0.5 text-xs font-medium " + d.cls}>{d.label}</span>;
}

export function PaymentTermsSection({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", percent: "", fixed: "", trigger: "deposit" });

  const { data: quote } = useQuery({
    queryKey: ["payment_quote", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("payment_quote", { _project_id: projectId });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
  const { data: terms } = useQuery({
    queryKey: ["payment_schedule", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("payment_schedule", { _project_id: projectId });
      if (error) throw error;
      return data ?? [];
    },
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["payment_schedule"] });
  };
  const onError = (e: Error) => toast.error(e.message);

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("payment_terms").insert({
        quotation_id: quote!.quotation_id,
        seq: Math.max(0, ...(terms ?? []).map((t) => t.seq)) + 1,
        name: form.name.trim(),
        percent: toNumber(form.percent) ?? 0,
        fixed_amount: toNumber(form.fixed),
        trigger: form.trigger,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setForm({ name: "", percent: "", fixed: "", trigger: "deposit" });
      refresh();
    },
    onError,
  });
  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: TablesUpdate<"payment_terms"> }) => {
      const { error } = await supabase.from("payment_terms").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("payment_terms").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError,
  });

  if (!quote)
    return (
      <section className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
        ยังไม่มีใบเสนอราคาปัจจุบัน — ต้องสร้างใบเสนอราคาในแท็บ BOQ ก่อน
      </section>
    );

  const net = Number(quote.net_total ?? 0);
  const list = terms ?? [];
  const totalPct = list.reduce((s, t) => s + Number(t.percent), 0);
  const totalAmt = list.reduce((s, t) => s + Number(t.amount ?? 0), 0);
  const pctWrong = list.length > 0 && Math.abs(totalPct - 100) > 0.001;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">
        งวดเงิน — {quote.ref_no} Rev {quote.rev}
      </h2>
      <p className="text-xs text-muted-foreground">ยอดสุทธิใบเสนอราคาปัจจุบัน {formatTHB(net)} บาท</p>
      {pctWrong ? (
        <p className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          ผลรวม % ของงวดเงินเท่ากับ {formatQty(totalPct)}% — ควรเท่ากับ 100%
        </p>
      ) : null}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <Th>งวด</Th><Th>ชื่องวด</Th><Th>%</Th><Th>จำนวนเงินคงที่</Th><Th>เงื่อนไขเบิก</Th>
              <Th>จำนวนเงิน (บาท)</Th><Th>สถานะ</Th><Th>รับเงินแล้ว</Th><Th>วันที่รับ</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <Td>{t.seq}</Td>
                <Td>
                  <Input className="h-8" defaultValue={t.name} onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v && v !== t.name) update.mutate({ id: t.id, patch: { name: v } });
                  }} />
                </Td>
                <Td>
                  <Input className="h-8 w-20" defaultValue={String(t.percent)} onBlur={(e) => {
                    const n = toNumber(e.target.value) ?? 0;
                    if (n !== Number(t.percent)) update.mutate({ id: t.id, patch: { percent: n } });
                  }} />
                </Td>
                <Td>
                  <Input className="h-8 w-28" placeholder="ใช้ %" defaultValue={t.fixed_amount === null ? "" : String(t.fixed_amount)} onBlur={(e) => {
                    const n = toNumber(e.target.value);
                    if (n !== (t.fixed_amount === null ? null : Number(t.fixed_amount)))
                      update.mutate({ id: t.id, patch: { fixed_amount: n } });
                  }} />
                </Td>
                <Td>
                  <select className="h-8 rounded-md border border-input bg-background px-2 text-sm" value={t.trigger ?? ""}
                    onChange={(e) => update.mutate({ id: t.id, patch: { trigger: e.target.value || null } })}>
                    <option value="">— ไม่ระบุ —</option>
                    {PAY_TRIGGERS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                  </select>
                </Td>
                <Td className="tabular-nums">{formatTHB(Number(t.amount ?? 0))}</Td>
                <Td><DueBadge s={t.due_status} /></Td>
                <Td>
                  <input type="checkbox" className="h-4 w-4" checked={t.received} onChange={(e) =>
                    update.mutate({ id: t.id, patch: {
                      received: e.target.checked,
                      received_date: e.target.checked ? (t.received_date ?? new Date().toISOString().slice(0, 10)) : null,
                    } })} />
                </Td>
                <Td>
                  <Input type="date" className="h-8" disabled={!t.received} defaultValue={t.received_date ?? ""}
                    key={t.received_date ?? "none"} onBlur={(e) => {
                      if ((e.target.value || null) !== t.received_date)
                        update.mutate({ id: t.id, patch: { received_date: e.target.value || null } });
                    }} />
                </Td>
                <Td><Button size="sm" variant="outline" onClick={() => remove.mutate(t.id)}>ลบ</Button></Td>
              </tr>
            ))}
            <tr className="border-t border-border font-semibold">
              <Td colSpan={2}>รวม</Td>
              <Td className={pctWrong ? "text-destructive" : ""}>{formatQty(totalPct)}%</Td>
              <Td colSpan={2}></Td>
              <Td className="tabular-nums">{formatTHB(totalAmt)}</Td>
              <Td colSpan={4}></Td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        จำนวนเงิน = จำนวนเงินคงที่ (ถ้ากรอก) มิฉะนั้น = % × ยอดสุทธิ · "ถึงเวลาเบิก" เมื่อสถานะโปรเจกต์ถึงขั้นของเงื่อนไข
      </p>
      <form className="mt-4 grid gap-3 border-t border-border pt-4 md:grid-cols-6" onSubmit={(e) => {
        e.preventDefault();
        if (!form.name.trim()) { toast.error("กรุณากรอกชื่องวด"); return; }
        add.mutate();
      }}>
        <Field label="ชื่องวด *" className="md:col-span-2">
          <Input value={form.name} placeholder="เช่น มัดจำ" onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="%">
          <Input value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} />
        </Field>
        <Field label="จำนวนเงินคงที่ (ถ้ามี)">
          <Input value={form.fixed} onChange={(e) => setForm({ ...form, fixed: e.target.value })} />
        </Field>
        <Field label="เงื่อนไขเบิก">
          <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={form.trigger}
            onChange={(e) => setForm({ ...form, trigger: e.target.value })}>
            {PAY_TRIGGERS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
        </Field>
        <div className="flex items-end">
          <Button size="sm" type="submit" disabled={add.isPending}>เพิ่มงวด</Button>
        </div>
      </form>
    </section>
  );
}
