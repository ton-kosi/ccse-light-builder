import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Wrench } from "lucide-react";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TICKET_STATUSES, TicketDialog, TicketRow, useTickets } from "@/components/repairs/Repairs";
import { useMe } from "@/hooks/useMe";

export const Route = createFileRoute("/_authenticated/repairs")({
  head: () => ({
    meta: [
      { title: "งานซ่อม | CCSE ERP" },
      { name: "description", content: "ใบแจ้งซ่อม ตรวจประกันอัตโนมัติ ลงคิวช่าง หรือเสนอราคาใหม่เมื่อหมดประกัน" },
      { property: "og:title", content: "งานซ่อม | CCSE ERP" },
      { property: "og:description", content: "ใบแจ้งซ่อมของ CCSE" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RepairsPage,
});

const OPEN = ["open", "scheduled", "quoted"];

function RepairsPage() {
  const { canPlanWork } = useMe();
  const { data: tickets, isLoading } = useTickets();
  const [status, setStatus] = useState("active");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const term = q.trim().toLowerCase();
  const list = (tickets ?? []).filter(
    (t) =>
      (status === "all" || (status === "active" ? OPEN.includes(t.status) : t.status === status)) &&
      (!term ||
        [t.ticket_no, t.problem, t.reporter, t.projects?.code, t.projects?.name].some((x) => x?.toLowerCase().includes(term))),
  );

  return (
    <div>
      <PageHeader
        title="งานซ่อม"
        description="รับแจ้งซ่อม → ตรวจประกันอัตโนมัติ → ในประกัน: ลงคิวช่าง (และฝ่ายผลิต) · หมดประกัน: เสนอราคาใหม่"
        actions={
          canPlanWork ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Wrench className="h-4 w-4" /> แจ้งซ่อมใหม่
            </Button>
          ) : null
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="ค้นหาเลขที่ / งาน / อาการ" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">ยังไม่ปิด</option>
          <option value="all">ทั้งหมด</option>
          {TICKET_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">กำลังโหลด…</p>
      ) : list.length ? (
        <ul className="space-y-2">
          {list.map((t) => (
            <TicketRow key={t.id} t={t} />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">ไม่มีใบแจ้งซ่อม</p>
      )}
      {open ? <TicketDialog onClose={() => setOpen(false)} /> : null}
    </div>
  );
}
