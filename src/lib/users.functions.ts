import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AppRole } from "@/lib/erp";
import {
  isPlaceholderEmail,
  loginEmailFor,
  looksLikeEmail,
  normalizeUsername,
  passwordError,
  usernameError,
} from "@/lib/accounts";

const ROLES: AppRole[] = ["admin", "sales", "estimator", "stock", "production", "accounting", "technician"];

export type AdminUserRow = {
  id: string;
  fullName: string;
  username: string | null;
  /** real email (null while only the placeholder login email exists) */
  email: string | null;
  emailConfirmed: boolean;
  /** an email change waiting for the user to click the link */
  pendingEmail: string | null;
  roles: AppRole[];
  mfa: boolean;
  mustChangePassword: boolean;
  disabled: boolean;
  lastSignIn: string | null;
  createdAt: string;
};

type Ctx = { userId: string; claims: { email?: string; aal?: string } };

/** A throwaway anon client on the server (no stored session) for checking a password. */
async function anonClient() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient(url, key, {
    global: {
      // new publishable keys are not JWTs: send them as apikey only (as the generated clients do)
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
}

/**
 * Proof that the admin just typed their password again: the browser signs in once more (like the
 * login page) and sends that brand-new access token. It must be valid, belong to the same person,
 * come from a password sign-in, and be at most 5 minutes old.
 */
async function reauthValid(userId: string, token: string): Promise<boolean> {
  if (!token || token.split(".").length !== 3) return false;
  const c = await anonClient();
  const { data, error } = await c.auth.getClaims(token);
  const claims = data?.claims as { sub?: string; iat?: number; amr?: { method?: string; timestamp?: number }[] } | undefined;
  if (error || !claims || claims.sub !== userId) return false;
  const now = Date.now() / 1000;
  const pw = (claims.amr ?? []).find((a) => a.method === "password");
  const at = pw?.timestamp ?? claims.iat ?? 0;
  return now - at <= 300;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Signed-in user must be admin; with `reauthToken`, they must also have just re-entered their password. */
async function requireAdmin(ctx: Ctx, reauthToken?: string) {
  const sb = await admin();
  const { data: roleRow } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!roleRow) throw new Error("เฉพาะผู้ดูแลระบบ (admin) เท่านั้น");
  if (reauthToken !== undefined) {
    if (!(await reauthValid(ctx.userId, reauthToken)))
      throw new Error("ยืนยันรหัสผ่านไม่ผ่านหรือหมดเวลา — ใส่รหัสผ่านอีกครั้ง");
    const { data } = await sb.auth.admin.getUserById(ctx.userId);
    const user = data.user;
    const hasMfa = (user?.factors ?? []).some((f) => f.status === "verified");
    if (hasMfa && ctx.claims.aal !== "aal2") throw new Error("กรุณายืนยันรหัส 2 ชั้นก่อนทำรายการนี้");
  }
  return sb;
}

async function adminCount(sb: Awaited<ReturnType<typeof admin>>) {
  const { count } = await sb.from("user_roles").select("user_id", { count: "exact", head: true }).eq("role", "admin");
  return count ?? 0;
}

async function setRoles(sb: Awaited<ReturnType<typeof admin>>, userId: string, roles: AppRole[]) {
  const want = roles.filter((r) => ROLES.includes(r));
  const { data: have } = await sb.from("user_roles").select("role").eq("user_id", userId);
  const current = (have ?? []).map((r) => r.role as AppRole);
  const add = want.filter((r) => !current.includes(r));
  const remove = current.filter((r) => !want.includes(r));
  if (add.length) {
    const { error } = await sb.from("user_roles").insert(add.map((role) => ({ user_id: userId, role })));
    if (error) throw new Error(error.message);
  }
  if (remove.length) {
    const { error } = await sb.from("user_roles").delete().eq("user_id", userId).in("role", remove);
    if (error) throw new Error(error.message);
  }
}

async function usernameTaken(sb: Awaited<ReturnType<typeof admin>>, username: string, exceptId?: string) {
  const { data } = await sb.from("profiles").select("id").eq("username", username);
  return (data ?? []).some((p) => p.id !== exceptId);
}

/** Thai text for sign-in service errors; a refused password says which rule it broke. */
function friendly(error: { message: string; code?: string | undefined; reasons?: string[] | undefined }) {
  const message = error.message;
  if (/already been registered|already exists/i.test(message)) return "อีเมลนี้มีผู้ใช้อยู่แล้ว";
  if (error.code === "weak_password" || (/password/i.test(message) && /weak|short|least|should contain/i.test(message))) {
    const reasons = error.reasons ?? [];
    const why: string[] = [];
    if (reasons.includes("length") || /least|short/i.test(message)) why.push("ยาวไม่พอ");
    if (reasons.includes("characters") || /should contain/i.test(message))
      why.push("ต้องมีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ ตัวเลข และสัญลักษณ์");
    if (reasons.includes("pwned")) why.push("รหัสนี้เคยรั่วไหลในอินเทอร์เน็ต ใช้รหัสอื่น");
    return `ระบบไม่รับรหัสผ่านนี้${why.length ? ": " + why.join(" · ") : ""} (${message})`;
  }
  return message;
}

/* ---------------- list ---------------- */

export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminUserRow[]> => {
    const sb = await requireAdmin(context as Ctx);
    const [{ data: authData, error }, { data: profiles }, { data: roles }] = await Promise.all([
      sb.auth.admin.listUsers({ perPage: 1000 }),
      sb.from("profiles").select("id, full_name, username, must_change_password"),
      sb.from("user_roles").select("user_id, role"),
    ]);
    if (error) throw new Error(error.message);
    const prof = new Map((profiles ?? []).map((p) => [p.id, p]));
    return authData.users
      .map((u) => {
        const p = prof.get(u.id);
        const real = isPlaceholderEmail(u.email) ? null : (u.email ?? null);
        const pending = (u as { new_email?: string }).new_email ?? null;
        const bannedUntil = (u as { banned_until?: string }).banned_until;
        return {
          id: u.id,
          fullName: p?.full_name || (u.user_metadata?.["full_name"] as string | undefined) || "",
          username: p?.username ?? null,
          email: real,
          emailConfirmed: !!real && !!u.email_confirmed_at,
          pendingEmail: pending && !isPlaceholderEmail(pending) ? pending : null,
          roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role as AppRole),
          mfa: (u.factors ?? []).some((f) => f.status === "verified"),
          mustChangePassword: !!p?.must_change_password,
          disabled: !!bannedUntil && new Date(bannedUntil) > new Date(),
          lastSignIn: u.last_sign_in_at ?? null,
          createdAt: u.created_at,
        };
      })
      .sort((a, b) => (a.fullName || a.username || "").localeCompare(b.fullName || b.username || "", "th"));
  });

/* ---------------- create ---------------- */

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { fullName: string; username: string; password: string; roles: AppRole[]; reauthToken: string }) => {
      const err = usernameError(d?.username ?? "") ?? passwordError(d?.password ?? "");
      if (err) throw new Error(err);
      return { ...d, username: normalizeUsername(d.username), fullName: (d.fullName ?? "").trim() };
    },
  )
  .handler(async ({ context, data }) => {
    const sb = await requireAdmin(context as Ctx, data.reauthToken);
    if (await usernameTaken(sb, data.username)) throw new Error(`User ID "${data.username}" มีคนใช้แล้ว`);
    const { data: created, error } = await sb.auth.admin.createUser({
      email: loginEmailFor(data.username),
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (error || !created.user) throw new Error(friendly(error ?? { message: "สร้างผู้ใช้ไม่สำเร็จ" }));
    const id = created.user.id;
    const { error: pErr } = await sb
      .from("profiles")
      .upsert({ id, full_name: data.fullName, username: data.username, must_change_password: true });
    if (pErr) {
      await sb.auth.admin.deleteUser(id);
      throw new Error(pErr.message);
    }
    await setRoles(sb, id, data.roles);
    return { id };
  });

/* ---------------- edit ---------------- */

export const updateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { userId: string; fullName: string; username: string; email: string; roles: AppRole[]; reauthToken: string }) => {
      const err = usernameError(d?.username ?? "");
      if (err) throw new Error(err);
      const email = (d.email ?? "").trim().toLowerCase();
      if (email && !looksLikeEmail(email)) throw new Error("อีเมลไม่ถูกต้อง");
      return { ...d, email, username: normalizeUsername(d.username), fullName: (d.fullName ?? "").trim() };
    },
  )
  .handler(async ({ context, data }) => {
    const ctx = context as Ctx;
    const sb = await requireAdmin(ctx, data.reauthToken);
    if (data.userId === ctx.userId && !data.roles.includes("admin"))
      throw new Error("ถอดสิทธิ์ admin ของตัวเองไม่ได้ — ให้ admin คนอื่นทำ");
    if (await usernameTaken(sb, data.username, data.userId)) throw new Error(`User ID "${data.username}" มีคนใช้แล้ว`);

    const { data: got, error: gErr } = await sb.auth.admin.getUserById(data.userId);
    if (gErr || !got.user) throw new Error("ไม่พบผู้ใช้");
    const current = got.user.email ?? "";
    // email: a real one typed by admin is set as confirmed; empty = keep the User ID placeholder
    const nextEmail = data.email || (isPlaceholderEmail(current) || !current ? loginEmailFor(data.username) : current);
    if (nextEmail !== current) {
      const { error } = await sb.auth.admin.updateUserById(data.userId, { email: nextEmail, email_confirm: true });
      if (error) throw new Error(friendly(error));
    }
    const { error: pErr } = await sb
      .from("profiles")
      .upsert({ id: data.userId, full_name: data.fullName, username: data.username });
    if (pErr) throw new Error(pErr.message);
    await setRoles(sb, data.userId, data.roles);
    return { ok: true };
  });

/* ---------------- reset password / 2FA ---------------- */

export const resetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; newPassword: string; reauthToken: string }) => {
    const err = passwordError(d?.newPassword ?? "");
    if (err) throw new Error(err);
    return d;
  })
  .handler(async ({ context, data }) => {
    const sb = await requireAdmin(context as Ctx, data.reauthToken);
    const { error } = await sb.auth.admin.updateUserById(data.userId, { password: data.newPassword });
    if (error) throw new Error(friendly(error));
    await sb.from("profiles").update({ must_change_password: true }).eq("id", data.userId);
    return { ok: true };
  });

export const resetUserMfa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; reauthToken: string }) => d)
  .handler(async ({ context, data }) => {
    const sb = await requireAdmin(context as Ctx, data.reauthToken);
    const { data: factors, error } = await sb.auth.admin.mfa.listFactors({ userId: data.userId });
    if (error) throw new Error(error.message);
    for (const f of factors.factors) {
      const { error: dErr } = await sb.auth.admin.mfa.deleteFactor({ userId: data.userId, id: f.id });
      if (dErr) throw new Error(dErr.message);
    }
    return { removed: factors.factors.length };
  });

/* ---------------- disable / delete ---------------- */

export const setUserDisabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; disabled: boolean; reauthToken: string }) => d)
  .handler(async ({ context, data }) => {
    const ctx = context as Ctx;
    if (data.userId === ctx.userId) throw new Error("ปิดการใช้งานบัญชีตัวเองไม่ได้");
    const sb = await requireAdmin(ctx, data.reauthToken);
    const { error } = await sb.auth.admin.updateUserById(data.userId, {
      ban_duration: data.disabled ? "876000h" : "none",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; reauthToken: string }) => d)
  .handler(async ({ context, data }) => {
    const ctx = context as Ctx;
    if (data.userId === ctx.userId) throw new Error("ลบบัญชีตัวเองไม่ได้");
    const sb = await requireAdmin(ctx, data.reauthToken);
    const { data: isAdmin } = await sb
      .from("user_roles")
      .select("role")
      .eq("user_id", data.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (isAdmin && (await adminCount(sb)) <= 1) throw new Error("ต้องมี admin อย่างน้อย 1 คน");
    const { error } = await sb.auth.admin.deleteUser(data.userId);
    if (error) {
      // work they recorded still points at them: keep the account, but lock it and drop every role
      const { error: bErr } = await sb.auth.admin.updateUserById(data.userId, { ban_duration: "876000h" });
      if (bErr) throw new Error(error.message);
      await setRoles(sb, data.userId, []);
      return { deleted: false };
    }
    await sb.from("user_roles").delete().eq("user_id", data.userId);
    await sb.from("profiles").delete().eq("id", data.userId);
    return { deleted: true };
  });

/* ---------------- sign in with User ID ---------------- */

/**
 * Login by User ID: look up the account's login email on the server and sign in there, so the
 * email is never sent to the browser; the browser gets the session (same as a normal login).
 */
export const signInWithUsername = createServerFn({ method: "POST" })
  .inputValidator((d: { username: string; password: string }) => ({
    username: normalizeUsername(d?.username ?? ""),
    password: d?.password ?? "",
  }))
  .handler(async ({ data }) => {
    const fail = new Error("User ID หรือรหัสผ่านไม่ถูกต้อง");
    if (usernameError(data.username) || !data.password) throw fail;
    const sb = await admin();
    const { data: prof } = await sb.from("profiles").select("id").eq("username", data.username).maybeSingle();
    if (!prof) throw fail;
    const { data: got } = await sb.auth.admin.getUserById(prof.id);
    const email = got.user?.email;
    if (!email) throw fail;
    const c = await anonClient();
    const { data: signed, error } = await c.auth.signInWithPassword({ email, password: data.password });
    if (error || !signed.session) {
      if (error && /banned/i.test(error.message)) throw new Error("บัญชีนี้ถูกปิดการใช้งาน — ติดต่อผู้ดูแลระบบ");
      throw fail;
    }
    return { access_token: signed.session.access_token, refresh_token: signed.session.refresh_token };
  });
