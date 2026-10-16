import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Field } from "@/routes/_authenticated/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, formatTHB, toNumber } from "@/lib/format";
import { companyOf, useCompanies } from "@/lib/companies";
import { addDays } from "@/lib/payments";

const today = () => new Date().toISOString().slice(0, 10);

/** Pick a payment term of the current quotation and issue a billing document. */
export function IssueBillingDialog({
  projectId,
  termId,
  onClose,
  onIssued,
}: {
  projectId: string;
  termId?: string;
  onClose: () => void;
  onIssued: (docId: string) => void;
}) {
  const qc = useQueryClient();
  const { data: terms } = useQuery({
    queryKey: ["payment_schedule", projectId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("payment_schedule", { _project_id: projectId });
      if (error) throw error;
      return data ?? [];
    },
  });
  const unbilled = (terms ?? []).filter((t) => !t.bill_id && t.due_status !== "paid");
  const [picked, setPicked] = useState<string | undefined>(termId);
  const sel = picked ?? unbilled[0]?.id;
  const [billDate, setBillDate] = useState(today());
  const [credit, setCredit] = useState("15");
  const days = toNumber(credit) ?? 0;
  const companies = useCompanies();
  const { data: companyId } = useQuery({
    queryKey: ["quotation_company", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotations")
        .select("company_id")
        .eq("project_id", projectId)
        .eq("is_current", true)
        .maybeSingle();
      return error ? null : (data?.company_id ?? null);
    },
  });
  const company = companyOf(companies, companyId);
  const [whtPick, setWht] = useState<number | null>(null);
  const wht = whtPick ?? Number(company.default_wht_percent ?? 0);

  const issue = useMutation({
    mutationFn: async () => {
      const args = { _term_id: sel!, _bill_date: billDate, _credit_days: days };
      let res = await supabase.rpc("issue_billing_doc", { ...args, _wht_percent: wht });
      // database not updated yet (no withholding tax argument) → old call
      if (res.error?.code === "PGRST202") res = await supabase.rpc("issue_billing_doc", args);
      if (res.error) throw res.error;
      return res.data as string;
    },
    onSuccess: (id) => {
      toast.success("ออกใบเบิกเงินแล้ว");
      qc.invalidateQueries({ queryKey: ["payment_schedule"] });
      qc.invalidateQueries({ queryKey: ["payment_audit_log"] });
      onIssued(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ออกใบเบิกเงิน</DialogTitle>
        </DialogHeader>
        {terms && !terms.length ? (
          <p className="text-sm text-muted-foreground">
            ยังไม่มีงวดเงิน — เพิ่มงวดในแท็บ "งวดเงิน" ก่อน
          </p>
        ) : (
          <form
            id="issue-form"
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!sel) {
                toast.error("ไม่มีงวดที่ยังไม่ได้วางบิล");
                return;
              }
              if (!billDate || days < 0 || !Number.isInteger(days)) {
                toast.error("กรุณากรอกวันที่และเครดิตให้ถูกต้อง");
                return;
              }
              issue.mutate();
            }}
          >
            <Field label="งวดเงิน">
              <div className="space-y-1">
                {(terms ?? []).map((t) => {
                  const done = !!t.bill_id || t.due_status === "paid";
                  return (
                    <label
                      key={t.id}
                      className={
                        "flex items-center gap-2 rounded border border-border px-2 py-1 text-sm " +
                        (done ? "opacity-50" : "")
                      }
                    >
                      <input
                        type="radio"
                        name="term"
                        disabled={done}
                        checked={sel === t.id}
                        onChange={() => setPicked(t.id)}
                      />
                      <span className="flex-1">
                        งวดที่ {t.seq} {t.name}
                      </span>
                      <span className="tabular-nums">{formatTHB(Number(t.amount ?? 0))}</span>
                      {t.bill_no ? (
                        <span className="text-xs text-muted-foreground">{t.bill_no}</span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </Field>
            <Field label="วันที่วางบิล *">
              <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </Field>
            <Field label="เครดิต (วัน)">
              <Input value={credit} onChange={(e) => setCredit(e.target.value)} />
            </Field>
            <Field label="ภาษีหัก ณ ที่จ่าย (คิดจากยอดก่อน VAT)">
              <div className="flex flex-wrap gap-1.5">
                {[0, 1, 2, 3, 5].map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={
                      "rounded-md border px-3 py-1 text-sm " +
                      (wht === p
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background")
                    }
                    onClick={() => setWht(p)}
                  >
                    {p ? `${p}%` : "ไม่หัก"}
                  </button>
                ))}
              </div>
            </Field>
            <p className="text-xs text-muted-foreground">ออกในนาม {company.name_th}</p>
            <p className="text-sm">
              ครบกำหนดชำระ: <b>{billDate ? formatDate(addDays(billDate, days)) : "-"}</b>
            </p>
          </form>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="submit" form="issue-form" disabled={issue.isPending || !sel}>
            ออกใบเบิกเงิน
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A4 preview of a billing document (print / save PDF). */
export function BillingPreviewDialog({ docId, onClose }: { docId: string; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[92vh] max-w-[900px] flex-col p-3">
        <DialogHeader>
          <DialogTitle>ใบเบิกเงิน / ใบแจ้งหนี้</DialogTitle>
        </DialogHeader>
        <iframe
          title="billing-preview"
          src={`/print/billing/${docId}`}
          className="w-full flex-1 rounded border border-border bg-background"
        />
      </DialogContent>
    </Dialog>
  );
}
