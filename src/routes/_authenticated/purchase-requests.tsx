import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/AppLayout";

export const Route = createFileRoute("/_authenticated/purchase-requests")({
  head: () => ({
    meta: [
      { title: "ใบขอซื้อ | CCSE ERP" },
      { name: "description", content: "จัดการใบขอซื้อวัสดุ CCSE" },
      { property: "og:title", content: "ใบขอซื้อ | CCSE ERP" },
      { property: "og:description", content: "จัดการใบขอซื้อวัสดุ CCSE" },
    ],
  }),
  component: () => (
    <div>
      <PageHeader title="ใบขอซื้อ" />
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        ส่วนนี้ยังไม่เปิดใช้งาน — จะพัฒนาในขั้นถัดไป
      </div>
    </div>
  ),
});
