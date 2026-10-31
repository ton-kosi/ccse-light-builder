import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { QrCode } from "@/components/scan/QrCode";
import { categoryOf } from "@/lib/skuCategory";

export const Route = createFileRoute("/print/sku-labels")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    ids: typeof s["ids"] === "string" ? s["ids"] : "",
  }),
  head: () => ({
    meta: [
      { title: "ป้าย SKU | CCSE ERP" },
      { name: "description", content: "ป้ายสินค้า QR + รหัส SKU ขนาด 80 × 50 มม. สำหรับเครื่องพิมพ์ฉลาก" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrintSkuLabels,
});

/**
 * One 80 × 50 mm label per page (thermal label printer, e.g. TSC TE210): QR of the SKU code,
 * the code in large text (still readable if the QR is scratched), name, category and unit.
 */
function PrintSkuLabels() {
  const { ids } = Route.useSearch();
  const idList = ids.split(",").filter(Boolean);
  const [copies, setCopies] = useState(1);

  const { data: skus, isLoading } = useQuery({
    queryKey: ["skus", "labels", ids],
    enabled: idList.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("skus").select("id, code, name, unit, notes").in("id", idList);
      if (error) throw error;
      // keep the order the labels were asked for
      return idList.map((id) => data.find((k) => k.id === id)).filter((k): k is NonNullable<typeof k> => !!k);
    },
  });

  const labels = (skus ?? []).flatMap((k) => Array.from({ length: copies }, (_, i) => ({ ...k, key: `${k.id}-${i}` })));

  if (!idList.length) return <p className="p-6 text-sm text-muted-foreground">ยังไม่ได้เลือก SKU — เลือกจากหน้า สต็อก (SKU)</p>;
  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">กำลังโหลด…</p>;
  return (
    <div className="min-h-screen bg-muted print:bg-background">
      <style>{`
        @page { size: 80mm 50mm; margin: 0; }
        .sku-label { width: 80mm; height: 50mm; box-sizing: border-box; padding: 3mm; display: flex; gap: 3mm;
          align-items: center; background: #fff; color: #000; page-break-after: always; break-after: page; overflow: hidden; }
        .sku-label:last-child { page-break-after: auto; break-after: auto; }
        @media screen { .sku-label { margin: 0 auto 4mm; box-shadow: 0 1px 3px rgb(0 0 0 / 0.2); } }
      `}</style>
      <div className="mx-auto flex max-w-[80mm] flex-wrap items-center justify-end gap-2 py-3 text-sm print:hidden">
        <span>{labels.length} ป้าย</span>
        <label className="flex items-center gap-1">
          ป้ายละ
          <select
            className="h-9 rounded-md border border-input bg-background px-2"
            value={copies}
            onChange={(e) => setCopies(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n} ดวง
              </option>
            ))}
          </select>
        </label>
        <Button onClick={() => window.print()}>พิมพ์</Button>
      </div>
      {labels.map((k) => (
        <div key={k.key} className="sku-label">
          <QrCode value={k.code} className="h-[38mm] w-[38mm] shrink-0 [&_svg]:h-full [&_svg]:w-full" />
          <div className="min-w-0 flex-1 leading-tight">
            {/* long codes get smaller type so they wrap only at "-" (never mid-part) */}
            <div
              className="font-mono font-bold [overflow-wrap:anywhere]"
              style={{ fontSize: k.code.length <= 10 ? "15pt" : k.code.length <= 14 ? "12pt" : "10pt" }}
            >
              {k.code}
            </div>
            <div className="mt-1 line-clamp-3 text-[8.5pt]">{k.name}</div>
            <div className="mt-1 text-[7.5pt]">
              {[categoryOf(k), k.unit].filter(Boolean).join(" · ")}
            </div>
            <div className="mt-1 text-[7pt] font-semibold">CCSE</div>
          </div>
        </div>
      ))}
    </div>
  );
}
