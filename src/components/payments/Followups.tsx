import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDate, formatTHB } from "@/lib/format";
import { isoDate } from "@/lib/jobs";
import { nextNotice, type Followup } from "@/lib/collections";

export const followupsKey = ["payment_followups"];
export const CHANNELS: { value: string; label: string }[] = [
  { value: "call", label: "โทร" },
  { value: "line", label: "LINE" },
  { value: "email", label: "อีเมล" },
  { value: "visit", label: "เข้าพบ" },
  { value: "letter", label: "ส่งจดหมายทวงถาม" },
  { value: "other", label: "อื่นๆ" },
];
export const channelLabel = (c: string) => CHANNELS.find((x) => x.value === c)?.label ?? c;

export type FollowupRow = Followup & { id: string; contact: string | null; note: string | null };

/** Follow-ups of all bills (or one project's); empty until the migration is applied. */
export function useFollowups(projectId?: string) {
  return useQuery({
    queryKey: [...followupsKey, projectId ?? "all"],
    queryFn: async (): Promise<FollowupRow[]> => {
      let q = supabase
        .from("payment_followups")
        .select("id, bill_id, followed_on, created_at, next_on, promised_on, channel, contact, note")
        .order("followed_on", { ascending: false })
        .order("created_at", { ascending: false });
      if (projectId) q = q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) {
        if (/does not exist|schema cache/i.test(error.message)) return [];
        throw error;
      }
      return data as FollowupRow[];
    },
  });
}

export type BillRef = {
  bill_id: string;
  project_id: string;
  bill_no: string;
  project_name: string;
  outstanding: number;
  due_date: string | null;
  days_overdue: number | null;
};

/** History of one bill + log a new follow-up + print the next reminder letter. */
export function FollowupDialog({ bill, onClose }: { bill: BillRef; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: all } = useFollowups();
  const history = (all ?? []).filter((f) => f.bill_id === bill.bill_id);
  const notice = nextNotice(all ?? [], bill.bill_id);
  const [f, setF] = useState({ followed_on: isoDate(new Date()), channel: "call", contact: "", note: "", promised_on: "", next_on: "" });

  const save = useMutation({
    mutationFn: async () => {
      if (!f.note.trim() && !f.promised_on && !f.next_on) throw new Error("ใส่สิ่งที่คุยกัน หรือวันที่นัด");
      const { error } = await supabase.from("payment_followups").insert({
        bill_id: bill.bill_id,
        project_id: bill.project_id,
        followed_on: f.followed_on,
        channel: f.channel,
        contact: f.contact.trim() || null,
        note: f.note.trim() || null,
        promised_on: f.promised_on || null,
        next_on: f.next_on || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("บันทึกการติดตามแล้ว");
      qc.invalidateQueries({ queryKey: followupsKey });
      setF({ ...f, contact: "", note: "", promised_on: "", next_on: "" });
    },
    onError: (e: Error) =>
      toast.error(
        /payment_followups|schema cache/i.test(e.message)
          ? "ยังบันทึกไม่ได้ — ให้ Lovable รันไฟล์ docs/sql/payment_followups.sql ก่อน"
          : e.message,
      ),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("payment_followups").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: followupsKey }),
    onError: (e: Error) => toast.error(e.message),
  });
  const sel = "h-9 rounded-md border border-input bg-background px-2 text-sm";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            ติดตามชำระ · {bill.bill_no} · {bill.project_name}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            ค้าง <b>{formatTHB(bill.outstanding)}</b> บาท
            {bill.due_date ? ` · ครบกำหนด ${formatDate(bill.due_date)}` : ""}
            {bill.days_overdue ? <span className="text-destructive"> · เกิน {bill.days_overdue} วัน</span> : null}
          </span>
          <Link
            to="/print/reminder/$billId"
            params={{ billId: bill.bill_id }}
            search={{ notice }}
            target="_blank"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-2.5 text-xs"
          >
            <Printer className="h-3.5 w-3.5" /> ใบทวงถาม {notice === 3 ? "ฉบับสุดท้าย" : `ครั้งที่ ${notice}`}
          </Link>
        </div>

        {history.length ? (
          <ul className="max-h-52 space-y-1 overflow-y-auto text-sm">
            {history.map((h) => (
              <li key={h.id} className="rounded border border-border px-2 py-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {formatDate(h.followed_on)} · {channelLabel(h.channel)}
                    {h.contact ? ` · ${h.contact}` : ""}
                  </span>
                  <button type="button" className="text-xs text-destructive" onClick={() => remove.mutate(h.id)}>
                    ลบ
                  </button>
                </div>
                {h.note ? <div>{h.note}</div> : null}
                <div className="text-xs text-muted-foreground">
                  {h.promised_on ? `สัญญาจ่าย ${formatDate(h.promised_on)}` : ""}
                  {h.promised_on && h.next_on ? " · " : ""}
                  {h.next_on ? `ติดตามครั้งต่อไป ${formatDate(h.next_on)}` : ""}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">ยังไม่เคยติดตาม</p>
        )}

        <div className="space-y-2 rounded-md border border-border p-3">
          <div className="flex flex-wrap gap-2">
            <Input type="date" className="w-40" value={f.followed_on} onChange={(e) => setF({ ...f, followed_on: e.target.value })} />
            <select className={sel} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
              {CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <Input className="min-w-0 flex-1" placeholder="คุยกับใคร" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} />
          </div>
          <Textarea rows={2} placeholder="คุยอะไรกัน" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs">
              <span className="text-muted-foreground">ลูกค้าสัญญาจะจ่ายวันที่</span>
              <Input type="date" className="mt-0.5" value={f.promised_on} onChange={(e) => setF({ ...f, promised_on: e.target.value })} />
            </label>
            <label className="text-xs">
              <span className="text-muted-foreground">ติดตามครั้งต่อไปวันที่</span>
              <Input type="date" className="mt-0.5" value={f.next_on} onChange={(e) => setF({ ...f, next_on: e.target.value })} />
            </label>
          </div>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
            บันทึกการติดตาม
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
