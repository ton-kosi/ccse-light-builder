import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { useMe } from "@/hooks/useMe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "ตั้งค่า | CCSE ERP" },
      { name: "description", content: "ตั้งค่าระบบ CCSE ERP" },
      { property: "og:title", content: "ตั้งค่า | CCSE ERP" },
      { property: "og:description", content: "ตั้งค่าระบบ CCSE ERP" },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { isAdmin } = useMe();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("*").maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const [minRemnant, setMinRemnant] = useState("");
  const [bank, setBank] = useState({ bank_name: "", bank_branch: "", bank_account_name: "", bank_account_no: "" });
  useEffect(() => {
    if (!data) return;
    setMinRemnant(String(data.min_remnant_m));
    setBank({
      bank_name: data.bank_name ?? "", bank_branch: data.bank_branch ?? "",
      bank_account_name: data.bank_account_name ?? "", bank_account_no: data.bank_account_no ?? "",
    });
  }, [data]);

  async function saveBank() {
    const patch = {
      bank_name: bank.bank_name.trim() || null, bank_branch: bank.bank_branch.trim() || null,
      bank_account_name: bank.bank_account_name.trim() || null, bank_account_no: bank.bank_account_no.trim() || null,
    };
    const { error } = await supabase.from("settings").update(patch).eq("id", true);
    if (error) { toast.error(error.message); return; }
    toast.success("บันทึกบัญชีธนาคารแล้ว");
    qc.invalidateQueries({ queryKey: ["settings"] });
  }

  async function save() {
    const v = Number(minRemnant);
    if (!Number.isFinite(v) || v < 0) {
      toast.error("กรุณากรอกตัวเลขที่ถูกต้อง");
      return;
    }
    const { error } = await supabase.from("settings").update({ min_remnant_m: v }).eq("id", true);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("บันทึกแล้ว");
    qc.invalidateQueries({ queryKey: ["settings"] });
  }

  if (!isAdmin) {
    return <p className="text-sm text-muted-foreground">หน้านี้เฉพาะผู้ดูแลระบบ (admin) เท่านั้น</p>;
  }

  return (
    <div>
      <PageHeader title="ตั้งค่า" />
      <div className="max-w-md rounded-lg border border-border bg-card p-4">
        <Label htmlFor="min_remnant">ความยาวเศษม้วนขั้นต่ำที่เก็บเข้าคลัง (เมตร)</Label>
        <div className="mt-2 flex gap-2">
          <Input
            id="min_remnant"
            type="number"
            step="0.1"
            min="0"
            value={minRemnant}
            onChange={(e) => setMinRemnant(e.target.value)}
          />
          <Button onClick={save}>บันทึก</Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          เศษที่สั้นกว่าค่านี้จะไม่ถูกบันทึกเป็นเศษม้วน
        </p>
      </div>
      <div className="mt-6 max-w-md space-y-3 rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">บัญชีธนาคารสำหรับรับเงิน (แสดงในใบเบิกเงิน)</h2>
        {([
          ["bank_name", "ธนาคาร"], ["bank_branch", "สาขา"], ["bank_account_name", "ชื่อบัญชี"], ["bank_account_no", "เลขที่บัญชี"],
        ] as const).map(([k, label]) => (
          <div key={k}>
            <Label htmlFor={k}>{label}</Label>
            <Input id={k} className="mt-1" value={bank[k]} onChange={(e) => setBank({ ...bank, [k]: e.target.value })} />
          </div>
        ))}
        <Button onClick={saveBank}>บันทึกบัญชีธนาคาร</Button>
      </div>
    </div>
  );
}
