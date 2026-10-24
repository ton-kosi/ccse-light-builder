/** Deleting a project (admin): the database cascades its rows; the stored files go here too. */
import { supabase } from "@/integrations/supabase/client";
import { JOB_FILES_BUCKET } from "@/lib/jobs";

const SLIPS_BUCKET = "payment-slips";

/** Every stored file that belongs to the project, per bucket. */
export async function projectFilePaths(projectId: string) {
  const [files, handovers, bills, receipts] = await Promise.all([
    supabase.from("job_files").select("path").eq("project_id", projectId),
    supabase.from("handovers").select("signature_path").eq("project_id", projectId),
    supabase.from("billing_docs").select("pdf_path").eq("project_id", projectId),
    supabase
      .from("payment_receipts")
      .select("slip_path, payment_terms!inner(quotations!inner(project_id))")
      .eq("payment_terms.quotations.project_id", projectId),
  ]);
  for (const r of [files, handovers, bills, receipts]) if (r.error) throw r.error;
  const clean = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
  return {
    [JOB_FILES_BUCKET]: clean([
      ...(files.data ?? []).map((f) => f.path),
      ...(handovers.data ?? []).map((h) => h.signature_path),
    ]),
    [SLIPS_BUCKET]: clean([
      ...(bills.data ?? []).map((b) => b.pdf_path),
      ...(receipts.data ?? []).map((r) => r.slip_path),
    ]),
  } as Record<string, string[]>;
}

/**
 * Deletes the project first (nothing breaks if file removal fails afterwards), then its files.
 * Returns how many files were removed and how many could not be.
 */
export async function deleteProjectWithFiles(projectId: string) {
  // issued bills (even cancelled ones) are financial records: the database keeps the project
  const { count: bills, error: billErr } = await supabase
    .from("billing_docs")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId);
  if (billErr) throw billErr;
  if (bills)
    throw new Error(
      `ลบไม่ได้ — โปรเจกต์นี้ออกใบเบิกเงินแล้ว ${bills} ใบ (เอกสารการเงินต้องเก็บไว้) ให้เปลี่ยนสถานะเป็น "11 ปิดงาน" แทน`,
    );
  const paths = await projectFilePaths(projectId);
  const { data, error } = await supabase.from("projects").delete().eq("id", projectId).select("id");
  if (error) throw error;
  // RLS hides rows it refuses to delete instead of raising an error
  if (!data?.length) throw new Error("ลบโปรเจกต์ไม่ได้ — เฉพาะผู้ดูแลระบบเท่านั้น");
  let removed = 0;
  let left = 0;
  for (const [bucket, list] of Object.entries(paths)) {
    for (let i = 0; i < list.length; i += 100) {
      const chunk = list.slice(i, i + 100);
      const { data: gone } = await supabase.storage.from(bucket).remove(chunk);
      removed += gone?.length ?? 0;
      left += chunk.length - (gone?.length ?? 0);
    }
  }
  return { removed, left };
}
