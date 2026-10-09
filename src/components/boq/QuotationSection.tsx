import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { Field } from "@/routes/_authenticated/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BoqGrid, type GridLine } from "@/components/boq/BoqGrid";
import { QuoteFooter } from "@/components/boq/QuoteFooter";
import { BillingPreviewDialog, IssueBillingDialog } from "@/components/payments/BillingDialogs";
import { useCurrentQuotation } from "@/hooks/useCurrentQuotation";
import { computeTotals, optionNames, quotationRevisionSuffix } from "@/lib/boq";
import { formatDate, formatTHB, toNumber } from "@/lib/format";

export function QuotationSection({
  projectId,
  projectCode,
  selectedOption,
  canEdit,
  canSeeCost,
  canManagePayments = false,
}: {
  projectId: string;
  projectCode: string;
  selectedOption: string | null;
  canEdit: boolean;
  canSeeCost: boolean;
  canManagePayments?: boolean;
}) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [billDoc, setBillDoc] = useState<string | null>(null);
  const { data: termPct } = useQuery({
    queryKey: ["payment_schedule", projectId],
    enabled: canManagePayments,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("payment_schedule", { _project_id: projectId });
      if (error) throw error;
      return data ?? [];
    },
    select: (d) => (d.length ? d.reduce((s, t) => s + Number(t.percent), 0) : null),
  });
  const { quotation, lines } = useCurrentQuotation(projectId, true);

  const { data: revisions } = useQuery({
    queryKey: ["quotation_revs", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotations")
        .select("id, rev, date, is_current")
        .eq("project_id", projectId)
        .order("rev");
      if (error) throw error;
      return data;
    },
  });

  const { data: components } = useQuery({
    queryKey: ["sales_components", "picker"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_components")
        .select("id, code, name, unit")
        .order("code");
      if (error) throw error;
      const { data: prices } = await supabase.from("component_prices").select("component_id, list_price, max_discount_percent");
      const pm = new Map((prices ?? []).map((p) => [p.component_id, p]));
      return data.map((c) => ({
        ...c,
        list_price: pm.get(c.id)?.list_price ?? null,
        max_discount_percent: pm.get(c.id)?.max_discount_percent ?? null,
      }));
    },
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["quotation", projectId] });
    queryClient.invalidateQueries({ queryKey: ["quotation_revs", projectId] });
    queryClient.invalidateQueries({ queryKey: ["quote_lines"] });
    queryClient.invalidateQueries({ queryKey: ["payment_terms"] });
  };

  const createQuotation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("quotations")
        .insert({ project_id: projectId, ref_no: projectCode, rev: "A", is_current: true });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("สร้างใบเสนอราคาแล้ว");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const newRev = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("create_quotation_revision", { _project_id: projectId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("สร้าง Rev ใหม่แล้ว");
      invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateQuotation = useMutation({
    mutationFn: async (patch: TablesUpdate<"quotations">) => {
      const { error } = await supabase.from("quotations").update(patch).eq("id", quotation!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quotation", projectId] });
      queryClient.invalidateQueries({ queryKey: ["quotation_revs", projectId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!quotation) {
    return (
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">ใบเสนอราคา (BOQ)</h2>
        <p className="mt-1 text-sm text-muted-foreground">ยังไม่มีใบเสนอราคาสำหรับงานนี้</p>
        {canEdit ? (
          <Button size="sm" className="mt-3" onClick={() => createQuotation.mutate()}>
             สร้างใบเสนอราคา
          </Button>
        ) : null}
      </section>
    );
  }

  const discount = Number(quotation.discount ?? 0);
  const vatPct = Number(quotation.vat_percent ?? 0);
  const opts = optionNames(lines);
  const t = computeTotals(lines, discount, vatPct, selectedOption);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
             ใบเสนอราคา {quotation.ref_no}{quotationRevisionSuffix(quotation.rev)} (ฉบับปัจจุบัน)
          </h2>
           {(revisions?.length ?? 0) > 1 ? <p className="text-xs text-muted-foreground">
             ฉบับทั้งหมด:{" "}
            {(revisions ?? [])
               .map((r) => `${quotationRevisionSuffix(r.rev).trim() || "ฉบับแรก"} (${formatDate(r.date)})${r.is_current ? " ✓" : ""}`)
              .join(" · ")}
           </p> : null}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setPreview(true)}>
            พิมพ์ใบเสนอราคา
          </Button>
          {canManagePayments ? (
            <Button size="sm" onClick={() => setIssuing(true)}>ออกใบเบิกเงิน</Button>
          ) : null}
          {canEdit ? (
            <Button size="sm" variant="outline" disabled={newRev.isPending} onClick={() => newRev.mutate()}>
              สร้าง Rev ใหม่
            </Button>
          ) : null}
        </div>
      </div>

      {termPct !== null && termPct !== undefined && Math.abs(termPct - 100) > 0.001 ? (
        <p className="mt-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          ผลรวม % ของงวดเงินเท่ากับ {termPct}% — ควรเท่ากับ 100% (แก้ไขที่ TERM OF PAYMENT ท้ายหน้านี้)
        </p>
      ) : null}
      {issuing ? (
        <IssueBillingDialog projectId={projectId} onClose={() => setIssuing(false)} onIssued={(id) => { setIssuing(false); setBillDoc(id); }} />
      ) : null}
      {billDoc ? <BillingPreviewDialog docId={billDoc} onClose={() => setBillDoc(null)} /> : null}

      <div className="mt-4 grid gap-3 md:grid-cols-6" key={quotation.id}>
        <Field label="เลขที่อ้างอิง">
          <Input
            defaultValue={quotation.ref_no}
            disabled={!canEdit}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== quotation.ref_no) updateQuotation.mutate({ ref_no: v });
            }}
          />
        </Field>
        <Field label="วันที่">
          <Input
            type="date"
            defaultValue={quotation.date}
            disabled={!canEdit}
            onBlur={(e) => {
              if (e.target.value && e.target.value !== quotation.date)
                updateQuotation.mutate({ date: e.target.value });
            }}
          />
        </Field>
      </div>

      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="flex h-[92vh] max-w-[900px] flex-col p-3">
          <DialogHeader>
             <DialogTitle>ตัวอย่างใบเสนอราคา {quotation.ref_no}{quotationRevisionSuffix(quotation.rev)}</DialogTitle>
          </DialogHeader>
          <iframe
            title="quotation-preview"
            src={`/print/quotation/${quotation.id}`}
            className="w-full flex-1 rounded border border-border bg-background"
          />
        </DialogContent>
      </Dialog>

      <BoqGrid
        quotationId={quotation.id}
        lines={lines as GridLine[]}
        components={components ?? []}
        selectedOption={selectedOption}
        canEdit={canEdit}
        canSeeCost={canSeeCost}
      />

      <div className="mt-4 flex flex-wrap justify-end gap-8 text-sm">
        {opts.length ? (
          <div className="w-full max-w-xs space-y-1">
            <div className="font-semibold">ยอดรวมแยกตาม Option</div>
            <Row label="รายการหลัก (ไม่มี Option)" value={formatTHB(t.base)} />
            {opts.map((o) => (
              <Row
                key={o}
                label={`Option ${o}${o === selectedOption ? " ✓ ลูกค้าเลือก" : ""}`}
                value={formatTHB(t.perOption[o] ?? 0)}
              />
            ))}
          </div>
        ) : null}
        <div className="w-full max-w-xs space-y-1">
          <div className="font-semibold">
            ยอดรวม{opts.length ? (selectedOption ? ` (หลัก + Option ${selectedOption})` : " (เฉพาะรายการหลัก — ยังไม่เลือก Option)") : ""}
          </div>
          <Row label="รวมเป็นเงิน" value={formatTHB(t.subtotal)} />
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">ส่วนลดพิเศษท้ายใบ</span>
            <Input
              key={"disc" + discount}
              className="h-7 w-32 text-right tabular-nums"
              defaultValue={discount ? String(discount) : ""}
              placeholder="0.00"
              disabled={!canEdit}
              onBlur={(e) => {
                const v = toNumber(e.target.value) ?? 0;
                if (v !== discount) updateQuotation.mutate({ discount: v });
              }}
            />
          </div>
          <Row label="ยอดหลังหักส่วนลด" value={formatTHB(t.afterDiscount)} />
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1 text-muted-foreground">
              VAT
              <Input
                key={"vat" + vatPct}
                className="h-7 w-14 text-right"
                defaultValue={String(vatPct)}
                disabled={!canEdit}
                onBlur={(e) => {
                  const v = toNumber(e.target.value) ?? 0;
                  if (v !== vatPct) updateQuotation.mutate({ vat_percent: v });
                }}
              />
              %
            </span>
            <span className="tabular-nums">{formatTHB(t.vat)}</span>
          </div>
          <Row label="ยอดสุทธิ (บาท)" value={formatTHB(t.net)} bold />
        </div>
      </div>

      <QuoteFooter
        quotation={quotation}
        net={t.net}
        canEdit={canEdit}
        syncKey={`${selectedOption ?? ""}|${lines.map((l) => `${l.component_id ?? ""}:${l.option_name ?? ""}:${l.kind}`).join(",")}`}
      />
    </section>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={"flex justify-between gap-4 " + (bold ? "border-t border-border pt-1 font-semibold" : "")}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
