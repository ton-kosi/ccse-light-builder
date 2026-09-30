import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/AppLayout";

export const Route = createFileRoute("/_authenticated/remnants")({
  head: () => ({
    meta: [
      { title: "เศษม้วน | CCSE ERP" },
      { name: "description", content: "ติดตามเศษม้วนที่ยังใช้ได้ในคลัง CCSE" },
      { property: "og:title", content: "เศษม้วน | CCSE ERP" },
      { property: "og:description", content: "ติดตามเศษม้วนที่ยังใช้ได้ในคลัง CCSE" },
    ],
  }),
  component: () => (
    <div>
      <PageHeader title="เศษม้วน" />
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        ส่วนนี้ยังไม่เปิดใช้งาน — จะพัฒนาในขั้นถัดไป
      </div>
    </div>
  ),
});
