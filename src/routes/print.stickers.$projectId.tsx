import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useProduction } from "@/hooks/useProduction";

export const Route = createFileRoute("/print/stickers/$projectId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "สติ๊กเกอร์ชิ้นงาน | CCSE ERP" },
      { name: "description", content: "สติ๊กเกอร์ติดชิ้นไฟเส้นที่ตัดแล้ว: ข้อ รุ่น วงจร สเปค ความยาว" },
      { property: "og:title", content: "สติ๊กเกอร์ชิ้นงาน | CCSE ERP" },
      { property: "og:description", content: "สติ๊กเกอร์ชิ้นงานสำหรับฝ่ายผลิต" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrintStickers,
});

/** One label per cut piece (like "For Sticker_NO."): item, fixture, circuit, spec, length, circuit total. */
function PrintStickers() {
  const { projectId } = Route.useParams();
  const { lines, isLoading } = useProduction(projectId);
  const [copies, setCopies] = useState(2);

  const labels = lines.flatMap((l) => {
    const spec = [l.wattPerM ? `${Math.round(l.wattPerM)}W` : null, "24V", l.colour].filter(Boolean).join(" ");
    return l.rows.flatMap((r) =>
      Array.from({ length: r.sets * copies }, () => ({
        item: l.itemNo,
        fixture: l.fixture,
        circuit: l.circuit,
        spec,
        lengthM: (r.ledCm / 100).toFixed(3),
        totalM: l.totals.ledM.toFixed(2),
      })),
    );
  });

  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">กำลังโหลด…</p>;
  return (
    <div className="min-h-screen bg-muted print:bg-background">
      <style>{`@page { size: A4; margin: 8mm; } @media print { .stk-sheet { padding: 0 !important; box-shadow: none !important; } }`}</style>
      <div className="mx-auto flex max-w-[210mm] items-center justify-end gap-2 py-3 text-sm print:hidden">
        <span>{labels.length} ดวง</span>
        <label className="flex items-center gap-1">
          ชุดละ
          <select
            className="h-9 rounded-md border border-input bg-background px-2"
            value={copies}
            onChange={(e) => setCopies(Number(e.target.value))}
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n} ดวง
              </option>
            ))}
          </select>
        </label>
        <Button onClick={() => window.print()}>พิมพ์</Button>
      </div>
      <div className="stk-sheet mx-auto grid max-w-[210mm] grid-cols-3 gap-[2mm] bg-background p-[8mm] shadow">
        {labels.length ? (
          labels.map((s, i) => (
            <div
              key={i}
              className="flex h-[24mm] flex-col justify-between break-inside-avoid rounded border border-foreground px-[2mm] py-[1.5mm] text-[9px] leading-tight text-foreground"
            >
              <div className="flex justify-between font-bold">
                <span>{s.item}</span>
                <span className="font-mono">{s.fixture ?? ""}</span>
              </div>
              <div>
                {s.circuit ?? ""} · {s.spec}
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-bold">{s.lengthM} M.</span>
                <span>[{s.totalM} M.]</span>
              </div>
            </div>
          ))
        ) : (
          <p className="col-span-3 text-sm text-muted-foreground">ยังไม่มีชิ้นงานที่ต้องตัด</p>
        )}
      </div>
    </div>
  );
}
