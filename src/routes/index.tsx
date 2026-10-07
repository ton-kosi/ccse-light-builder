import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "CCSE ERP — ระบบบริหารงานไฟสถาปัตยกรรม" },
      {
        name: "description",
        content:
          "ระบบบริหารงานขาย ใบเสนอราคา (BOQ) สูตรการผลิต คลังสินค้า และใบสั่งงาน ของ Chingchai & Sons Engineering",
      },
      { property: "og:title", content: "CCSE ERP — ระบบบริหารงานไฟสถาปัตยกรรม" },
      {
        property: "og:description",
        content: "ใบเสนอราคา BOQ · สูตรการผลิต · คลังสินค้า · ใบสั่งงาน สำหรับงานไฟเฉพาะทาง",
      },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-secondary px-6 text-center">
      <div className="text-sm font-semibold tracking-[0.3em] text-muted-foreground">
        CHINGCHAI &amp; SONS ENGINEERING
      </div>
      <h1 className="mt-4 max-w-2xl text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        ระบบบริหารงาน CCSE
      </h1>
      <p className="mt-3 max-w-xl text-sm text-muted-foreground">
        งานขายและ BOQ · สูตรส่วนประกอบภายใน · คลังสินค้า SKU · ใบสั่งงานผลิตและติดตั้ง
        โดยฝ่ายผลิตและช่างจะไม่เห็นราคาหรือต้นทุน
      </p>
      <Link
        to="/auth"
        className="mt-8 inline-flex items-center justify-center rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        เข้าสู่ระบบ
      </Link>
    </div>
  );
}
