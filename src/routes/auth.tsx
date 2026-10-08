import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { title: "เข้าสู่ระบบ | CCSE ERP" },
      {
        name: "description",
        content: "เข้าสู่ระบบบริหารงานของ Chingchai & Sons Engineering (CCSE)",
      },
      { property: "og:title", content: "เข้าสู่ระบบ | CCSE ERP" },
      {
        property: "og:description",
        content: "ระบบบริหารงานขาย ผลิต และติดตั้งงานไฟของ CCSE",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-6">
          <div className="text-lg font-bold text-primary">CCSE</div>
          <h1 className="mt-1 text-xl font-semibold">เข้าสู่ระบบ</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ระบบบริหารงาน Chingchai &amp; Sons Engineering
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">อีเมล</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">รหัสผ่าน</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "กำลังดำเนินการ..." : "เข้าสู่ระบบ"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          ยังไม่มีบัญชี? ติดต่อผู้ดูแลระบบเพื่อรับคำเชิญ
        </p>
      </div>
    </div>
  );
}
