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
import { CompaniesEditor } from "@/components/settings/CompaniesEditor";

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
  useEffect(() => {
    if (!data) return;
    setMinRemnant(String(data.min_remnant_m));
  }, [data]);

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
    return (
      <p className="text-sm text-muted-foreground">หน้านี้เฉพาะผู้ดูแลระบบ (admin) เท่านั้น</p>
    );
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
      <CompaniesEditor />
    </div>
  );
}
