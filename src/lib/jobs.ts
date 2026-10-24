/** Field work: job queue (คิวงาน), job files and handover helpers. Dates are yyyy-mm-dd strings. */

export const JOB_FILES_BUCKET = "job-files";

export type JobFileKind = "drawing" | "photo" | "handover_photo" | "signed_note" | "other";

export const JOB_FILE_KINDS: { value: JobFileKind; label: string }[] = [
  { value: "drawing", label: "แบบ / drawing" },
  { value: "photo", label: "รูปหน้างาน" },
  { value: "handover_photo", label: "รูปส่งมอบงาน" },
  { value: "signed_note", label: "ใบส่งมอบที่ลูกค้าเซ็นแล้ว" },
  { value: "other", label: "อื่นๆ" },
];
export const jobFileKindLabel = (k: string) => JOB_FILE_KINDS.find((x) => x.value === k)?.label ?? k;

/** Colour per job type in the queue (token classes from styles.css). */
export const WO_TYPE_CLS: Record<string, string> = {
  survey: "border-l-warning",
  production: "border-l-success",
  installation: "border-l-primary",
  service: "border-l-destructive",
};

const pad = (n: number) => String(n).padStart(2, "0");

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

/** Monday of the week that contains the date. */
export function weekStart(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  return addDaysIso(iso, -dow);
}

export function weekDays(startIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(startIso, i));
}

const THAI_DOW = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
export const thaiDow = (iso: string) => THAI_DOW[new Date(iso + "T00:00:00").getDay()]!;

export type QueueJob = { id: string; scheduled_date: string | null; end_date: string | null };

/** Does the job run on this day? A job without an end date runs on its start date only. */
export function runsOn(job: QueueJob, day: string): boolean {
  if (!job.scheduled_date) return false;
  const end = job.end_date && job.end_date >= job.scheduled_date ? job.end_date : job.scheduled_date;
  return day >= job.scheduled_date && day <= end;
}

/** Jobs per day of the week (a multi-day job appears on every day it runs) + jobs not scheduled yet. */
export function groupByDay<T extends QueueJob>(jobs: T[], days: string[]) {
  const byDay = new Map(days.map((d) => [d, jobs.filter((j) => runsOn(j, d))]));
  const unscheduled = jobs.filter((j) => !j.scheduled_date);
  return { byDay, unscheduled };
}

/** Monday–Friday that is not a public holiday (quotations: not holidays or Saturday–Sunday). */
export function isWorkingDay(iso: string, holidays: ReadonlySet<string> = new Set()): boolean {
  const dow = new Date(iso + "T00:00:00").getDay();
  return dow !== 0 && dow !== 6 && !holidays.has(iso);
}

/**
 * Working days from install start to handover, both counted — the same rule as the database
 * (private.working_days), so the overrun charge matches the quotation's "WORKING DAYS".
 */
export function installDays(
  startIso: string | null,
  handoverIso: string,
  holidays: ReadonlySet<string> = new Set(),
): number | null {
  if (!startIso || handoverIso < startIso) return null;
  let n = 0;
  for (let d = startIso; d <= handoverIso; d = addDaysIso(d, 1)) if (isWorkingDay(d, holidays)) n++;
  return n;
}

/** Storage path for a job file: project / work order (or "project") / random id + safe file name. */
export function jobFilePath(projectId: string, workOrderId: string | null, fileName: string, id: string): string {
  const dot = fileName.lastIndexOf(".");
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  return `${projectId}/${workOrderId ?? "project"}/${id}${ext ? "." + ext : ""}`;
}

export const isImage = (mime: string | null | undefined, name = "") =>
  (mime ?? "").startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(name);
