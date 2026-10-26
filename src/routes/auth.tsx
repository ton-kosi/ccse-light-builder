import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { looksLikeEmail } from "@/lib/accounts";
import { needsSecondStep, verifySecondStep } from "@/lib/mfa";
import { signInWithUsername } from "@/lib/users.functions";

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
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"password" | "code">("password");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      if (await needsSecondStep()) setStep("code");
      else navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (looksLikeEmail(login)) {
        const { error } = await supabase.auth.signInWithPassword({ email: login.trim(), password });
        if (error) throw new Error(/banned/i.test(error.message) ? "บัญชีนี้ถูกปิดการใช้งาน — ติดต่อผู้ดูแลระบบ" : "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
      } else {
        const tokens = await signInWithUsername({ data: { username: login, password } });
        const { error } = await supabase.auth.setSession(tokens);
        if (error) throw error;
      }
      if (await needsSecondStep()) {
        setStep("code");
        return;
      }
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
    } finally {
      setLoading(false);
    }
  }

  async function onCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await verifySecondStep(code);
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-6">
          <div className="text-lg font-bold text-primary">CCSE</div>
          <h1 className="mt-1 text-xl font-semibold">{step === "code" ? "ยืนยันรหัส 2 ชั้น" : "เข้าสู่ระบบ"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {step === "code"
              ? "เปิดแอป Authenticator ในมือถือ แล้วกรอกรหัส 6 หลักของ CCSE ERP"
              : "ระบบบริหารงาน Chingchai & Sons Engineering"}
          </p>
        </div>
        {step === "code" ? (
          <form onSubmit={onCode} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="otp">รหัส 6 หลัก</Label>
              <Input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                className="text-center font-mono text-lg tracking-[0.4em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/D/g, ""))}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading || code.length !== 6}>
              {loading ? "กำลังตรวจสอบ..." : "ยืนยัน"}
            </Button>
            <button
              type="button"
              className="w-full text-center text-xs text-muted-foreground hover:underline"
              onClick={async () => {
                await supabase.auth.signOut();
                setStep("password");
                setCode("");
              }}
            >
              ใช้บัญชีอื่น / ทำมือถือหาย (ให้ผู้ดูแลระบบรีเซ็ตรหัส 2 ชั้น)
            </button>
          </form>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="login">User ID หรืออีเมล</Label>
              <Input
                id="login"
                autoComplete="username"
                autoCapitalize="none"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">รหัสผ่าน</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
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
        )}
        <p className="mt-4 text-center text-xs text-muted-foreground">
          ยังไม่มีบัญชีหรือลืมรหัสผ่าน? ติดต่อผู้ดูแลระบบ
        </p>
      </div>
    </div>
  );
}
