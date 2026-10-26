import { createClient } from "@supabase/supabase-js";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Checks the signed-in person's own password without touching their session (a throwaway client
 * signs in and out). For changes saved straight from the browser; server tools check it again.
 */
export async function verifyOwnPassword(password: string): Promise<boolean> {
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (!email || !password) return false;
  const url = import.meta.env["VITE_SUPABASE_URL"] as string;
  const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] as string;
  const check = createClient(url, key, {
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
  const { error } = await check.auth.signInWithPassword({ email, password });
  if (error) return false;
  await check.auth.signOut({ scope: "local" });
  return true;
}

/**
 * "Are you sure?" + the admin's password, before any change to users, roles or sensitive settings.
 * `onConfirm` gets the password (server tools re-check it); throw to keep the dialog open.
 */
export function ConfirmPasswordDialog({
  title,
  children,
  confirmLabel = "ยืนยัน",
  destructive = false,
  checkInBrowser = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  /** check the password here first (for changes the browser saves itself) */
  checkInBrowser?: boolean;
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    try {
      if (checkInBrowser && !(await verifyOwnPassword(password))) throw new Error("รหัสผ่านไม่ถูกต้อง");
      await onConfirm(password);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "ทำรายการไม่สำเร็จ");
      setPassword("");
    } finally {
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
