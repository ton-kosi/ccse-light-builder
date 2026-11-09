/**
 * Automatic numbers, issued in the database (migration 0034_doc_numbers):
 * quotation ref QC26-11-07-001 (QO for One Engineering; count restarts daily), P/J no 69-048.
 */
import { supabase } from "@/integrations/supabase/client";

/** A number issued by the system or a job number typed in the same style: 69-047, 68-013/1. */
export const isJobNo = (code: string | null | undefined) => /^\d{2}-\d{3,}(\/\d+)?$/.test(code ?? "");
export const isAutoRef = (ref: string | null | undefined) => /^Q[CO]\d{2}-\d{2}-\d{2}-\d{3,}$/.test(ref ?? "");
/** The job a part belongs to: 69-037/1 → 69-037. */
export const jobBase = (code: string) => code.replace(/\/\d+$/, "");

/**
 * Next part of a job (one area or PO of a bigger site, e.g. 69-037/1 INDIAN BRASSERIE at WYNN):
 * 69-037 → 69-037/1, then /2 … after the highest part already used.
 */
export function nextPartCode(code: string, existing: string[]): string {
  const base = jobBase(code);
  const used = existing.map((c) => c.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(\\d+)$`))?.[1]).filter(Boolean).map(Number);
  return `${base}/${Math.max(0, ...used) + 1}`;
}

/** True when the database functions are not there yet (migration still waiting in Lovable). */
export const numbersNotReady = (message: string) => /next_quote_ref|assign_job_no|doc_counters|schema cache|does not exist/i.test(message);

// not in the generated types until Lovable applies the migration
type Rpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
const rpc: Rpc = (fn, args) => (supabase.rpc as unknown as (this: typeof supabase, f: string, a: object) => ReturnType<Rpc>).call(supabase, fn, args);

export async function nextQuoteRef(companyId: string): Promise<string> {
  const { data, error } = await rpc("next_quote_ref", { _company_id: companyId });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function assignJobNo(projectId: string): Promise<string> {
  const { data, error } = await rpc("assign_job_no", { _project_id: projectId });
  if (error) throw new Error(error.message);
  return data as string;
}
