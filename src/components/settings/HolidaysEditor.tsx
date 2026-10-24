import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { holidaysKey, useHolidays } from "@/hooks/useHolidays";
import { formatDate } from "@/lib/format";
import { thaiDow } from "@/lib/jobs";

/**
 * Public holidays: not counted as working days (install-day overrun) and shown on the
 * technician schedule. Admin only.
 */
export function HolidaysEditor() {
  const qc = useQueryClient();
  const { data: holidays } = useHolidays();
  const year = new Date().getFullYear();
  const [show, setShow] = useState(year);
  const [f, setF] = useState({ day: "", name: "" });
  const list = [...(holidays ?? new Map()).entries()].filter(([d]) => d.startsWith(String(show)));

  const add = useMutation({
    mutationFn: async () => {
      if (!f.day || !f.name.trim()) throw new Error("ใส่วันที่และชื่อวันหยุด");
      const { error } = await supabase
        .from("public_holidays")
        .upsert({ day: f.day, name: f.name.trim() }, { onConflict: "day" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("บันทึกวันหยุดแล้ว");
      setShow(Number(f.day.slice(0, 4)));
      setF({ day: "", name: "" });
      qc.invalidateQueries({ queryKey: holidaysKey });
    },
    onError: (e: Error) =>
      toast.error(
        /public_holidays|schema cache/i.test(e.message)
          ? "ยังบันทึกไม่ได้ — ให้ Lovable รันไฟล์ docs/sql/crew_schedule_wos.sql ก่อน"
          : e.message,
      ),
  });
  const remove = useMutation({
    mutationFn: async (day: string) => {
      const { error } = await supabase.from("public_holidays").delete().eq("day", day);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: holidaysKey }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="mt-6 max-w-2xl rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">วันหยุดนักขัตฤกษ์</h2>
          <p className="text-xs text-muted-foreground">
            ไม่นับเป็นวันทำงาน (วันติดตั้งจริง / ค่าเกินวัน นับเฉพาะ จันทร์–ศุกร์ ที่ไม่ใช่วันหยุด) และแสดงในตารางงานช่าง
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => setShow(show - 1)}>
            ‹
          </Button>
          <span className="w-14 text-center text-sm font-medium">{show + 543}</span>
          <Button size="sm" variant="outline" onClick={() => setShow(show + 1)}>
            ›
          </Button>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-border text-sm">
        {list.length ? (
          list.map(([day, name]) => (
            <li key={day} className="flex items-center gap-3 py-1.5">
              <span className="w-28 tabular-nums">
                {thaiDow(day)} {formatDate(day)}
              </span>
              <span className="flex-1">{name}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-destructive"
                onClick={() => {
                  if (confirm(`ลบวันหยุด ${formatDate(day)} ${name}?`)) remove.mutate(day);
                }}
              >
                ลบ
              </Button>
            </li>
          ))
        ) : (
          <li className="py-2 text-xs text-muted-foreground">ยังไม่มีวันหยุดในปีนี้</li>
        )}
      </ul>
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Input type="date" className="w-44" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })} />
        <Input
          className="min-w-0 flex-1"
          placeholder="ชื่อวันหยุด เช่น วันปิยมหาราช"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
        />
        <Button size="sm" type="submit" disabled={add.isPending}>
          เพิ่มวันหยุด
        </Button>
      </form>
    </section>
  );
}
