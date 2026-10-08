import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { email: string; fullName: string }) => {
    if (!data?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      throw new Error("กรุณากรอกอีเมลให้ถูกต้อง");
    }
    return { email: data.email.trim().toLowerCase(), fullName: (data.fullName ?? "").trim() };
  })
  .handler(async ({ context, data }) => {
    const { data: roleRow } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) throw new Error("เฉพาะผู้ดูแลระบบ (admin) เท่านั้นที่เชิญผู้ใช้ได้");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
      data: { full_name: data.fullName },
      redirectTo: process.env["VITE_SUPABASE_URL"] ? undefined : undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
