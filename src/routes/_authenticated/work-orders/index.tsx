import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Td, Th } from "@/routes/_authenticated/customers";
import { Input } from "@/components/ui/input";
import { WO_STATUSES, woStatusLabel, woTypeLabel } from "@/lib/erp";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/work-orders/")({
  head: () => ({
    meta: [
      { title: "ใบสั่งงาน | CCSE ERP" },
      { name: "description", content: "ใบสั่งงานผลิตและติดตั้ง พร้อมรายการของที่ต้องเบิก (ไม่มีราคา)" },
      { property: "og:title", content: "ใบสั่งงาน | CCSE ERP" },
      { property: "og:description", content: "ใบสั่งงานผลิตและติดตั้งของ CCSE" },
    ],
  }),
  component: WorkOrdersPage,
});

function WorkOrdersPage() {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const { data: workOrders, isLoading } = useQuery({
    queryKey: ["work_orders", "list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select("*, projects(code, name, status)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const rows = (workOrders ?? []).filter((w) => {
    if (status && w.status !== status) return false;
    const term = q.trim().toLowerCase();
    if (!term) return true;
    const p = w.projects as { code: string; name: string } | null;
    return (
      w.doc_no.toLowerCase().includes(term) ||
      w.title.toLowerCase().includes(term) ||
      (p?.code ?? "").toLowerCase().includes(term) ||
      (p?.name ?? "").toLowerCase().includes(term)
    );
  });

  return (
    <div>
      <PageHeader
        title="ใบสั่งงาน"
        description="ใบสั่งงานทุกใบไม่แสดงราคาและต้นทุน — ใช้สำหรับฝ่ายผลิตและช่างติดตั้ง"
      />

      <div className="mb-3 flex flex-wrap gap-3">
        <Input
          className="max-w-xs"
          placeholder="ค้นหาเลขที่ / เรื่อง / งาน"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">ทุกสถานะ</option>
          {WO_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <Th>เลขที่</Th>
              <Th>งาน</Th>
              <Th>เรื่อง</Th>
              <Th>ประเภท</Th>
              <Th>กำหนดวันที่</Th>
              <Th>สถานะ</Th>
              <Th>ปล่อยงานเมื่อ</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <Td colSpan={7}>กำลังโหลด...</Td>
              </tr>
            ) : rows.length ? (
              rows.map((w) => {
                const p = w.projects as { code: string; name: string } | null;
                return (
                  <tr key={w.id} className="border-t border-border">
                    <Td className="font-mono text-xs">
                      <Link
                        to="/work-orders/$woId"
                        params={{ woId: w.id }}
                        className="text-primary hover:underline"
                      >
                        {w.doc_no}
                      </Link>
                    </Td>
                    <Td>
                      {p?.code} — {p?.name}
                    </Td>
                    <Td className="font-medium">{w.title || "-"}</Td>
                    <Td>{woTypeLabel(w.wo_type)}</Td>
                    <Td>{w.scheduled_date ? formatDate(w.scheduled_date) : "-"}</Td>
                    <Td>{woStatusLabel(w.status)}</Td>
                    <Td>{w.released_at ? formatDate(w.released_at) : "-"}</Td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <Td colSpan={7}>ยังไม่มีใบสั่งงาน</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
