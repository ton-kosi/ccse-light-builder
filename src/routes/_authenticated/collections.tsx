import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Td, Th } from "@/routes/_authenticated/customers";
import { channelLabel, FollowupDialog, useFollowups, type BillRef } from "@/components/payments/Followups";
import { useMe } from "@/hooks/useMe";
import { CHASE_LABEL, chaseList, latestByBill } from "@/lib/collections";
import { formatDate, formatTHB } from "@/lib/format";
import { isoDate } from "@/lib/jobs";

export const Route = createFileRoute("/_authenticated/collections")({
  head: () => ({
    meta: [
      { title: "ทวงเงิน | CCSE ERP" },
      { name: "description", content: "ติดตามใบเบิกเงินค้างชำระ รายการที่ต้องทวงวันนี้ บันทึกการติดตาม และใบทวงถาม" },
      { property: "og:title", content: "ทวงเงิน | CCSE ERP" },
      { property: "og:description", content: "ติดตามการชำระเงินของ CCSE" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CollectionsPage,
});

type Open = BillRef & { project_code: string; due_status: string };

function CollectionsPage() {
  const { canManagePayments } = useMe();
  const today = isoDate(new Date());
  const [open, setOpen] = useState<Open | null>(null);
  const { data: followups } = useFollowups();

  const { data: bills, isLoading } = useQuery({
    queryKey: ["payment_schedule", "all", "collections"],
    enabled: canManagePayments,
    queryFn: async (): Promise<Open[]> => {
      const { data, error } = await supabase.rpc("payment_schedule", {});
      if (error) throw error;
      return (data ?? [])
        .filter((t) => t.bill_id && Number(t.outstanding) > 0.005)
        .map((t) => ({
          bill_id: t.bill_id,
          bill_no: t.bill_no,
          project_id: t.project_id,
          project_code: t.project_code,
          project_name: t.project_name,
          outstanding: Number(t.outstanding),
          due_date: t.due_date,
          days_overdue: t.days_overdue,
          due_status: t.due_status,
        }));
    },
  });

  if (!canManagePayments)
    return <p className="text-sm text-muted-foreground">หน้านี้สำหรับผู้ดูแลระบบและฝ่ายบัญชี</p>;

  const list = bills ?? [];
  const chase = chaseList(list, followups ?? [], today);
  const last = latestByBill(followups ?? []);
  const sorted = [...list].sort((a, b) => (b.days_overdue ?? -1) - (a.days_overdue ?? -1) || (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  const total = list.reduce((s, b) => s + b.outstanding, 0);
  const overdueTotal = list.filter((b) => (b.days_overdue ?? 0) > 0).reduce((s, b) => s + b.outstanding, 0);

  const actions = (b: Open) => (
    <Button size="sm" variant="outline" className="h-8" onClick={() => setOpen(b)}>
      ติดตาม
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="ทวงเงิน"
        description="ใบเบิกเงินที่ยังค้างชำระ · บันทึกการติดตาม วันที่ลูกค้าสัญญาจ่าย และวันติดตามครั้งต่อไป · พิมพ์ใบทวงถาม"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="ค้างชำระทั้งหมด" value={`${formatTHB(total)} บาท`} sub={`${list.length} ใบ`} />
        <Stat label="เกินกำหนด" value={`${formatTHB(overdueTotal)} บาท`} sub={`${list.filter((b) => (b.days_overdue ?? 0) > 0).length} ใบ`} danger />
        <Stat label="ต้องทวงวันนี้" value={`${chase.length} ใบ`} sub={formatDate(today)} danger={chase.length > 0} />
      </div>

      <section>
        <h2 className="mb-2 text-base font-semibold">ต้องทวงวันนี้</h2>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">กำลังโหลด…</p>
        ) : chase.length ? (
          <ul className="space-y-2">
            {chase.map(({ bill: b, last: l, reason }) => (
              <li key={b.bill_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <div>
                  <div className="font-semibold">
                    {b.bill_no} ·{" "}
                    <Link to="/projects/$projectId" params={{ projectId: b.project_id }} className="text-primary hover:underline">
                      {b.project_code} — {b.project_name}
                    </Link>
                  </div>
                  <div className="text-xs">
                    <span className="font-semibold text-destructive">{CHASE_LABEL[reason]}</span>
                    {" · "}ค้าง {formatTHB(b.outstanding)} บาท
                    {b.due_date ? ` · ครบกำหนด ${formatDate(b.due_date)}` : ""}
                    {b.days_overdue ? ` · เกิน ${b.days_overdue} วัน` : ""}
                    {l ? ` · ติดตามล่าสุด ${formatDate(l.followed_on)} (${channelLabel(l.channel)})` : ""}
                  </div>
                </div>
                {actions(b)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">วันนี้ไม่มีรายการที่ต้องทวง</p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-base font-semibold">ค้างชำระทั้งหมด</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted text-left">
              <tr>
                <Th>ใบเบิกเงิน</Th>
                <Th>โปรเจกต์</Th>
                <Th>ครบกำหนด</Th>
                <Th>เกิน (วัน)</Th>
                <Th>ค้างชำระ</Th>
                <Th>ติดตามล่าสุด</Th>
                <Th>สัญญาจ่าย / นัดครั้งต่อไป</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {sorted.length ? (
                sorted.map((b) => {
                  const l = last.get(b.bill_id);
                  return (
                    <tr key={b.bill_id} className="border-t border-border">
                      <Td className="font-mono text-xs">{b.bill_no}</Td>
                      <Td>
                        <Link to="/projects/$projectId" params={{ projectId: b.project_id }} className="text-primary hover:underline">
                          {b.project_code}
                        </Link>{" "}
                        {b.project_name}
                      </Td>
                      <Td className="whitespace-nowrap">{b.due_date ? formatDate(b.due_date) : "-"}</Td>
                      <Td className={"text-right " + ((b.days_overdue ?? 0) > 0 ? "font-semibold text-destructive" : "")}>
                        {b.days_overdue ?? "-"}
                      </Td>
                      <Td className="text-right tabular-nums">{formatTHB(b.outstanding)}</Td>
                      <Td className="text-xs">
                        {l ? (
                          <>
                            {formatDate(l.followed_on)} · {channelLabel(l.channel)}
                          </>
                        ) : (
                          <span className="text-muted-foreground">ยังไม่เคย</span>
                        )}
                      </Td>
                      <Td className="text-xs">
                        {l?.promised_on ? `จ่าย ${formatDate(l.promised_on)}` : ""}
                        {l?.promised_on && l?.next_on ? " · " : ""}
                        {l?.next_on ? `นัด ${formatDate(l.next_on)}` : ""}
                      </Td>
                      <Td>{actions(b)}</Td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <Td colSpan={8}>{isLoading ? "กำลังโหลด…" : "ไม่มีใบเบิกเงินค้างชำระ"}</Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {open ? <FollowupDialog bill={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function Stat({ label, value, sub, danger }: { label: string; value: string; sub?: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"text-lg font-semibold tabular-nums " + (danger ? "text-destructive" : "")}>{value}</div>
      {sub ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
