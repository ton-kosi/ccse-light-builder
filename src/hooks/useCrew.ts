import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type CrewMember = {
  id: string;
  display_name: string;
  crew: string | null;
  sort_order: number;
  user_id: string | null;
  active: boolean;
};
export type ScheduleEntry = {
  id: string;
  member_id: string;
  date_from: string;
  date_to: string;
  kind: "workshop" | "off" | "other";
  note: string | null;
};

export const crewKey = ["crew_members"];
export const crewJobsKey = ["work_order_crew"];
export const scheduleKey = ["schedule_entries"];

const missing = (msg: string) => /does not exist|schema cache/i.test(msg);

/** Technicians / production staff for scheduling (with or without a login), in schedule order. */
export function useCrew() {
  return useQuery({
    queryKey: crewKey,
    queryFn: async (): Promise<CrewMember[]> => {
      const { data, error } = await supabase
        .from("crew_members")
        .select("*")
        .order("crew", { nullsFirst: false })
        .order("sort_order")
        .order("display_name");
      if (error) {
        if (missing(error.message)) return [];
        throw error;
      }
      return data as CrewMember[];
    },
  });
}

/** Who works on each job: work order id → crew member ids. */
export function useCrewJobs() {
  return useQuery({
    queryKey: crewJobsKey,
    queryFn: async () => {
      const { data, error } = await supabase.from("work_order_crew").select("work_order_id, member_id");
      if (error) {
        if (missing(error.message)) return new Map<string, string[]>();
        throw error;
      }
      const map = new Map<string, string[]>();
      for (const a of data) map.set(a.work_order_id, [...(map.get(a.work_order_id) ?? []), a.member_id]);
      return map;
    },
  });
}

/** Non-project schedule cells (workshop, off, other) overlapping a date range. */
export function useScheduleEntries(from: string, to: string) {
  return useQuery({
    queryKey: [...scheduleKey, from, to],
    queryFn: async (): Promise<ScheduleEntry[]> => {
      const { data, error } = await supabase
        .from("schedule_entries")
        .select("id, member_id, date_from, date_to, kind, note")
        .lte("date_from", to)
        .gte("date_to", from);
      if (error) {
        if (missing(error.message)) return [];
        throw error;
      }
      return data as ScheduleEntry[];
    },
  });
}

export const SCHEDULE_KINDS: { value: ScheduleEntry["kind"]; label: string; cls: string }[] = [
  { value: "workshop", label: "CCSE (โรงงาน)", cls: "bg-secondary text-secondary-foreground" },
  { value: "off", label: "พัก / ลา", cls: "bg-muted text-muted-foreground" },
  { value: "other", label: "อื่นๆ", cls: "bg-accent text-accent-foreground" },
];
export const scheduleKindLabel = (k: string) => SCHEDULE_KINDS.find((x) => x.value === k)?.label ?? k;

export const crewMigrationMsg = "ยังบันทึกไม่ได้ — ให้ Lovable รันไฟล์ docs/sql/crew_schedule_wos.sql ก่อน";
export const isCrewMigrationError = (msg: string) =>
  /crew_members|work_order_crew|schedule_entries|schema cache|does not exist/i.test(msg);
