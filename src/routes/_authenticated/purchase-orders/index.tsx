import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Td, Th } from "@/routes/_authenticated/customers";
import { useMe } from "@/hooks/useMe";
import { fetchAll, matchesSearch } from "@/lib/fetchAll";
import { formatDate, formatTHB } from "@/lib/format";
import { isoDate } from "@/lib/jobs";
import { untypedRpc } from "@/lib/untypedRpc";
import { db, PO_STATUS, poLabel, poTotals, tableMissing, type PoLine, type PurchaseOrder } from "@/lib/purchaseOrders";

export const Route = createFileRoute("/_authenticated/purchase-orders/")({
  head: () => ({
    meta: [
      { title: "ใบสั่งซื้อ | CCSE ERP" },
      { name: "description", content: "ใบสั่งซื้อ (PO) ของ CCSE และ One Engineering" },
      { property: "og:title", content: "ใบสั่งซื้อ | CCSE ERP" },
      { property: "og:description", content: "ใบสั่งซื้อ (PO)" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PurchaseOrdersPage,
});

type Row = PurchaseOrder & { purchase_order_lines: Pick<PoLine, "qty" | "unit_price" | "discount_percent">[]; projects: { code: string } | null };

function PurchaseOrdersPage() {
  const { has } = useMe();
  const allowed = has("admin", "stock");
  const navigate = useNavigate();
  const [company, setCompany] = useState<"all" | "ccse" | "one">("all");
  const [status, setStatus] = useState<"open" | "all" | PurchaseOrder["status"]>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["purchase_orders"],
    enabled: allowed,
    retry: false,
    queryFn: () =>
      fetchAll<Row>((f, t) =>
        db("purchase_orders")
          .select("*, purchase_order_lines(qty, unit_price, discount_percent), projects(code)")
          .order("date", { ascending: false })
          .order("po_no", { ascending: false })
          .range(f, t),
      ),
  });

  const create = useMutation({
    mutationFn: async (companyId: string) => {
      const { data: no, error: e } = await untypedRpc("next_po_no", { _company_id: companyId });
      if (e) throw new Error(e.message);
      const { data: po, error: e2 } = await db("purchase_orders")
        .insert({ company_id: companyId, po_no: no as string, supplier_name: "", status: "draft", date: isoDate(new Date()) })
        .select("id")
        .single();
      if (e2) throw new Error(e2.message);
      return (po as { id: string }).id;
    },
    onSuccess: (id) => navigate({ to: "/purchase-orders/$poId", params: { poId: id } }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!allowed) return <p className="text-sm text-muted-foreground">หน้านี้สำหรับผู้ดูแลระบบและทีมจัดซื้อ</p>;
  if (error && tableMissing((error as Error).message))
    return <p className="text-sm text-muted-foreground">ยังใช้ไม่ได้ — ให้ Lovable รันไฟล์ docs/sql/suppliers_purchase_orders.sql ก่อน</p>;

  const rows = (data ?? [])
    .filter((p) => company === "all" || p.company_id === company)
    .filter((p) => (status === "all" ? true : status === "open" ? p.status === "ordered" || p.status === "draft" : p.status === status))
    .filter((p) => matchesSearch(search, [p.po_no, p.supplier_name, p.run_label, p.projects?.code, p.note]));

  return (
    <div>
      <PageHeader
        title="ใบสั่งซื้อ (PO)"
        description="เลขที่ออกอัตโนมัติ: CCSE 26-061 (ปี ค.ศ.) · ONE 69-093 (ปี พ.ศ.) — รับของจาก PO แล้วเข้าสต็อกและต้นทุนทันที"
        actions={
          <div className="flex gap-2">
            <Button size="sm" disabled={create.isPending} onClick={() => create.mutate("ccse")}>
              + PO CCSE
            </Button>
            <Button size="sm" variant="outline" disabled={create.isPending} onClick={() => create.mutate("one")}>
              + PO ONE
            </Button>
          </div>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={company} onChange={(e) => setCompany(e.target.value as typeof company)}>
          <option value="all">ทุกบริษัท</option>
          <option value="ccse">CCSE</option>
          <option value="one">One Engineering</option>
        </select>
        <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">ทุกสถานะ</option>
          <option value="open">ร่าง / รอของ</option>
          {Object.entries(PO_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <Input className="max-w-xs" placeholder="ค้นหา เลข PO ผู้ขาย งาน" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="text-xs text-muted-foreground">{rows.length} ใบ</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              <Th>PO NO.</Th>
              <Th>วันที่</Th>
              <Th>ผู้ขาย</Th>
              <Th>RUN / งาน</Th>
              <Th>รวม (รวม VAT)</Th>
              <Th>สถานะ</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <Td colSpan={6}>กำลังโหลด…</Td>
              </tr>
            ) : rows.length ? (
              rows.map((p) => {
                const st = PO_STATUS[p.status];
                return (
                  <tr key={p.id} className="border-t border-border">
                    <Td className="whitespace-nowrap font-medium">
                      <Link to="/purchase-orders/$poId" params={{ poId: p.id }} className="text-primary hover:underline">
                        {poLabel(p)}
                      </Link>
                      <div className="text-xs text-muted-foreground">{p.company_id === "one" ? "ONE" : "CCSE"}</div>
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(p.date)}</Td>
                    <Td>{p.supplier_name || <span className="text-muted-foreground">ยังไม่เลือก</span>}</Td>
                    <Td>{p.run_label || p.projects?.code || "-"}</Td>
                    <Td className="text-right tabular-nums">{formatTHB(poTotals(p.purchase_order_lines ?? [], p.vat_percent).total)}</Td>
                    <Td>
                      <span className={"rounded px-1.5 py-0.5 text-xs " + st.cls}>{st.label}</span>
                    </Td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <Td colSpan={6}>ยังไม่มีใบสั่งซื้อ</Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
