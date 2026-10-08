const DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const UNITS = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

/** Reads a non-negative integer below one million. */
function readUnderMillion(n: number): string {
  const s = String(n);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i]);
    const pos = s.length - i - 1;
    if (d === 0) continue;
    if (pos === 1 && d === 1) out += "สิบ";
    else if (pos === 1 && d === 2) out += "ยี่สิบ";
    else if (pos === 0 && d === 1 && s.length > 1) out += "เอ็ด";
    else out += DIGITS[d] + UNITS[pos];
  }
  return out;
}

function readInt(n: number): string {
  if (n === 0) return "ศูนย์";
  const parts: string[] = [];
  let rest = n;
  const groups: number[] = [];
  while (rest > 0) {
    groups.unshift(rest % 1_000_000);
    rest = Math.floor(rest / 1_000_000);
  }
  groups.forEach((g, i) => {
    const txt = g ? readUnderMillion(g) : "";
    parts.push(txt + (i < groups.length - 1 ? "ล้าน" : ""));
  });
  return parts.join("");
}

/** Thai baht text, e.g. 10700.5 → "หนึ่งหมื่นเจ็ดร้อยบาทห้าสิบสตางค์". */
export function bahtText(amount: number): string {
  const satangTotal = Math.round(Math.abs(amount) * 100);
  const baht = Math.floor(satangTotal / 100);
  const satang = satangTotal % 100;
  const prefix = amount < 0 ? "ลบ" : "";
  if (satang === 0) return `${prefix}${readInt(baht)}บาทถ้วน`;
  return `${prefix}${baht ? readInt(baht) + "บาท" : ""}${readInt(satang)}สตางค์`;
}
