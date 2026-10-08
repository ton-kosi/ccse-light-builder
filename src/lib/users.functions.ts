import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const inviteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { email: string; fullName: string; redirectTo: string }) => {
    if (!data?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      throw new Error("กรุณากรอกอีเมลให้ถูกต้อง");
    }
    let redirectTo = "";
    try {
      const url = new URL(data.redirectTo);
      if (url.protocol === "https:" || url.hostname === "localhost") redirectTo = url.origin;
    } catch {
      /* keep empty */
    }
    return {
      email: data.email.trim().toLowerCase(),
      fullName: (data.fullName ?? "").trim(),
      redirectTo,
    };
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
      ...(data.redirectTo ? { redirectTo: data.redirectTo } : {}),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
