// User accounts: login names (User ID), the hidden login email behind them, temporary passwords.

/** User ID rules: 3–30 of a-z 0-9 . _ - (stored lower-case). */
export const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;

/**
 * Supabase signs in with an email, so a user created by User ID gets a placeholder email on the
 * company domain until they add and confirm their own. Never shown to people.
 */
export const LOGIN_EMAIL_DOMAIN = "users.ccse-group.com";

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function usernameError(value: string): string | null {
  const u = normalizeUsername(value);
  if (!u) return "กรุณากรอก User ID";
  if (!USERNAME_RE.test(u)) return "User ID ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3–30 ตัว";
  return null;
}

export function loginEmailFor(username: string): string {
  return `${normalizeUsername(username)}@${LOGIN_EMAIL_DOMAIN}`;
}

/** The placeholder email made from a User ID (not a real mailbox). */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${LOGIN_EMAIL_DOMAIN}`);
}

/** What the person typed on the login screen: an email, or a User ID. */
export function looksLikeEmail(login: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login.trim());
}

export const MIN_PASSWORD = 8;

/**
 * The sign-in service (Lovable Cloud) asks for lower case, upper case, a digit and a symbol, so the
 * app checks the same rule first and can say what is missing in Thai.
 */
export const PASSWORD_RULE = "อย่างน้อย 8 ตัว มีตัวพิมพ์เล็ก ตัวพิมพ์ใหญ่ ตัวเลข และสัญลักษณ์ (เช่น ! @ # -)";

/** Each rule with whether `value` meets it — for the live checklist under password fields. */
export function passwordChecks(value: string): { label: string; ok: boolean }[] {
  return [
    { label: `อย่างน้อย ${MIN_PASSWORD} ตัว`, ok: value.length >= MIN_PASSWORD },
    { label: "ตัวพิมพ์เล็ก a-z", ok: /[a-z]/.test(value) },
    { label: "ตัวพิมพ์ใหญ่ A-Z", ok: /[A-Z]/.test(value) },
    { label: "ตัวเลข 0-9", ok: /[0-9]/.test(value) },
    { label: "สัญลักษณ์ เช่น ! @ # -", ok: /[^a-zA-Z0-9]/.test(value) },
  ];
}

export function passwordError(value: string): string | null {
  const missing: string[] = [];
  if (!/[a-z]/.test(value)) missing.push("ตัวพิมพ์เล็ก (a-z)");
  if (!/[A-Z]/.test(value)) missing.push("ตัวพิมพ์ใหญ่ (A-Z)");
  if (!/[0-9]/.test(value)) missing.push("ตัวเลข");
  if (!/[^a-zA-Z0-9]/.test(value)) missing.push("สัญลักษณ์ เช่น ! @ # -");
  if (value.length < MIN_PASSWORD) return `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัว`;
  if (missing.length) return `รหัสผ่านยังขาด: ${missing.join(", ")}`;
  return null;
}

/**
 * Temporary password for a new user or a reset: 12 characters with lower, upper, digit and symbol,
 * no look-alikes (0/O, 1/l/I) and only symbols that are easy to read out.
 */
export function generatePassword(random: (n: number) => number = cryptoRandom): string {
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const symbols = "!@#$%*-_?";
  const all = lower + upper + digits + symbols;
  const pick = (set: string) => set[random(set.length)]!;
  const out = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  while (out.length < 12) out.push(pick(all));
  // shuffle so the letter / digit are not always first
  for (let i = out.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out.join("");
}

function cryptoRandom(n: number): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] ?? 0) % n;
}
