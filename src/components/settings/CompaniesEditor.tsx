import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmPasswordDialog } from "@/components/ConfirmPasswordDialog";
import { COMPANIES_KEY, useCompanies, type Company } from "@/lib/companies";
import { toNumber } from "@/lib/format";

type Key = keyof Company;
const FIELDS: { key: Key; label: string; long?: boolean }[] = [
  { key: "name_th", label: "ชื่อบริษัท (ไทย)" },
  { key: "name_en", label: "ชื่อบริษัท (อังกฤษ)" },
  { key: "short_en", label: "ชื่อย่อท้ายใบเสนอราคา (FAITHFULLY YOURS)" },
  { key: "tax_id", label: "เลขประจำตัวผู้เสียภาษี" },
  { key: "address_th", label: "ที่อยู่ (ไทย) — ท้ายกระดาษ", long: true },
  { key: "address_en", label: "ที่อยู่ (อังกฤษ) — ท้ายกระดาษ", long: true },
  { key: "contact_line", label: "โทร / แฟกซ์ / เว็บ — ท้ายกระดาษ" },
  { key: "bank_name_en", label: "Bank" },
  { key: "bank_branch_en", label: "Branch" },
  { key: "bank_name_th", label: "ธนาคาร" },
  { key: "bank_branch_th", label: "สาขา" },
  { key: "bank_account_name_en", label: "Account Name" },
  { key: "bank_account_name_th", label: "ชื่อบัญชี" },
  { key: "bank_account_no", label: "เลขบัญชี" },
  { key: "signer_name", label: "ผู้ลงนามใบเบิกเงิน" },
  { key: "signer_title", label: "ตำแหน่งผู้ลงนาม" },
];

/** Admin: the two companies that issue quotations and bills (letterhead, bank, logo). */
export function CompaniesEditor() {
  const companies = useCompanies();
  return (
    <div className="mt-6 space-y-6">
      <div>
        <h2 className="text-sm font-semibold">บริษัทที่ออกใบเสนอราคา / ใบเบิกเงิน</h2>
        <p className="text-xs text-muted-foreground">
          หัวกระดาษ บัญชีธนาคาร และผู้ลงนาม — เลือกบริษัทได้ที่หัวใบเสนอราคาของแต่ละงาน
        </p>
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {companies.map((c) => (
          <CompanyForm key={c.id + c.updated_at} company={c} />
        ))}
      </div>
    </div>
  );
}

function CompanyForm({ company }: { company: Company }) {
  const qc = useQueryClient();
  const [f, setF] = useState(company);
  const [busy, setBusy] = useState(false);
  /** letterhead, tax ID and bank account print on every bill: confirm with the password first */
  const [pending, setPending] = useState<Partial<Company> | null>(null);
  useEffect(() => setF(company), [company]);
  const str = (k: Key) => (f[k] === null || f[k] === undefined ? "" : String(f[k]));

  async function save(patch: Partial<Company>) {
    setBusy(true);
    const { error } = await supabase.from("companies").update(patch).eq("id", company.id);
    setBusy(false);
    if (error) {
      toast.error(
        error.message.includes("companies")
          ? "ยังไม่ได้สร้างตารางบริษัท — รัน docs/sql/companies_billing.sql ก่อน"
          : error.message,
      );
      return;
    }
    toast.success(`บันทึก ${company.short_en} แล้ว`);
    qc.invalidateQueries({ queryKey: COMPANIES_KEY });
  }

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    try {
      setPending({ logo_data: await shrink(file) });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <form
      className="space-y-3 rounded-lg border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const patch: Partial<Company> = {};
        for (const { key } of FIELDS)
          (patch as Record<string, unknown>)[key] = str(key).trim() || null;
        patch.default_wht_percent = toNumber(str("default_wht_percent")) ?? 0;
        setPending({ ...patch, updated_at: new Date().toISOString() });
      }}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-16 w-28 items-center justify-center rounded border border-dashed border-border bg-background">
          {f.logo_data ? (
            <img src={f.logo_data} alt="" className="max-h-14 max-w-24 object-contain" />
          ) : (
            <span className="text-xs text-muted-foreground">ไม่มีโลโก้</span>
          )}
        </div>
        <div className="space-y-1">
          <div className="font-semibold">{f.name_th}</div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-primary">
            <input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="hidden"
              onChange={(e) => pickLogo(e.target.files?.[0])}
            />
            {f.logo_data ? "เปลี่ยนโลโก้" : "ใส่โลโก้"} (PNG / JPG / SVG)
          </label>
          {f.logo_data ? (
            <button
              type="button"
              className="ml-3 text-xs text-destructive"
              onClick={() => save({ logo_data: null })}
            >
              ลบโลโก้
            </button>
          ) : null}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(({ key, label, long }) => (
          <div key={key} className={long ? "sm:col-span-2" : ""}>
            <Label className="text-xs">{label}</Label>
            {long ? (
              <Textarea
                rows={2}
                className="mt-1"
                value={str(key)}
                onChange={(e) => setF({ ...f, [key]: e.target.value })}
              />
            ) : (
              <Input
                className="mt-1"
                value={str(key)}
                onChange={(e) => setF({ ...f, [key]: e.target.value })}
              />
            )}
          </div>
        ))}
        <div>
          <Label className="text-xs">หัก ณ ที่จ่ายตั้งต้นของใบเบิก (%)</Label>
          <Input
            className="mt-1"
            inputMode="decimal"
            value={str("default_wht_percent")}
            onChange={(e) =>
              setF({ ...f, default_wht_percent: e.target.value as unknown as number })
            }
          />
        </div>
      </div>
      <Button type="submit" disabled={busy}>
        บันทึก {company.short_en}
      </Button>
      {pending ? (
        <ConfirmPasswordDialog
          title={`บันทึกข้อมูลบริษัท ${company.short_en}`}
          confirmLabel="บันทึก"
          checkInBrowser
          onClose={() => setPending(null)}
          onConfirm={() => save(pending)}
        >
          ข้อมูลนี้พิมพ์บนใบเสนอราคาและใบเบิกเงินทุกใบ (ชื่อบริษัท เลขผู้เสียภาษี บัญชีธนาคาร)
        </ConfirmPasswordDialog>
      ) : null}
    </form>
  );
}

/** Logo as a data URL, at most 800 px wide (kept small enough to store with the company). */
async function shrink(file: File): Promise<string> {
  const url = await new Promise<string>((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => fail(new Error("อ่านไฟล์ไม่ได้"));
    r.readAsDataURL(file);
  });
  if (file.type === "image/svg+xml") return url;
  const img = await new Promise<HTMLImageElement>((ok, fail) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = () => fail(new Error("ไฟล์รูปไม่ถูกต้อง"));
    i.src = url;
  });
  const scale = Math.min(1, 800 / img.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}
