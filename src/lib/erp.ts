export type AppRole = "ceo" | "sales" | "production" | "technician";

export const ROLE_LABELS: Record<AppRole, string> = {
  ceo: "ผู้บริหาร (CEO)",
  sales: "ฝ่ายขาย",
  production: "ฝ่ายผลิต",
  technician: "ช่างติดตั้ง",
};

export const PROJECT_STATUSES: { value: number; label: string }[] = [
  { value: 1, label: "1 ขอราคา" },
  { value: 2, label: "2 เก็บข้อมูล/ถอดแบบ" },
  { value: 3, label: "3 ทำ BOQ" },
  { value: 4, label: "4 ได้ PO" },
  { value: 5, label: "5 รอมัดจำ" },
  { value: 6, label: "6 ปล่อยใบ Work" },
  { value: 7, label: "7 ผลิต" },
  { value: 8, label: "8 ติดตั้ง" },
  { value: 9, label: "9 ส่งมอบ" },
  { value: 10, label: "10 วางบิล" },
  { value: 11, label: "11 ปิดงาน" },
];

export function statusLabel(status: number): string {
  return PROJECT_STATUSES.find((s) => s.value === status)?.label ?? String(status);
}

export const WO_STATUSES: { value: string; label: string }[] = [
  { value: "draft", label: "ร่าง" },
  { value: "released", label: "ปล่อยงานแล้ว" },
  { value: "in_progress", label: "กำลังทำ" },
  { value: "done", label: "เสร็จสิ้น" },
  { value: "cancelled", label: "ยกเลิก" },
];

export function woStatusLabel(status: string): string {
  return WO_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export const WO_TYPES: { value: string; label: string }[] = [
  { value: "production", label: "ผลิต" },
  { value: "installation", label: "ติดตั้ง" },
  { value: "service", label: "บริการ/ซ่อม" },
];

export function woTypeLabel(t: string): string {
  return WO_TYPES.find((x) => x.value === t)?.label ?? t;
}

export const RELEASE_MIN_STATUS = 6;
