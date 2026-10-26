import { supabase } from "@/integrations/supabase/client";

/** Signed in with the password, but the account has 2-step codes and this session has not given one. */
export async function needsSecondStep(): Promise<boolean> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.nextLevel === "aal2" && data.currentLevel !== "aal2";
}

/** Verify a 6-digit authenticator code for the signed-in user's 2-step factor. */
export async function verifySecondStep(code: string): Promise<void> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  const factor = data.totp.find((f) => f.status === "verified");
  if (!factor) throw new Error("ไม่พบรหัส 2 ชั้นของบัญชีนี้");
  const { error: vErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
  if (vErr) throw new Error("รหัสไม่ถูกต้องหรือหมดเวลา ลองรหัสใหม่จากแอป");
}
