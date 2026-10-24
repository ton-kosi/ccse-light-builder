import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ProductionSheet } from "@/components/work/ProductionSheet";
import { useWorkSheet } from "@/components/work/WorkSheet";
import { quotationRevisionSuffix } from "@/lib/boq";
import { formatDate } from "@/lib/format";
import { buildA4Pdf } from "@/lib/pdf";

export const Route = createFileRoute("/print/production/$projectId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ใบผลิต | CCSE ERP" },
      { name: "description", content: "ใบผลิต (ตัดไฟ) ระยะตัด LED / Profile ท่อหด อลูมิเนียม Clip และโหลด ไม่มีราคา" },
      { property: "og:title", content: "ใบผลิต | CCSE ERP" },
      { property: "og:description", content: "ใบผลิต (ตัดไฟ) รูปแบบ A4" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrintProduction,
});

function PrintProduction() {
  const { projectId } = Route.useParams();
  const { header } = useWorkSheet(projectId);
  const { data: p } = useQuery({
    queryKey: ["project", projectId, "production"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("code, name").eq("id", projectId).single();
      if (error) throw error;
      return data;
    },
  });
  return (
    <div className="min-h-screen bg-muted print:bg-background">
      <style>{`@page { size: A4 landscape; margin: 8mm; } @media print { .prod-print { padding: 0 !important; max-width: none !important; box-shadow: none !important; } }`}</style>
      <div className="mx-auto flex max-w-[297mm] justify-end gap-2 py-3 print:hidden">
        <Button variant="outline" onClick={() => window.print()}>
          พิมพ์
        </Button>
        <Button
          onClick={async () => {
            const el = document.querySelector(".prod-print") as HTMLElement | null;
            if (el) (await buildA4Pdf(el)).save(`ใบผลิต ${p?.code ?? ""}.pdf`);
          }}
        >
          บันทึก PDF
        </Button>
      </div>
      <div className="prod-print mx-auto max-w-[297mm] bg-background p-[8mm] text-foreground shadow">
        <div className="mb-2 flex items-end justify-between border-b-2 border-foreground pb-1">
          <div>
            <div className="text-base font-bold">ใบผลิต (ตัดไฟ) / PRODUCTION SHEET</div>
            <div className="text-xs">
              โครงการ: <b>{p?.name}</b>
            </div>
          </div>
          <div className="text-right text-xs">
            <div>P/J No. {p?.code}</div>
            <div>ref: {header ? `${header.ref_no}${quotationRevisionSuffix(header.rev)}` : "-"}</div>
            <div>พิมพ์ {formatDate(new Date())}</div>
          </div>
        </div>
        <ProductionSheet projectId={projectId} canEdit={false} print />
        <div className="mt-6 grid grid-cols-3 gap-8 text-center text-xs">
          {["ผู้ตัด / ประกอบ", "ผู้ตรวจสอบ (QC)", "หัวหน้าฝ่ายผลิต"].map((s) => (
            <div key={s}>
              <div className="border-b border-foreground pb-8" /> {s}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
