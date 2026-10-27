import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { ConfirmPasswordDialog, verifyOwnPassword } from "@/components/ConfirmPasswordDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMe } from "@/hooks/useMe";
import { isPlaceholderEmail, looksLikeEmail, passwordError } from "@/lib/accounts";
import { ROLE_LABELS } from "@/lib/erp";

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({ meta: [{ title: "บัญชีของฉัน | CCSE ERP" }] }),
  component: AccountPage,
});

function AccountPage() {
  const { me, roles } = useMe();
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="บัญชีของฉัน" description="รหัสผ่าน อีเมล และรหัส 2 ชั้นของคุณ" />
      {me?.mustChangePassword ? (
        <p className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
          รหัสผ่านนี้ผู้ดูแลระบบตั้งให้ — ตั้งรหัสผ่านใหม่ของคุณเองก่อนเริ่มใช้งาน
        </p>
      ) : null}
      <section className="rounded-lg border border-border bg-card p-4 text-sm">
        <div className="grid gap-2 sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">ชื่อ</div>
            <div className="font-medium">{me?.fullName || "-"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">User ID</div>
            <div className="font-mono">{me?.username ?? "-"}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">สิทธิ์</div>
            <div>{roles.length ? roles.map((r) => ROLE_LABELS[r]).join(" · ") : "-"}</div>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">เปลี่ยนชื่อ User ID หรือสิทธิ์ได้ที่ผู้ดูแลระบบ</p>
      </section>
      <PasswordSection />
      {me?.mustChangePassword ? null : (
        <>
          <EmailSection />
          <TwoStepSection />
        </>
      )}
    </div>
  );
}

function PasswordSection() {
  const qc = useQueryClient();
  const { me } = useMe();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = passwordError(next) ?? (next !== again ? "รหัสผ่านใหม่สองช่องไม่ตรงกัน" : null);
    if (err) {
      toast.error(err);
      return;
    }
    if (next === current) {
      toast.error("รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม");
      return;
    }
    setBusy(true);
    try {
      if (!(await verifyOwnPassword(current))) throw new Error("รหัสผ่านปัจจุบันไม่ถูกต้อง");
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
      if (me?.userId) await supabase.from("profiles").update({ must_change_password: false }).eq("id", me.userId);
      await qc.invalidateQueries({ queryKey: ["me"] });
      setCurrent("");
      setNext("");
      setAgain("");
      toast.success("เปลี่ยนรหัสผ่านแล้ว");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เปลี่ยนรหัสผ่านไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">เปลี่ยนรหัสผ่าน</h2>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="pw-current">รหัสผ่านปัจจุบัน</Label>
          <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw-next">รหัสผ่านใหม่</Label>
          <Input id="pw-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw-again">พิมพ์รหัสใหม่อีกครั้ง</Label>
          <Input id="pw-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
        </div>
        <p className="text-xs text-muted-foreground sm:col-span-2">อย่างน้อย 8 ตัว มีทั้งตัวอักษรและตัวเลข</p>
        <div className="sm:text-right">
          <Button type="submit" disabled={busy}>
            {busy ? "กำลังบันทึก..." : "บันทึกรหัสใหม่"}
          </Button>
        </div>
      </form>
    </section>
  );
}

function EmailSection() {
  const { data: user, refetch } = useQuery({
    queryKey: ["auth_user"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
  });
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const current = user?.email && !isPlaceholderEmail(user.email) ? user.email : null;
  const pending = user?.new_email && !isPlaceholderEmail(user.new_email) ? user.new_email : null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = email.trim().toLowerCase();
    if (!looksLikeEmail(v)) {
      toast.error("อีเมลไม่ถูกต้อง");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser(
        { email: v },
        { emailRedirectTo: `${window.location.origin}/account` },
      );
      if (error) throw error;
      setEmail("");
      await refetch();
      toast.success(`ส่งลิงก์ยืนยันไปที่ ${v} แล้ว — เปิดอีเมลแล้วกดลิงก์`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกอีเมลไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-1 text-sm font-semibold">อีเมล</h2>
      <p className="mb-3 text-sm">
        {current ? (
          <>
            ใช้เข้าระบบได้: <b>{current}</b>
          </>
        ) : (
          <span className="text-muted-foreground">ยังไม่มีอีเมล — ใส่อีเมลเพื่อเข้าระบบด้วยอีเมลได้ด้วย</span>
        )}
        {pending ? <span className="block text-xs text-muted-foreground">รอยืนยัน: {pending} (เปิดอีเมลแล้วกดลิงก์)</span> : null}
      </p>
      <form onSubmit={save} className="flex flex-wrap items-end gap-2">
        <div className="min-w-64 flex-1 space-y-1.5">
          <Label htmlFor="new-email">{current ? "เปลี่ยนเป็นอีเมลใหม่" : "อีเมลของคุณ"}</Label>
          <Input id="new-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? "กำลังส่ง..." : "ส่งลิงก์ยืนยัน"}
        </Button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">
        ไม่ได้รับอีเมลภายในไม่กี่นาที → ดูในถังขยะ หรือให้ผู้ดูแลระบบใส่อีเมลให้ที่หน้า ผู้ใช้และสิทธิ์
      </p>
    </section>
  );
}

function TwoStepSection() {
  const { data: factors, refetch } = useQuery({
    queryKey: ["mfa_factors"],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return data;
    },
  });
  const [enroll, setEnroll] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const active = factors?.totp.find((f) => f.status === "verified");

  const start = async () => {
    setBusy(true);
    try {
      // drop a half-finished setup from before
      for (const f of factors?.all ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `CCSE ERP ${Date.now()}` });
      if (error) throw error;
      setEnroll({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "เริ่มตั้งค่าไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enroll) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enroll.id, code: code.trim() });
      if (error) throw new Error("รหัสไม่ถูกต้อง ลองรหัสใหม่จากแอป");
      setEnroll(null);
      setCode("");
      await refetch();
      toast.success("เปิดรหัส 2 ชั้นแล้ว — ครั้งหน้าต้องใส่รหัสจากแอปทุกครั้งที่เข้าระบบ");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ยืนยันไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (enroll) await supabase.auth.mfa.unenroll({ factorId: enroll.id });
    setEnroll(null);
    setCode("");
    await refetch();
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h2 className="mb-1 text-sm font-semibold">รหัส 2 ชั้น (Authenticator)</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        ไม่บังคับ — เปิดแล้วต้องใส่รหัส 6 หลักจากแอปในมือถือ (Google Authenticator, Microsoft Authenticator) ทุกครั้งที่เข้าระบบ
      </p>
      {active ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-success">เปิดใช้อยู่</span>
          <Button variant="outline" onClick={() => setConfirmOff(true)}>
            ปิดรหัส 2 ชั้น
          </Button>
        </div>
      ) : enroll ? (
        <form onSubmit={verify} className="space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>เปิดแอป Authenticator → เพิ่มบัญชี → สแกน QR นี้</li>
            <li>กรอกรหัส 6 หลักที่แอปแสดง แล้วกดยืนยัน</li>
          </ol>
          <img src={enroll.qr} alt="QR สำหรับแอป Authenticator" className="h-44 w-44 rounded border border-border bg-white p-2" />
          <p className="text-xs text-muted-foreground">
            สแกนไม่ได้? พิมพ์รหัสนี้ในแอปแทน: <span className="font-mono">{enroll.secret}</span>
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="enroll-code">รหัส 6 หลัก</Label>
              <Input
                id="enroll-code"
                inputMode="numeric"
                maxLength={6}
                className="w-32 text-center font-mono tracking-[0.3em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <Button type="submit" disabled={busy || code.length !== 6}>
              ยืนยัน
            </Button>
            <Button type="button" variant="ghost" onClick={cancel} disabled={busy}>
              ยกเลิก
            </Button>
          </div>
        </form>
      ) : (
        <Button onClick={start} disabled={busy}>
          {busy ? "กำลังเตรียม..." : "เปิดรหัส 2 ชั้น"}
        </Button>
      )}
      {confirmOff && active ? (
        <ConfirmPasswordDialog
          title="ปิดรหัส 2 ชั้น"
          confirmLabel="ปิดรหัส 2 ชั้น"
          destructive
          onClose={() => setConfirmOff(false)}
          onConfirm={async () => {
            const { error } = await supabase.auth.mfa.unenroll({ factorId: active.id });
            if (error) throw new Error("ปิดไม่ได้ — ออกจากระบบแล้วเข้าใหม่พร้อมรหัส 2 ชั้นก่อน");
            await refetch();
            toast.success("ปิดรหัส 2 ชั้นแล้ว");
          }}
        >
          ครั้งหน้าจะเข้าระบบด้วยรหัสผ่านอย่างเดียว
        </ConfirmPasswordDialog>
      ) : null}
    </section>
  );
}
