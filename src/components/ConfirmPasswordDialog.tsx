import { createClient } from "@supabase/supabase-js";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** A throwaway browser client (no stored session) used only to check the password again. */
function checkClient() {
  const url = import.meta.env["VITE_SUPABASE_URL"] as string;
  const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string;
  return createClient(url, key, {
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
    auth: { persistSession: false, autoRefreshToken: false, storageKey: "ccse-reauth-check" },
  });
}

/**
 * Signs in once more with the person's own password, the same way the login page does, and hands
 * back that fresh access token as proof for the server tools. `done()` ends that extra session.
 */
export async function getReauthToken(password: string): Promise<{ token: string; done: () => Promise<void> }> {
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!email) throw new Error("ไม่พบบัญชีที่เข้าระบบอยู่ — ออกจากระบบแล้วเข้าใหม่");
  if (!password) throw new Error("กรุณาใส่รหัสผ่าน");
  const client = checkClient();
  const { data: signed, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !signed.session) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "invalid_credentials" || /invalid login credentials/i.test(error?.message ?? ""))
      throw new Error("รหัสผ่านไม่ถูกต้อง");
    if (/rate limit/i.test(error?.message ?? "")) throw new Error("ลองบ่อยเกินไป — รอสักครู่แล้วลองใหม่");
    throw new Error(`ตรวจรหัสผ่านไม่ได้: ${error?.message ?? "ไม่ทราบสาเหตุ"}`);
  }
  return {
    token: signed.session.access_token,
    done: async () => {
      await client.auth.signOut({ scope: "local" });
    },
  };
}

/** True when `password` is the signed-in person's password (for changes the browser saves itself). */
export async function verifyOwnPassword(password: string): Promise<boolean> {
  try {
    const { done } = await getReauthToken(password);
    await done();
    return true;
  } catch {
    return false;
  }
}

/**
 * "Are you sure?" + the person's password, before any change to users, roles or sensitive settings.
 * The password is checked here; `onConfirm` receives a fresh proof token for server tools
 * (browser-only saves can ignore it). Throw from `onConfirm` to keep the dialog open.
 */
export function ConfirmPasswordDialog({
  title,
  children,
  confirmLabel = "ยืนยัน",
  destructive = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: (reauthToken: string) => Promise<void>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    let done: (() => Promise<void>) | null = null;
    try {
      const proof = await getReauthToken(password);
      done = proof.done;
      await onConfirm(proof.token);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
      setPassword("");
    } finally {
      if (done) await done().catch(() => undefined);
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form id="confirm-password" onSubmit={submit} className="space-y-4">
          {children ? <div className="text-sm">{children}</div> : null}
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password-input">ใส่รหัสผ่านของคุณอีกครั้งเพื่อยืนยัน</Label>
            <Input
              id="confirm-password-input"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            ยกเลิก
          </Button>
          <Button
            type="submit"
            form="confirm-password"
            variant={destructive ? "destructive" : "default"}
            disabled={busy || !password}
          >
            {busy ? "กำลังตรวจสอบ..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type AskOptions = { title: string; body?: React.ReactNode; confirmLabel?: string; destructive?: boolean };

/**
 * Drop-in password check for existing save handlers:
 * `if (!(await askPassword({ title: "…" }))) return;` — resolves true only after the password
 * was re-entered correctly; render `passwordDialog` once in the component.
 */
export function usePasswordConfirm() {
  const [ask, setAsk] = useState<AskOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const askPassword = useCallback((opts: AskOptions) => {
    resolver.current?.(false);
    setAsk(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const finish = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setAsk(null);
  };

  const passwordDialog = ask ? (
    <ConfirmPasswordDialog
      title={ask.title}
      confirmLabel={ask.confirmLabel ?? "ยืนยัน"}
      destructive={!!ask.destructive}
      onConfirm={async () => {
        resolver.current?.(true);
        resolver.current = null;
      }}
      onClose={() => finish(false)}
    >
      {ask.body}
    </ConfirmPasswordDialog>
  ) : null;

  return { askPassword, passwordDialog };
}

/** Thrown when the person closes the password check; callers skip their error toast for it. */
export class Cancelled extends Error {
  constructor() {
    super("ยกเลิกแล้ว");
  }
}
export const isCancelled = (e: unknown): boolean => e instanceof Cancelled;
