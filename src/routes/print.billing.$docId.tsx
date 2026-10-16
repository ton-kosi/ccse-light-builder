import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useEffect, useRef } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { companyOf, useCompanies } from "@/lib/companies";
import { BillingSheet } from "@/components/print/BillingSheet";
import { buildA4Pdf } from "@/lib/pdf";
import { bahtText } from "@/lib/bahtText";
import { quotationRevisionSuffix } from "@/lib/boq";
import { formatDate, formatQty, formatTHB } from "@/lib/format";

export const Route = createFileRoute("/print/billing/$docId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ใบเบิกเงิน / ใบแจ้งหนี้ | CCSE ERP" },
      { name: "description", content: "ใบเบิกเงินสำหรับลูกค้า รูปแบบ A4 พร้อมพิมพ์/บันทึก PDF" },
      { property: "og:title", content: "ใบเบิกเงิน / ใบแจ้งหนี้ | CCSE ERP" },
      { property: "og:description", content: "ใบเบิกเงินสำหรับลูกค้า รูปแบบ A4" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrintBilling,
});

function PrintBilling() {
  const { docId } = Route.useParams();
  const qc = useQueryClient();
  const companies = useCompanies();
  const { data, isLoading } = useQuery({
    queryKey: ["print_billing", docId],
    queryFn: async () => {
      const { data: d, error } = await supabase
        .from("billing_docs")
        .select("*")
        .eq("id", docId)
        .maybeSingle();
      if (error) throw error;
      if (!d) return null;
      const { data: all, error: e2 } = await supabase
        .from("billing_docs")
        .select("*")
        .eq("project_id", d.project_id)
        .is("cancelled_at", null);
      if (e2) throw e2;
      return { d, all: all ?? [] };
    },
  });

  // First open after issuing: store the PDF with the project (once).
  const saving = useRef(false);
  useEffect(() => {
    if (!data || data.d.pdf_path || data.d.cancelled_at || saving.current) return;
    saving.current = true;
    (async () => {
      await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 300));
      const el = document.querySelector(".bill-print") as HTMLElement | null;
      if (!el) return;
      const blob = (await buildA4Pdf(el)).output("blob");
      const path = `billing/${data.d.project_id}/${data.d.doc_no}.pdf`;
      const { error: upErr } = await supabase.storage
        .from("payment-slips")
        .upload(path, blob, { contentType: "application/pdf", upsert: true });
      if (upErr) {
        toast.error(upErr.message);
        return;
      }
      const { error } = await supabase
        .from("billing_docs")
        .update({ pdf_path: path })
        .eq("id", data.d.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(`บันทึก PDF ${data.d.doc_no} ไว้กับโปรเจกต์แล้ว`);
      qc.invalidateQueries({ queryKey: ["print_billing", docId] });
    })().catch((e: Error) => toast.error(e.message));
  }, [data, docId, qc]);

  if (isLoading) return <p className="p-8 text-sm">กำลังโหลด...</p>;
  if (!data) return <p className="p-8 text-sm">ไม่พบใบเบิกเงิน หรือคุณไม่มีสิทธิ์ดู</p>;
  return <BillingSheet d={data.d} all={data.all} co={companyOf(companies, data.d.company_id)} />;
}
