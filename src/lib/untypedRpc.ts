import { supabase } from "@/integrations/supabase/client";

/** A database function not yet in the generated types (its migration still waiting in Lovable). */
export type RpcResult = { data: unknown; error: { message: string } | null };
export const untypedRpc = (fn: string, args: Record<string, unknown>): PromiseLike<RpcResult> =>
  (supabase.rpc as unknown as (this: typeof supabase, f: string, a: object) => PromiseLike<RpcResult>).call(supabase, fn, args);

/** True when the function or table isn't in the database yet. */
export const isMissingInDb = (message: string) => /schema cache|does not exist|Could not find the function/i.test(message);
