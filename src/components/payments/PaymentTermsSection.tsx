import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { Field, Td, Th } from "@/routes/_authenticated/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMe } from "@/hooks/useMe";
import { usePasswordConfirm } from "@/components/ConfirmPasswordDialog";
import { formatDate, formatQty, formatTHB, toNumber } from "@/lib/format";
import { methodLabel, PAY_METHODS } from "@/lib/payments";
import { BillingPreviewDialog, IssueBillingDialog } from "@/components/payments/BillingDialogs";

export const PAY_TRIGGERS: { value: string; label: string }[] = [
  { value: "deposit", label: "มัดจำ (ขั้น 4)" },
  { value: "before_delivery", label: "ก่อนส่งของ (ขั้น 7)" },
  { value: "material_on_site", label: "ของถึงหน้างาน (ขั้น 8)" },
  { value: "after_delivery", label: "หลังส่งของ (ขั้น 8)" },
  { value: "substantial_completion", label: "งานแล้วเสร็จ (ขั้น 9)" },
  { value: "progress", label: "ตามความคืบหน้า (เช็คเอง)" },
];

export const DUE_LABELS: Record<string, { label: string; cls: string }> = {
  paid: { label: "รับครบ", cls: "bg-success/15 text-success" },
  overdue: { label: "เกินกำหนด", cls: "bg-destructive/15 text-destructive" },
  partial: { label: "รับบางส่วน", cls: "bg-warning/20 text-warning" },
  billed: { label: "วางบิลแล้ว", cls: "bg-primary/10 text-primary" },
  to_bill: { label: "ถึงเวลาวางบิล", cls: "bg-warning/20 text-warning" },
  check_progress: { label: "เช็ค progress", cls: "bg-warning/20 text-warning" },
  not_yet: { label: "ยังไม่ถึง", cls: "bg-muted text-muted-foreground" },
};

export function DueBadge({ s, days }: { s: string; days?: number | null }) {
  const d = DUE_LABELS[s] ?? { label: "ยังไม่ถึง", cls: "bg-muted text-muted-foreground" };
  return (
    <span className={"whitespace-nowrap rounded px-2 py-0.5 text-xs font-medium " + d.cls}>
      {d.label}
      {s === "overdue" && days ? ` ${days} วัน` : ""}
    </span>
  );
}

const ACTION_LABELS: Record<string, string> = {
  bill: "ออกใบเบิกเงิน", bill_edit: "แก้ไขใบวางบิล", bill_cancel: "ยกเลิกใบเบิกเงิน", receive: "บันทึกรับเงิน", void: "ลบรายการรับเงิน", receipt_edit: "แก้ไขรับเงิน",
};

type Term = {
  id: string; seq: number; name: string; amount: number | null; outstanding: number | null;
  bill_id: string | null; bill_no: string | null; bill_date: string | null; credit_days: number | null; due_date: string | null;
};

export async function openSlip(path: string) {
  const { data, error } = await supabase.storage.from("payment-slips").createSignedUrl(path, 300);
  if (error) { toast.error(error.message); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}

export function PaymentTermsSection({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { isAdmin, canManagePayments } = useMe();
  const { askPassword, passwordDialog } = usePasswordConfirm();
  /** sale team: sees whether the customer has paid, cannot bill or record money */
  const readOnly = !canManagePayments;
  const [billFor, setBillFor] = useState<Term | null>(null);
  const [viewDoc, setViewDoc] = useState<string | null>(null);
  const [payFor, setPayFor] = useState<Term | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

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
  const termIds = (terms ?? []).map((t) => t.id);
  const { data: receipts } = useQuery({
    queryKey: ["payment_receipts", projectId, termIds.join(",")],
    enabled: termIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("payment_receipts").select("*").in("term_id", termIds).order("received_date");
      if (error) throw error;
      return data;
    },
  });
  const { data: logs } = useQuery({
    queryKey: ["payment_audit_log", projectId, termIds.join(",")],
    enabled: termIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("payment_audit_log").select("*").in("term_id", termIds).order("changed_at", { ascending: false });
      if (error) throw error;
      const ids = [...new Set(data.map((l) => l.changed_by).filter(Boolean))] as string[];
      const { data: profs } = ids.length ? await supabase.rpc("user_display_names", { _ids: ids }) : { data: [] };
      const names = new Map((profs ?? []).map((p) => [p.id, p.display_name]));
      return data.map((l) => ({ ...l, who: (l.changed_by && names.get(l.changed_by)) || "-" }));
    },
  });

  const setStatus = useMutation({
    mutationFn: async (status: number) => {
      const { error } = await supabase.rpc("finance_set_project_status", { _project_id: projectId, _status: status });
      if (error) throw error;
    },
    onSuccess: (_d, status) => {
      toast.success(status === 11 ? "ปิดงานแล้ว" : "เปลี่ยนเป็นขั้น 10 วางบิลแล้ว");
      refresh();
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["status_log", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["payment_schedule"] });
    qc.invalidateQueries({ queryKey: ["payment_receipts"] });
    qc.invalidateQueries({ queryKey: ["payment_audit_log"] });
  };
  const onError = (e: Error) => toast.error(e.message);

  const voidReceipt = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("void_receipt", { _id: id, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("ลบรายการรับเงินแล้ว"); refresh(); },
    onError,
  });
  const cancelDoc = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("cancel_billing_doc", { _id: id, _reason: reason });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("ยกเลิกใบเบิกเงินแล้ว"); refresh(); },
    onError,
  });
  const afterReceipt = async (termId: string) => {
    refresh();
    qc.invalidateQueries({ queryKey: ["project", projectId] });
    qc.invalidateQueries({ queryKey: ["status_log", projectId] });
    const { data } = await supabase.rpc("payment_schedule", { _project_id: projectId });
    const rows = data ?? [];
    const t = rows.find((r) => r.id === termId);
    if (t?.trigger !== "deposit") return;
    const deps = rows.filter((r) => r.trigger === "deposit");
    if (!deps.every((r) => r.due_status === "paid")) return;
    if ((t.project_status ?? 0) >= 6) toast.success("รับมัดจำครบ — โปรเจกต์อยู่ขั้น 6 ปล่อยใบ Work ได้แล้ว");
    else toast.warning("รับมัดจำครบแล้ว แต่ระบบยังเปลี่ยนเป็นขั้น 6 ไม่ได้ — ตรวจว่าเลือก Option ที่ลูกค้าเลือกแล้วในแท็บภาพรวม");
  };

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
  const totalRec = list.reduce((s, t) => s + Number(t.received_total ?? 0) + Number(t.wht_total ?? 0), 0);
  const totalOut = list.reduce((s, t) => s + Number(t.outstanding ?? 0), 0);
  const pctWrong = list.length > 0 && Math.abs(totalPct - 100) > 0.001;
  // payment team moves a handed-over project to 10 วางบิล, and closes it (11) once nothing is owed
  const projectStatus = list[0]?.project_status ?? 0;
  const canBillStep = !readOnly && projectStatus === 9;
  const canClose = !readOnly && (projectStatus === 9 || projectStatus === 10) && totalOut <= 0.005;

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      {passwordDialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">งวดเงิน — {quote.ref_no} Rev {quote.rev}</h2>
        <div className="flex gap-2">
          {canBillStep ? (
            <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate(10)}>
              เปลี่ยนเป็นขั้น 10 วางบิล
            </Button>
          ) : null}
          {canClose ? (
            <Button
              size="sm"
              disabled={setStatus.isPending}
              onClick={() => {
                if (window.confirm("รับเงินครบทุกงวดแล้ว — ปิดงาน (ขั้น 11)?")) setStatus.mutate(11);
              }}
            >
              ปิดงาน (ขั้น 11)
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-6 text-sm">
        <span className="text-muted-foreground">ยอดสุทธิใบเสนอราคา {formatTHB(net)} บาท</span>
        <span>รับแล้ว (รวมภาษีหัก) {formatTHB(totalRec)} บาท</span>
        <span className="font-semibold">ค้างรับทั้งโปรเจกต์ {formatTHB(totalOut)} บาท</span>
      </div>
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
              <Th>จำนวนเงิน (บาท)</Th><Th>ใบวางบิล / ครบกำหนด</Th><Th>รับแล้ว</Th><Th>คงค้าง</Th><Th>สถานะ</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => {
              const rs = (receipts ?? []).filter((r) => r.term_id === t.id);
              const ls = (logs ?? []).filter((l) => l.term_id === t.id);
              const term = t as unknown as Term;
              return (
                <Fragment key={t.id}>
                  <tr className="border-t border-border align-top">
                    <Td>{t.seq}</Td>
                    <Td>{t.name}</Td>
                    <Td className="tabular-nums">{formatQty(Number(t.percent))}%</Td>
                    <Td className="tabular-nums">{t.fixed_amount === null ? "—" : formatTHB(Number(t.fixed_amount))}</Td>
                    <Td className="text-xs">
                      {PAY_TRIGGERS.find((x) => x.value === t.trigger)?.label ?? <span className="text-destructive">ยังไม่ได้เลือก</span>}
                    </Td>
                    <Td className="tabular-nums">{formatTHB(Number(t.amount ?? 0))}</Td>
                    <Td className="whitespace-nowrap text-xs">
                      {t.bill_no ? (<><div>{t.bill_no} · {formatDate(t.bill_date)}</div>
                        <div className={t.due_status === "overdue" ? "font-semibold text-destructive" : "text-muted-foreground"}>ครบกำหนด {formatDate(t.due_date)}</div></>) : "—"}
                    </Td>
                    <Td className="tabular-nums">{formatTHB(Number(t.received_total ?? 0) + Number(t.wht_total ?? 0))}</Td>
                    <Td className="tabular-nums font-medium">{formatTHB(Number(t.outstanding ?? 0))}</Td>
                    <Td><DueBadge s={t.due_status} days={t.days_overdue} /></Td>
                    <Td>
                      <div className="flex gap-1">
                        {t.bill_id ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setViewDoc(t.bill_id)}>ดูใบเบิกเงิน</Button>
                            {isAdmin ? (
                              <Button size="sm" variant="ghost" onClick={async () => {
                                const reason = window.prompt(`เหตุผลที่ยกเลิกใบเบิกเงิน ${t.bill_no}`);
                                if (reason === null) return;
                                if (!reason.trim()) { toast.error("ต้องระบุเหตุผล"); return; }
                                if (!(await askPassword({ title: `ยกเลิกใบเบิกเงิน ${t.bill_no}`, body: `เหตุผล: ${reason}`, destructive: true }))) return;
                                cancelDoc.mutate({ id: t.bill_id!, reason });
                              }}>ยกเลิกใบ</Button>
                            ) : null}
                          </>
                        ) : readOnly ? null : (
                          <Button size="sm" variant="outline" disabled={t.due_status === "paid"} onClick={() => setBillFor(term)}>ออกใบเบิกเงิน</Button>
                        )}
                        {readOnly ? null : <Button size="sm" onClick={() => setPayFor(term)}>บันทึกรับเงิน</Button>}
                        <Button size="sm" variant="ghost" onClick={() => setOpenId(openId === t.id ? null : t.id)}>
                          {openId === t.id ? "ซ่อน" : `รายละเอียด (${rs.filter((r) => !r.voided_at).length})`}
                        </Button>
                      </div>
                    </Td>
                  </tr>
                  {openId === t.id ? (
                    <tr className="bg-secondary/40">
                      <td colSpan={11} className="px-3 py-3">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div>
                            <div className="mb-1 text-xs font-semibold">รายการรับเงิน</div>
                            <table className="w-full text-xs">
                              <thead className="text-left text-muted-foreground">
                                <tr><th className="py-1">วันที่</th><th>จำนวน</th><th>ภาษีหัก</th><th>วิธี</th><th>ธนาคาร/เลขเช็ค</th><th>สลิป</th><th></th></tr>
                              </thead>
                              <tbody>
                                {rs.map((r) => (
                                  <tr key={r.id} className={"border-t border-border " + (r.voided_at ? "text-muted-foreground line-through" : "")}>
                                    <td className="py-1">{formatDate(r.received_date)}</td>
                                    <td className="tabular-nums">{formatTHB(Number(r.amount))}</td>
                                    <td className="tabular-nums">{formatTHB(Number(r.wht_amount))}</td>
                                    <td>{methodLabel(r.method)}</td>
                                    <td>{r.bank_ref ?? "-"}{r.note ? ` · ${r.note}` : ""}</td>
                                    <td>{r.slip_path ? <button className="text-primary underline" onClick={() => openSlip(r.slip_path!)}>ดู</button> : "-"}</td>
                                    <td>
                                      {r.voided_at ? <span className="no-underline">ลบแล้ว: {r.void_reason}</span> : isAdmin ? (
                                        <Button size="sm" variant="ghost" className="h-6" onClick={async () => {
                                          const reason = window.prompt("เหตุผลที่ลบรายการรับเงินนี้");
                                          if (reason === null) return;
                                          if (!reason.trim()) { toast.error("ต้องระบุเหตุผล"); return; }
                                          if (!(await askPassword({ title: `ลบรายการรับเงิน ${formatTHB(Number(r.amount))} บาท`, body: `เหตุผล: ${reason}`, destructive: true }))) return;
                                          voidReceipt.mutate({ id: r.id, reason });
                                        }}>ลบ</Button>
                                      ) : null}
                                    </td>
                                  </tr>
                                ))}
                                {rs.length === 0 ? <tr><td colSpan={7} className="py-1 text-muted-foreground">ยังไม่มีการรับเงิน</td></tr> : null}
                              </tbody>
                            </table>
                          </div>
                          <div>
                            <div className="mb-1 text-xs font-semibold">ประวัติ</div>
                            <ul className="space-y-1 text-xs">
                              {ls.map((l) => {
                                const d = (l.data ?? {}) as Record<string, unknown>;
                                const detail = l.action.startsWith("bill") ? `${d["doc_no"] ?? d["bill_no"] ?? ""} ${formatDate(d["bill_date"] as string)} เครดิต ${d["credit_days"]} วัน`
                                  : l.action === "void" ? `${formatTHB(Number(d["amount"]))} บาท — ${d["void_reason"] ?? ""}` : `${formatTHB(Number(d["amount"]))} บาท`;
                                return (
                                  <li key={l.id} className="border-b border-border/60 pb-1">
                                    {formatDate(l.changed_at)} {new Date(l.changed_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} · {l.who} · <b>{ACTION_LABELS[l.action] ?? l.action}</b> {detail}
                                  </li>
                                );
                              })}
                              {ls.length === 0 ? <li className="text-muted-foreground">ยังไม่มีประวัติ</li> : null}
                            </ul>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            <tr className="border-t border-border font-semibold">
              <Td colSpan={2}>รวม</Td>
              <Td className={pctWrong ? "text-destructive" : ""}>{formatQty(totalPct)}%</Td>
              <Td colSpan={2}></Td>
              <Td className="tabular-nums">{formatTHB(totalAmt)}</Td>
              <Td></Td>
              <Td className="tabular-nums">{formatTHB(totalRec)}</Td>
              <Td className="tabular-nums">{formatTHB(totalOut)}</Td>
              <Td colSpan={2}></Td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        จำนวนเงิน = จำนวนเงินคงที่ (ถ้ากรอก) มิฉะนั้น = % × ยอดสุทธิ · "รับครบ" เมื่อรับเงินรวม + ภาษีหัก ณ ที่จ่าย ≥ จำนวนเงินงวด
      </p>
      <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        เพิ่มหรือแก้งวดเงิน (ชื่อ, %, เงื่อนไข, ข้อความที่พิมพ์) ได้ที่ <span className="font-medium text-foreground">แท็บ BOQ → TERM OF PAYMENT ท้ายหน้า</span> ·
        แท็บนี้ใช้สำหรับออกใบเบิกเงินและบันทึกรับเงิน
      </p>

      {billFor ? (
        <IssueBillingDialog projectId={projectId} termId={billFor.id} onClose={() => setBillFor(null)}
          onIssued={(id) => { setBillFor(null); setViewDoc(id); refresh(); }} />
      ) : null}
      {viewDoc ? <BillingPreviewDialog docId={viewDoc} onClose={() => { setViewDoc(null); refresh(); }} /> : null}
      {payFor ? <ReceiptDialog term={payFor} onClose={() => setPayFor(null)} onSaved={() => afterReceipt(payFor.id)} /> : null}
    </section>
  );
}

const today = () => new Date().toISOString().slice(0, 10);

function ReceiptDialog({ term, onClose, onSaved }: { term: Term; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ received_date: today(), amount: String(term.outstanding ?? ""), method: "transfer", bank_ref: "", wht: "", note: "" });
  const [file, setFile] = useState<File | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      let slip_path: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
        slip_path = `${term.id}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from("payment-slips").upload(slip_path, file, { contentType: file.type });
        if (error) throw error;
      }
      const { error } = await supabase.from("payment_receipts").insert({
        term_id: term.id, received_date: f.received_date, amount: toNumber(f.amount) ?? 0, method: f.method,
        bank_ref: f.bank_ref.trim() || null, wht_amount: toNumber(f.wht) ?? 0, note: f.note.trim() || null, slip_path,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("บันทึกรับเงินแล้ว"); onSaved(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>บันทึกรับเงิน — งวด {term.seq} {term.name}</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">ยอดงวด {formatTHB(Number(term.amount ?? 0))} บาท · คงค้าง {formatTHB(Number(term.outstanding ?? 0))} บาท</p>
        <form id="receipt-form" className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          const amt = toNumber(f.amount);
          if (!f.received_date || amt === null || amt < 0) { toast.error("กรุณากรอกวันที่และจำนวนเงินให้ถูกต้อง"); return; }
          if (file && file.size > 10 * 1024 * 1024) { toast.error("ไฟล์สลิปต้องไม่เกิน 10 MB"); return; }
          save.mutate();
        }}>
          <Field label="วันที่รับ *"><Input type="date" value={f.received_date} onChange={(e) => setF({ ...f, received_date: e.target.value })} /></Field>
          <Field label="จำนวนเงิน (บาท) *"><Input value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="วิธีรับ">
            <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
              {PAY_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="ธนาคาร / เลขที่เช็ค"><Input value={f.bank_ref} onChange={(e) => setF({ ...f, bank_ref: e.target.value })} /></Field>
          <Field label="ภาษีหัก ณ ที่จ่าย (บาท)"><Input value={f.wht} placeholder="ถ้ามี" onChange={(e) => setF({ ...f, wht: e.target.value })} /></Field>
          <Field label="แนบสลิป (รูป/PDF)"><Input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
          <Field label="หมายเหตุ" className="sm:col-span-2"><Textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>ยกเลิก</Button>
          <Button type="submit" form="receipt-form" disabled={save.isPending}>บันทึก</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
