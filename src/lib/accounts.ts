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

export function passwordError(value: string): string | null {
  if (value.length < MIN_PASSWORD) return `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD} ตัว`;
  if (!/[a-zA-Z]/.test(value) || !/[0-9]/.test(value)) return "รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข";
  return null;
}

/** Temporary password for a new user or a reset: 10 characters, no look-alikes (0/O, 1/l/I). */
export function generatePassword(random: (n: number) => number = cryptoRandom): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const out = [letters[random(letters.length)], digits[random(digits.length)]];
  while (out.length < 10) out.push(all[random(all.length)]);
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
