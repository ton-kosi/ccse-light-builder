import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useMeasurements } from "@/hooks/useMeasurements";
import { formatCutLengths } from "@/lib/boq";
import { formatQty, formatTHB } from "@/lib/format";
import { compareLine, compareTotals, isMeasurable } from "@/lib/measure";

type Line = {
  id: string;
  kind: string;
  item_no: string | null;
  zone: string | null;
  customer_text: string | null;
  option_name: string | null;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  discount_percent: number;
  cut_lengths: number[] | null;
  sales_components: { name: string; unit: string } | null;
};

/**
 * Contract vs measured on site, and the button that turns the measurements into the final Rev
 * (its last payment term becomes the balance). Shown on the BOQ tab once something was measured.
 */
export function FinalRevPanel({
  projectId,
  lines,
  selectedOption,
  vatPercent,
  canEdit,
  canSeeMoney,
}: {
  projectId: string;
  lines: Line[];
  selectedOption: string | null;
  vatPercent: number;
  canEdit: boolean;
  canSeeMoney: boolean;
}) {
  const qc = useQueryClient();
  const { data: measured } = useMeasurements(projectId);
  const [open, setOpen] = useState(false);

  const included = (l: Line) =>
    !(l.option_name ?? "").trim() || (l.option_name ?? "").trim() === (selectedOption ?? "").trim();
  const rows = lines
    .filter((l) => isMeasurable(l.kind) && measured?.has(l.id))
    .map((l) => {
      const m = measured!.get(l.id)!;
      const mq = m.measured_qty != null ? Number(m.measured_qty) : Number(l.qty ?? 0);
      const cmp = {
        contractQty: Number(l.qty ?? 0),
        measuredQty: mq,
        unitPrice: Number(l.unit_price ?? 0),
        discountPercent: Number(l.discount_percent ?? 0),
      };
      return { l, m, cmp, diff: compareLine(cmp), counted: included(l) && l.kind === "priced" };
    });
  const measurable = lines.filter((l) => isMeasurable(l.kind) && included(l)).length;

  const final = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("create_final_revision", { _project_id: projectId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("สร้าง Rev สุดท้ายจากค่าที่วัดแล้ว — งวดสุดท้ายเป็นยอดคงเหลือ");
      ["quotation", "quotation_revs", "quote_lines", "payment_terms", "payment_schedule", "site_measurements", "wo_lines", "wo_header"].forEach(
        (k) => qc.invalidateQueries({ queryKey: [k] }),
      );
    },
    onError: (e: Error) =>
      toast.error(
        /create_final_revision|schema cache/i.test(e.message)
          ? "ยังสร้างไม่ได้ — ให้ Lovable รันไฟล์ docs/sql/measure_final_rev.sql ก่อน"
          : e.message,
      ),
  });

  if (!rows.length) return null;
  const totals = compareTotals(rows.filter((r) => r.counted).map((r) => r.cmp));
  const withVat = Math.round(totals.amountDiff * (1 + vatPercent / 100) * 100) / 100;
  const sign = (n: number) => (n > 0 ? "+" : "");

  return (
    <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold">ค่าที่วัดหน้างาน</div>
          <div className="text-xs text-muted-foreground">
            วัดแล้ว {rows.length}/{measurable} รายการ · เปลี่ยนจากสัญญา {totals.changed} รายการ
            {canSeeMoney ? (
              <>
                {" "}
                · ส่วนต่าง{" "}
                <b className={totals.amountDiff > 0 ? "text-success" : totals.amountDiff < 0 ? "text-destructive" : ""}>
                  {sign(totals.amountDiff)}
                  {formatTHB(totals.amountDiff)}
                </b>{" "}
                บาท ก่อน VAT ({sign(withVat)}
                {formatTHB(withVat)} รวม VAT)
              </>
            ) : null}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>
            {open ? "ซ่อนรายละเอียด" : "เทียบรายการ"}
          </Button>
          {canEdit ? (
            <Button
              size="sm"
              disabled={final.isPending}
              onClick={() => {
                if (
                  confirm(
                    "สร้าง Rev ใหม่โดยใช้จำนวนและความยาวที่วัดหน้างาน?\nงวดสุดท้ายจะถูกตั้งเป็น “ยอดคงเหลือ” เพื่อเบิกส่วนที่เหลือทั้งหมด",
                  )
                )
                  final.mutate();
              }}
            >
              สร้าง Rev สุดท้ายจากค่าที่วัด
            </Button>
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-1 pr-2">ITEM</th>
                <th className="py-1 pr-2">รายการ</th>
                <th className="py-1 pr-2 text-right">ตามสัญญา</th>
                <th className="py-1 pr-2 text-right">วัดจริง</th>
                <th className="py-1 pr-2 text-right">ต่าง</th>
                {canSeeMoney ? <th className="py-1 text-right">ส่วนต่าง (บาท)</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ l, m, cmp, diff, counted }) => (
                <tr key={l.id} className={"border-b border-border align-top" + (counted ? "" : " opacity-50")}>
                  <td className="py-1 pr-2">{l.item_no}</td>
                  <td className="py-1 pr-2">
                    {l.customer_text?.split("\n")[0] || l.sales_components?.name || "—"}
                    {m.cut_lengths?.length ? (
                      <div className="text-muted-foreground">ตัด {m.cut_spec || formatCutLengths(m.cut_lengths)}</div>
                    ) : null}
                    {m.note ? <div className="text-muted-foreground">{m.note}</div> : null}
                    {!counted ? <div className="text-muted-foreground">(ไม่นับในยอด)</div> : null}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {formatQty(cmp.contractQty)} {l.unit ?? l.sales_components?.unit ?? ""}
                  </td>
                  <td className="py-1 pr-2 text-right font-semibold tabular-nums">{formatQty(cmp.measuredQty)}</td>
                  <td
                    className={
                      "py-1 pr-2 text-right tabular-nums " +
                      (diff.qtyDiff > 0 ? "text-success" : diff.qtyDiff < 0 ? "text-destructive" : "text-muted-foreground")
                    }
                  >
                    {diff.qtyDiff ? sign(diff.qtyDiff) + formatQty(diff.qtyDiff) : "—"}
                  </td>
                  {canSeeMoney ? (
                    <td className="py-1 text-right tabular-nums">
                      {counted && diff.amountDiff ? sign(diff.amountDiff) + formatTHB(diff.amountDiff) : "—"}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
