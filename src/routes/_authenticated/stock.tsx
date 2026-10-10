import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Td, Th } from "@/routes/_authenticated/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatQty } from "@/lib/format";
import { useMe } from "@/hooks/useMe";
import { categoryOf } from "@/lib/skuCategory";
import { CategoryFilter } from "@/components/stock/CategoryFilter";

export const Route = createFileRoute("/_authenticated/stock")({
  head: () => ({
    meta: [
      { title: "สถานะสต็อกและความต้องการวัสดุ | CCSE ERP" },
      { name: "description", content: "ยอดคงเหลือ ยอดจอง ยอดล็อก และจำนวนที่ต้องสั่งต่อ SKU จากใบเสนอราคาปัจจุบัน" },
      { property: "og:title", content: "สถานะสต็อก | CCSE ERP" },
      { property: "og:description", content: "ภาพรวมสต็อกและจำนวนที่ต้องสั่งซื้อของ CCSE" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StockPage,
});

type Status = "ok" | "order" | "urgent";
const STATUS_RANK: Record<Status, number> = { urgent: 0, order: 1, ok: 2 };

function StockPage() {
  const [search, setSearch] = useState("");
  const { has } = useMe();
  const canPR = has("admin", "stock");
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [cat, setCat] = useState("");

  const { data: skus } = useQuery({
    queryKey: ["skus"],
    queryFn: async () => {
      const { data, error } = await supabase.from("skus").select("*").order("code");
      if (error) throw error;
      return data;
    },
  });
  const { data: onHand } = useQuery({
    queryKey: ["sku_on_hand", "rows"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sku_on_hand").select("*");
      if (error) throw error;
      return data;
    },
  });
  const { data: demand } = useQuery({
    queryKey: ["material_demand"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("material_demand");
      if (error) throw error;
      return data;
    },
  });

  const { data: ordered } = useQuery({
    queryKey: ["purchase_requests", "ordered"],
    queryFn: async () => {
      const { data, error } = await supabase.from("purchase_requests").select("sku_id, qty").eq("status", "ordered");
      if (error) throw error;
      return data;
    },
  });

  const rows = useMemo(() => {
    const oo = new Map<string, number>();
    for (const p of ordered ?? []) oo.set(p.sku_id, (oo.get(p.sku_id) ?? 0) + Number(p.qty));
    const oh = new Map((onHand ?? []).map((r) => [r.sku_id, Number(r.on_hand ?? 0)]));
    const soft = new Map<string, number>();
    const hard = new Map<string, number>();
    for (const d of demand ?? []) {
      const st = Number(d.project_status);
      if (st === 4 || st === 5) soft.set(d.sku_id, (soft.get(d.sku_id) ?? 0) + Number(d.qty));
      else if (st === 6) hard.set(d.sku_id, (hard.get(d.sku_id) ?? 0) + Number(d.qty));
    }
    return (skus ?? []).map((k) => {
      const onHandQty = oh.get(k.id) ?? 0;
      const s = soft.get(k.id) ?? 0;
      const h = hard.get(k.id) ?? 0;
      const onOrder = oo.get(k.id) ?? 0;
      const toOrder = Math.max(0, s + h + Number(k.min_stock) - onHandQty - onOrder);
      const status: Status = toOrder <= 0 ? "ok" : k.source === "import" ? "urgent" : "order";
      return { k, onHandQty, s, h, available: onHandQty - h, onOrder, toOrder, status };
    });
  }, [skus, onHand, demand, ordered]);

  const q = search.trim().toLowerCase();
  const list = rows
    .filter((r) => filter === "all" || r.status === filter)
    .filter((r) => !cat || categoryOf(r.k) === cat)
    .filter((r) => !q || r.k.code.toLowerCase().includes(q) || r.k.name.toLowerCase().includes(q))
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.k.code.localeCompare(b.k.code));

  const count = (s: Status) => rows.filter((r) => r.status === s).length;

  return (
    <div>
      <PageHeader
        title="สต็อก"
        actions={
          <Button asChild variant="outline">
            <Link to="/skus">ทะเบียน SKU / รับ-เบิกของ</Link>
          </Button>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="ค้นหารหัสหรือชื่อ" value={search} onChange={(e) => setSearch(e.target.value)} />
        <CategoryFilter skus={skus ?? []} value={cat} onChange={setCat} />
        {([
          ["all", `ทั้งหมด (${rows.length})`],
          ["urgent", `สั่งด่วน (${count("urgent")})`],
          ["order", `ต้องสั่ง (${count("order")})`],
          ["ok", `พอ (${count("ok")})`],
        ] as const).map(([v, label]) => (
          <Button key={v} size="sm" variant={filter === v ? "default" : "outline"} onClick={() => setFilter(v)}>
            {label}
          </Button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <Th>รหัส</Th>
              <Th>ชื่อสินค้า</Th>
              <Th>หมวด</Th>
              <Th>หน่วย</Th>
              <Th>คงเหลือ</Th>
              <Th>จอง (ขั้น 4–5)</Th>
              <Th>ล็อก (ขั้น 6)</Th>
              <Th>พร้อมใช้</Th>
              <Th>กำลังสั่ง</Th>
              <Th>ขั้นต่ำ</Th>
              <Th>ต้องสั่ง</Th>
              <Th>สถานะ</Th>
              {canPR ? <Th></Th> : null}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.k.id} className="border-t border-border">
                <Td className="font-mono">{r.k.code}</Td>
                <Td>{r.k.name}</Td>
                <Td className="whitespace-nowrap text-xs text-muted-foreground">{categoryOf(r.k)}</Td>
                <Td>{r.k.unit}</Td>
                <Td className="text-right tabular-nums">{formatQty(r.onHandQty)}</Td>
                <Td className="text-right tabular-nums">{formatQty(r.s)}</Td>
                <Td className="text-right tabular-nums">{formatQty(r.h)}</Td>
                <Td className={"text-right tabular-nums " + (r.available < 0 ? "font-semibold text-destructive" : "")}>
                  {formatQty(r.available)}
                </Td>
                <Td className="text-right tabular-nums">{formatQty(r.onOrder)}</Td>
                <Td className="text-right tabular-nums">{formatQty(Number(r.k.min_stock))}</Td>
                <Td className="text-right font-semibold tabular-nums">{r.toOrder > 0 ? formatQty(r.toOrder) : "—"}</Td>
                <Td>
                  {r.status === "ok" ? (
                    <span className="rounded-md bg-success px-2 py-0.5 text-xs font-semibold text-primary-foreground">พอ</span>
                  ) : r.status === "order" ? (
                    <span className="rounded-md bg-warning px-2 py-0.5 text-xs font-semibold text-foreground">ต้องสั่ง</span>
                  ) : (
                    <span className="whitespace-nowrap rounded-md bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground">
                      สั่งด่วน (รอ {r.k.lead_time_days} วัน)
                    </span>
                  )}
                </Td>
                {canPR ? (
                  <Td>
                    <Button asChild size="sm" variant="outline">
                      <Link to="/purchase-requests" search={{ sku: r.k.id, qty: r.toOrder > 0 ? r.toOrder : undefined, kind: r.k.source === "import" ? "import" : "domestic" }}>
                        สร้างใบขอซื้อ
                      </Link>
                    </Button>
                  </Td>
                ) : null}
              </tr>
            ))}
            {list.length === 0 ? (
              <tr><td colSpan={14} className="px-3 py-4 text-muted-foreground">ไม่พบรายการ</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        คำนวณจากใบเสนอราคาปัจจุบันของแต่ละโปรเจกต์ (รายการหลัก + Option ที่ลูกค้าเลือก; ชนิด ราคา/แสดง/FOC) ·
        ต้องสั่ง = MAX(0, จอง + ล็อก + ขั้นต่ำ − คงเหลือ − กำลังสั่ง) · กำลังสั่ง = ใบขอซื้อสถานะ "สั่งแล้ว"
      </p>
    </div>
  );
}
