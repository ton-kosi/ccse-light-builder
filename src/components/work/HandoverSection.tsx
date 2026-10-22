import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Field } from "@/routes/_authenticated/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMe } from "@/hooks/useMe";
import { formatDate } from "@/lib/format";
import { isoDate, JOB_FILES_BUCKET, jobFilePath } from "@/lib/jobs";
import { JobFiles, jobFilesKey, useJobFiles } from "./JobFiles";
import { SignaturePad, type SignaturePadHandle } from "./SignaturePad";

export const handoverKey = (woId: string) => ["handover", woId];

export function useHandover(woId: string) {
  return useQuery({
    queryKey: handoverKey(woId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("handovers")
        .select("*")
        .eq("work_order_id", woId)
        .maybeSingle();
      if (error) {
        if (/does not exist|schema cache/i.test(error.message)) return null;
        throw error;
      }
      if (!data) return null;
      let signatureUrl: string | null = null;
      if (data.signature_path) {
        const { data: s } = await supabase.storage
          .from(JOB_FILES_BUCKET)
          .createSignedUrl(data.signature_path, 60 * 60);
        signatureUrl = s?.signedUrl ?? null;
      }
      return { ...data, signatureUrl };
    },
  });
}

/**
 * ส่งมอบงาน: photos of the finished work, who received it, and the customer's signature
 * (signed on screen, or a photo of the signed paper). Saving closes the work order.
 */
export function HandoverSection({
  woId,
  projectId,
  woStatus,
}: {
  woId: string;
  projectId: string;
  woStatus: string;
}) {
  const qc = useQueryClient();
  const { me, has } = useMe();
  const canHandover = has("admin", "sales", "production", "technician");
  const { data: handover, isLoading } = useHandover(woId);
  const { data: files } = useJobFiles(projectId);
  const pad = useRef<SignaturePadHandle>(null);
  const [f, setF] = useState({ date: isoDate(new Date()), name: "", position: "", note: "" });

  const photos = (files ?? []).filter((x) => x.work_order_id === woId && x.kind === "handover_photo");
  const paper = (files ?? []).filter((x) => x.work_order_id === woId && x.kind === "signed_note");

  const save = useMutation({
    mutationFn: async () => {
      if (!me?.userId) throw new Error("ไม่พบผู้ใช้ที่เข้าสู่ระบบ");
      if (!f.name.trim()) throw new Error("ใส่ชื่อผู้รับมอบงาน");
      if (!photos.length) throw new Error("ถ่ายรูปงานที่เสร็จแล้วอย่างน้อย 1 รูป");
      const blob = await pad.current?.toBlob();
      if (!blob && !paper.length)
        throw new Error("ให้ลูกค้าเซ็นในกรอบ หรืออัปโหลดรูปใบส่งมอบที่เซ็นแล้ว");
      let signature_path: string | null = null;
      if (blob) {
        signature_path = jobFilePath(projectId, woId, "signature.png", crypto.randomUUID());
        const { error } = await supabase.storage
          .from(JOB_FILES_BUCKET)
          .upload(signature_path, blob, { contentType: "image/png" });
        if (error) throw error;
      }
      const { error } = await supabase.from("handovers").insert({
        work_order_id: woId,
        project_id: projectId,
        handover_date: f.date,
        receiver_name: f.name.trim(),
        receiver_position: f.position.trim() || null,
        note: f.note.trim() || null,
        signature_path,
      });
      if (error) {
        if (signature_path) await supabase.storage.from(JOB_FILES_BUCKET).remove([signature_path]);
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("บันทึกการส่งมอบงานแล้ว — ปิดใบสั่งงาน");
      qc.invalidateQueries({ queryKey: handoverKey(woId) });
      qc.invalidateQueries({ queryKey: ["work_order", woId] });
      qc.invalidateQueries({ queryKey: ["work_orders"] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: jobFilesKey(projectId) });
    },
    onError: (e: Error) =>
      toast.error(
        /handovers.*does not exist|schema cache|bucket not found/i.test(e.message)
          ? "ยังบันทึกส่งมอบงานไม่ได้ — ให้ Lovable รันไฟล์ docs/sql/field_work_handover.sql ก่อน"
          : e.message,
      ),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">กำลังโหลด…</p>;

  if (handover) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="text-sm">
            <div className="font-semibold text-success">ส่งมอบงานแล้ว {formatDate(handover.handover_date)}</div>
            <div>
              ผู้รับมอบ: {handover.receiver_name}
              {handover.receiver_position ? ` (${handover.receiver_position})` : ""}
            </div>
            {handover.note ? <div className="text-muted-foreground">{handover.note}</div> : null}
          </div>
          <Link
            to="/print/handover/$woId"
            params={{ woId }}
            target="_blank"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm"
          >
            <Printer className="h-4 w-4" /> พิมพ์ใบส่งมอบงาน
          </Link>
        </div>
        {handover.signatureUrl ? (
          <div>
            <div className="text-xs text-muted-foreground">ลายเซ็นลูกค้า</div>
            <img
              src={handover.signatureUrl}
              alt="ลายเซ็นลูกค้า"
              className="mt-1 h-24 rounded border border-border bg-white"
            />
          </div>
        ) : null}
        <JobFiles projectId={projectId} workOrderId={woId} kind="handover_photo" canUpload={canHandover} />
        <JobFiles projectId={projectId} workOrderId={woId} kind="signed_note" canUpload={canHandover} />
      </div>
    );
  }

  if (!canHandover) return <p className="text-sm text-muted-foreground">ยังไม่ได้ส่งมอบงาน</p>;
  if (woStatus === "draft" || woStatus === "cancelled")
    return (
      <p className="text-sm text-muted-foreground">
        ส่งมอบงานได้เมื่อใบสั่งงานปล่อยแล้ว (สถานะ “ปล่อยงานแล้ว” หรือ “กำลังทำ”)
      </p>
    );

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <JobFiles
        projectId={projectId}
        workOrderId={woId}
        kind="handover_photo"
        title="1. รูปงานที่ติดตั้งเสร็จ *"
        hint="ถ่ายให้เห็นงานทั้งหมด อย่างน้อย 1 รูป"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="2. ชื่อผู้รับมอบงาน (ลูกค้า) *">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="ตำแหน่ง">
          <Input value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} />
        </Field>
        <Field label="วันที่ส่งมอบ">
          <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="หมายเหตุ (ถ้ามี)" className="sm:col-span-3">
          <Textarea
            rows={2}
            value={f.note}
            placeholder="เช่น งานเรียบร้อย / มีจุดที่ต้องกลับมาแก้"
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
        </Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-medium">3. ลูกค้าเซ็นรับงาน</div>
          <SignaturePad ref={pad} />
        </div>
        <JobFiles
          projectId={projectId}
          workOrderId={woId}
          kind="signed_note"
          title="หรือ รูปใบส่งมอบที่ลูกค้าเซ็นบนกระดาษ"
          hint="ใช้แทนการเซ็นบนจอได้"
        />
      </div>
      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? "กำลังบันทึก…" : "บันทึกส่งมอบงาน"}
      </Button>
    </form>
  );
}
