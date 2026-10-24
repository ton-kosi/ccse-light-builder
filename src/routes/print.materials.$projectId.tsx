import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useMaterialSummary } from "@/components/work/MaterialSection";
import { formatDate, formatQty } from "@/lib/format";

export const Route = createFileRoute("/print/materials/$projectId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ใบเบิกของ / ใบคืนของ | CCSE ERP" },
      { name: "description", content: "ใบเบิกของหลายครั้งและใบคืนของของโปรเจกต์ ไม่มีราคา" },
      { property: "og:title", content: "ใบเบิกของ / ใบคืนของ | CCSE ERP" },
      { property: "og:description", content: "ใบเบิกของ / ใบคืนของ รูปแบบ A4" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrintMaterials,
});

function PrintMaterials() {
  const { projectId } = Route.useParams();
  const { rows, roundCount, moves, rev, isLoading } = useMaterialSummary(projectId);
  const { data: p } = useQuery({
    queryKey: ["project", projectId, "materials"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("code, name").eq("id", projectId).single();
      if (error) throw error;
      return data;
    },
  });
  if (isLoading) return <p className="p-6 text-sm text-muted-foreground">กำลังโหลด…</p>;
  const returns = moves.filter((m) => m.kind === "return");
  const name = new Map(rows.map((r) => [r.sku.id, r.sku]));
  const th = "border border-foreground px-1.5 py-1 text-left font-semibold";
  const td = "border border-foreground px-1.5 py-0.5 tabular-nums";
  const head = (title: string) => (
    <div className="mb-2 flex items-end justify-between border-b-2 border-foreground pb-1">
      <div>
        <div className="text-base font-bold">{title}</div>
        <div className="text-xs">
          โครงการ: <b>{p?.name}</b>
        </div>
      </div>
      <div className="text-right text-xs">
        <div>P/J No. {p?.code}</div>
        <div>ตามใบ Work Rev {rev ?? "-"}</div>
        <div>พิมพ์ {formatDate(new Date())}</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-muted print:bg-background">
      <style>{`@page { size: A4 landscape; margin: 8mm; } @media print { .mat-print { padding: 0 !important; max-width: none !important; box-shadow: none !important; } .page-break { break-before: page; } }`}</style>
      <div className="mx-auto flex max-w-[297mm] justify-end gap-2 py-3 print:hidden">
        <Button onClick={() => window.print()}>พิมพ์</Button>
      </div>
      <div className="mat-print mx-auto max-w-[297mm] bg-background p-[8mm] text-[11px] text-foreground shadow">
        {head("ใบเบิกของ")}
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th + " w-8"}>ลำดับ</th>
              <th className={th}>รายการเบิก</th>
              <th className={th + " text-right"}>ใบงาน</th>
              <th className={th + " text-right"}>หน้างาน</th>
              {Array.from({ length: Math.max(roundCount, 1) }, (_, i) => (
                <th key={i} className={th + " text-right"}>
                  เบิกครั้งที่ {i + 1}
                </th>
              ))}
              <th className={th + " text-right"}>จำนวนเบิกรวม</th>
              <th className={th + " text-right"}>จำนวนคืนของ</th>
              <th className={th}>หน่วย</th>
              <th className={th + " w-16"}>สโตร์</th>
              <th className={th + " w-16"}>ฝ่ายผลิต</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.sku.id}>
                <td className={td + " text-center"}>{i + 1}</td>
                <td className={td}>
                  {r.sku.code} — {r.sku.name}
                </td>
                <td className={td + " text-right"}>{formatQty(r.wos)}</td>
                <td className={td + " text-right"}>{r.site !== null ? formatQty(r.site) : ""}</td>
                {(r.rounds.length ? r.rounds : [0]).map((q, k) => (
                  <td key={k} className={td + " text-right"}>
                    {q ? formatQty(q) : ""}
                  </td>
                ))}
                <td className={td + " text-right font-semibold"}>{formatQty(r.issued)}</td>
                <td className={td + " text-right"}>{r.returned ? formatQty(r.returned) : ""}</td>
                <td className={td}>{r.sku.unit}</td>
                <td className={td} />
                <td className={td} />
              </tr>
            ))}
          </tbody>
        </table>

        <div className="page-break mt-8">
          {head("ใบคืนของ")}
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th + " w-8"}>ลำดับ</th>
                <th className={th}>รายการคืน</th>
                <th className={th + " text-right"}>จำนวนคืนของ</th>
                <th className={th}>หน่วย</th>
                <th className={th}>Remark</th>
                <th className={th}>วันที่บันทึก</th>
                <th className={th + " w-16"}>สโตร์</th>
                <th className={th + " w-16"}>ฝ่ายผลิต</th>
                <th className={th + " w-24"}>วันที่รับของ</th>
              </tr>
            </thead>
            <tbody>
              {returns.length ? (
                returns.map((m, i) => (
                  <tr key={i}>
                    <td className={td + " text-center"}>{i + 1}</td>
                    <td className={td}>
                      {name.get(m.sku_id)?.code} — {name.get(m.sku_id)?.name}
                    </td>
                    <td className={td + " text-right"}>{formatQty(Number(m.qty))}</td>
                    <td className={td}>{name.get(m.sku_id)?.unit}</td>
                    <td className={td}>{m.note ?? ""}</td>
                    <td className={td}>{formatDate(m.created_at)}</td>
                    <td className={td} />
                    <td className={td} />
                    <td className={td} />
                  </tr>
                ))
              ) : (
                <tr>
                  <td className={td} colSpan={9}>
                    ยังไม่มีการคืนของ
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
