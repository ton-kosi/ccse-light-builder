import { supabase } from "@/integrations/supabase/client";
import { fetchAll } from "./fetchAll";

/**
 * Every payment term of every project (payment_schedule with no project). One request returns at most
 * 1,000 rows and there are more terms than that since the jobs import (17/11/2026), so read it page by page,
 * in a fixed order so pages don't overlap.
 */
export function allPaymentSchedule() {
  return fetchAll((from, to) => supabase.rpc("payment_schedule", {}).order("id").range(from, to));
}
