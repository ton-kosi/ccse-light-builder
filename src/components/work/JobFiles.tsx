import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { toast } from "sonner";
import { FileText, Upload, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/useMe";
import { formatDate } from "@/lib/format";
import {
  isImage,
  JOB_FILES_BUCKET,
  jobFileKindLabel,
  jobFilePath,
  type JobFileKind,
} from "@/lib/jobs";

export const jobFilesKey = (projectId: string) => ["job_files", projectId];

/** Files of a project (and its work orders), with signed URLs to show and open them. */
export function useJobFiles(projectId: string) {
  return useQuery({
    queryKey: jobFilesKey(projectId),
    enabled: !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_files")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) {
        // migration not applied yet: show "no files" instead of failing the page
        if (/does not exist|schema cache/i.test(error.message)) return [];
        throw error;
      }
      if (!data.length) return [];
      const { data: urls } = await supabase.storage
        .from(JOB_FILES_BUCKET)
        .createSignedUrls(
          data.map((f) => f.path),
          60 * 60,
        );
      const byPath = new Map((urls ?? []).map((u) => [u.path, u.signedUrl]));
      return data.map((f) => ({ ...f, url: byPath.get(f.path) ?? null }));
    },
  });
}
export type JobFile = NonNullable<ReturnType<typeof useJobFiles>["data"]>[number];

/** Uploads files into the private bucket and records them; returns the saved rows. */
export async function uploadJobFiles(
  files: File[],
  opts: { projectId: string; workOrderId: string | null; kind: JobFileKind; userId: string },
) {
  const saved = [];
  for (const file of files) {
    const path = jobFilePath(opts.projectId, opts.workOrderId, file.name, crypto.randomUUID());
    const { error: upErr } = await supabase.storage
      .from(JOB_FILES_BUCKET)
      .upload(path, file, file.type ? { contentType: file.type } : {});
    if (upErr) throw new Error(friendlyUpload(upErr.message));
    const { data, error } = await supabase
      .from("job_files")
      .insert({
        project_id: opts.projectId,
        work_order_id: opts.workOrderId,
        kind: opts.kind,
        name: file.name,
        path,
        mime: file.type || null,
        size_bytes: file.size,
        uploaded_by: opts.userId,
      })
      .select("*")
      .single();
    if (error) {
      await supabase.storage.from(JOB_FILES_BUCKET).remove([path]);
      throw new Error(friendlyUpload(error.message));
    }
    saved.push(data);
  }
  return saved;
}

function friendlyUpload(msg: string) {
  if (/bucket not found|job_files.*does not exist|schema cache/i.test(msg))
    return "ยังไม่ได้เปิดที่เก็บไฟล์ — ให้ Lovable รันไฟล์ docs/sql/field_work_handover.sql ก่อน";
  if (/mime|type.*not supported/i.test(msg)) return "รองรับเฉพาะรูปภาพ (JPG/PNG/HEIC) และ PDF";
  if (/size|too large|exceed/i.test(msg)) return "ไฟล์ใหญ่เกิน 20 MB";
  return msg;
}

/**
 * Files of one kind on a project or a work order: thumbnails for images, links for PDF,
 * an upload button (camera on phones) and delete for the uploader or admin.
 */
export function JobFiles({
  projectId,
  workOrderId,
  kind,
  title,
  hint,
  includeProjectFiles,
  canUpload = true,
}: {
  projectId: string;
  /** null = files on the project itself */
  workOrderId: string | null;
  kind: JobFileKind;
  title?: string;
  hint?: string;
  /** on a work order, also show this kind's files that sit on the project (e.g. drawings) */
  includeProjectFiles?: boolean;
  canUpload?: boolean;
}) {
  const qc = useQueryClient();
  const { me, isAdmin } = useMe();
  const input = useRef<HTMLInputElement>(null);
  const { data: all, isLoading } = useJobFiles(projectId);
  const files = (all ?? []).filter(
    (f) =>
      f.kind === kind &&
      (f.work_order_id === workOrderId || (includeProjectFiles && f.work_order_id === null)),
  );

  const upload = useMutation({
    mutationFn: async (list: File[]) => {
      if (!me?.userId) throw new Error("ไม่พบผู้ใช้ที่เข้าสู่ระบบ");
      return uploadJobFiles(list, { projectId, workOrderId, kind, userId: me.userId });
    },
    onSuccess: (rows) => {
      toast.success(`อัปโหลดแล้ว ${rows.length} ไฟล์`);
      qc.invalidateQueries({ queryKey: jobFilesKey(projectId) });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (f: JobFile) => {
      const { error } = await supabase.from("job_files").delete().eq("id", f.id);
      if (error) throw error;
      await supabase.storage.from(JOB_FILES_BUCKET).remove([f.path]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: jobFilesKey(projectId) }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title ?? jobFileKindLabel(kind)}</h3>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        {canUpload ? (
          <>
            <input
              ref={input}
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (list.length) upload.mutate(list);
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={upload.isPending}
              onClick={() => input.current?.click()}
            >
              <Upload className="h-4 w-4" />
              {upload.isPending ? "กำลังอัปโหลด…" : "เพิ่มไฟล์ / ถ่ายรูป"}
            </Button>
          </>
        ) : null}
      </div>

      {isLoading ? (
        <p className="mt-2 text-xs text-muted-foreground">กำลังโหลด…</p>
      ) : files.length ? (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {files.map((f) => (
            <li key={f.id} className="group relative rounded-md border border-border bg-background">
              <a
                href={f.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="block"
                title={f.name}
              >
                {isImage(f.mime, f.name) && f.url ? (
                  <img
                    src={f.url}
                    alt={f.name}
                    loading="lazy"
                    className="aspect-square w-full rounded-t-md object-cover"
                  />
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center rounded-t-md bg-muted">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                <div className="truncate px-2 py-1 text-xs">{f.name}</div>
                <div className="px-2 pb-1 text-[10px] text-muted-foreground">
                  {formatDate(f.created_at)}
                  {f.work_order_id === null && workOrderId ? " · ของโปรเจกต์" : ""}
                </div>
              </a>
              {(isAdmin || f.uploaded_by === me?.userId) && f.work_order_id === workOrderId ? (
                <button
                  type="button"
                  className="absolute right-1 top-1 rounded bg-card/90 p-1 text-destructive opacity-80 hover:opacity-100"
                  title="ลบไฟล์"
                  onClick={() => {
                    if (confirm(`ลบไฟล์ ${f.name}?`)) remove.mutate(f);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">ยังไม่มีไฟล์</p>
      )}
    </div>
  );
}
