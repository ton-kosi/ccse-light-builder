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
import { useCurrentQuotation } from "@/hooks/useCurrentQuotation";
import { computeTotals, optionNames, quotationRevisionSuffix } from "@/lib/boq";
import { formatDate, formatTHB, toNumber } from "@/lib/format";

export function QuotationSection({
  projectId,
  projectCode,
  selectedOption,
  canEdit,
  canSeeCost,
}: {
  projectId: string;
  projectCode: string;
  selectedOption: string | null;
  canEdit: boolean;
  canSeeCost: boolean;
}) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState(false);
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
          {canEdit ? (
            <Button size="sm" variant="outline" disabled={newRev.isPending} onClick={() => newRev.mutate()}>
              สร้าง Rev ใหม่
            </Button>
          ) : null}
        </div>
      </div>

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
        <Field label="ยืนราคา (วัน)">
          <Input
            defaultValue={quotation.validity_days === null ? "" : String(quotation.validity_days)}
            disabled={!canEdit}
            onBlur={(e) => {
              const n = toNumber(e.target.value);
              const v = n === null ? null : Math.round(n);
              if (v !== quotation.validity_days) updateQuotation.mutate({ validity_days: v });
            }}
          />
        </Field>
        <Field label="การส่งมอบ" className="md:col-span-3">
          <Input
            defaultValue={quotation.delivery_text ?? ""}
            disabled={!canEdit}
            onBlur={(e) => {
              if (e.target.value !== (quotation.delivery_text ?? ""))
                updateQuotation.mutate({ delivery_text: e.target.value || null });
            }}
          />
        </Field>
        <Field label="ส่วนลดท้ายใบ (บาท)">
          <Input
            defaultValue={String(quotation.discount ?? 0)}
            disabled={!canEdit}
            onBlur={(e) => updateQuotation.mutate({ discount: toNumber(e.target.value) ?? 0 })}
          />
        </Field>
        <Field label="VAT %">
          <Input
            defaultValue={String(quotation.vat_percent ?? 7)}
            disabled={!canEdit}
            onBlur={(e) => updateQuotation.mutate({ vat_percent: toNumber(e.target.value) ?? 0 })}
          />
        </Field>
        <Field label="หมายเหตุ (พิมพ์ท้ายใบ)" className="md:col-span-4">
          <Input
            defaultValue={quotation.notes ?? ""}
            disabled={!canEdit}
            onBlur={(e) => {
              if (e.target.value !== (quotation.notes ?? ""))
                updateQuotation.mutate({ notes: e.target.value || null });
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
          <Row label="ส่วนลด" value={formatTHB(discount)} />
          <Row label={`VAT ${vatPct}%`} value={formatTHB(t.vat)} />
          <Row label="ยอดสุทธิ (บาท)" value={formatTHB(t.net)} bold />
        </div>
      </div>
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
