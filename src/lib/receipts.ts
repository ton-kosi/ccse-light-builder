/**
 * Receipts (ใบเสร็จรับเงิน), from the owner's ใบเสร็จรับเงิน 2569.xlsx. A receipt is printed from money
 * already recorded in งวดเงิน: cash received + withholding tax + retention kept back = the gross paid,
 * VAT included. Numbers (69-11001) come from the database (migration 0042_receipts).
 */
import { untypedRpc } from "./untypedRpc";

const r2 = (x: number) => Math.round(x * 100) / 100;

export type ReceiptParts = { amount: number; wht: number; retention: number; vatPercent: number };

/** Like the CCSE receipt: amount before VAT, VAT, total, retention, total after retention, WHT, received. */
export function receiptMath({ amount, wht, retention, vatPercent }: ReceiptParts) {
  const total = r2(amount + wht + retention);
  const exVat = r2(total / (1 + vatPercent / 100));
  return { exVat, vat: r2(total - exVat), total, retention: r2(retention), afterRetention: r2(total - retention), wht: r2(wht), received: r2(amount) };
}

/**
 * Retention as a % of the amount before VAT, when cash + WHT are known:
 * ret = p·(cash + wht + ret)/(1 + v)  ⇒  ret = p·(cash + wht)/(1 + v − p).
 */
export function retentionFor(cashPlusWht: number, percent: number, vatPercent: number) {
  const p = percent / 100;
  const v = vatPercent / 100;
  return r2((p * cashPlusWht) / (1 + v - p));
}

export async function issueReceipt(id: string, taxInvoiceNo: string, retention: number): Promise<string> {
  const { data, error } = await untypedRpc("issue_receipt", { _id: id, _tax_invoice_no: taxInvoiceNo, _retention: retention });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function setWhtCertificate(id: string, receivedOn: string | null, certNo: string) {
  const { error } = await untypedRpc("set_wht_certificate", { _id: id, _received_on: receivedOn, _cert_no: certNo });
  if (error) throw new Error(error.message);
}

/** Receipt columns added by migration 0042 (not in the generated types until Lovable refreshes them). */
export type ReceiptExtra = {
  receipt_no?: string | null;
  receipt_company_id?: string | null;
  tax_invoice_no?: string | null;
  retention_amount?: number | null;
  wht_cert_received_on?: string | null;
  wht_cert_no?: string | null;
};

/** One line of the receipts register (ทะเบียนใบเสร็จ). */
export type RegisterRow = {
  id: string;
  receiptNo: string;
  date: string;
  company: string;
  taxInvoiceNo: string;
  termSeq: number | null;
  qc: string;
  projectId: string | null;
  projectCode: string;
  projectName: string;
  customer: string;
  exVat: number;
  vat: number;
  total: number;
  retention: number;
  wht: number;
  received: number;
  whtCertOn: string | null;
  whtCertNo: string;
  termOutstanding: number | null;
};

export function registerTotals(rows: RegisterRow[]) {
  const t = { exVat: 0, vat: 0, total: 0, retention: 0, wht: 0, received: 0 };
  for (const r of rows) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] = r2(t[k] + r[k]);
  return t;
}

/** CSV for Excel (UTF-8 with BOM so Thai opens correctly), same columns as the register. */
export function receiptsCsv(rows: RegisterRow[]) {
  const head = ["เลขที่", "วันที่", "บริษัท", "ใบกำกับภาษี", "งวด", "QC", "P/J", "โครงการ", "ลูกค้า", "ก่อน VAT", "VAT", "รวม", "ประกันผลงาน", "ภาษีหัก", "รับสุทธิ", "หนังสือรับรองหักภาษี (วันที่)", "เลขที่หนังสือรับรอง"];
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [r.receiptNo, r.date, r.company, r.taxInvoiceNo, r.termSeq, r.qc, r.projectCode, r.projectName, r.customer, r.exVat, r.vat, r.total, r.retention, r.wht, r.received, r.whtCertOn ?? "", r.whtCertNo]
      .map(esc)
      .join(","),
  );
  return "\uFEFF" + [head.map(esc).join(","), ...lines].join("\r\n");
}
