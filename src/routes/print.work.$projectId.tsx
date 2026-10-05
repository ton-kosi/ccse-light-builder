import { createFileRoute } from "@tanstack/react-router";
import { WorkSheet } from "@/components/work/WorkSheet";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/print/work/$projectId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "พิมพ์ใบ Work | CCSE ERP" },
      { name: "description", content: "ใบงานผลิตและเบิกของ รูปแบบ A4 ไม่มีราคา" },
      { property: "og:title", content: "พิมพ์ใบ Work | CCSE ERP" },
      { property: "og:description", content: "ใบงานผลิตและเบิกของ รูปแบบ A4" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrintWork,
});

function PrintWork() {
  const { projectId } = Route.useParams();
  return (
    <div className="min-h-screen bg-muted print:bg-background">
      <style>{`@page { size: A4; margin: 12mm; }`}</style>
      <div className="mx-auto flex max-w-[210mm] justify-end gap-2 py-3 print:hidden">
        <button className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={() => window.print()}>
          พิมพ์ / บันทึก PDF
        </button>
      </div>
      <div className="mx-auto max-w-[210mm] bg-background p-[12mm] text-foreground shadow print:max-w-none print:p-0 print:shadow-none">
        <div className="mb-2 flex items-end justify-between border-b-2 border-foreground pb-2">
          <div>
            <div className="text-lg font-bold">ใบ Work / WORK SHEET</div>
            <div className="text-xs">Chingchai &amp; Sons Engineering · CCSE</div>
          </div>
          <div className="text-xs">พิมพ์ {formatDate(new Date())}</div>
        </div>
        <WorkSheet projectId={projectId} print />
        <div className="mt-10 grid grid-cols-3 gap-8 text-center text-xs">
          {["ผู้จ่ายของ (คลัง)", "ผู้รับของ (ผลิต/ช่าง)", "ผู้ตรวจสอบ"].map((s) => (
            <div key={s}><div className="border-b border-foreground pb-8" /> {s}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
