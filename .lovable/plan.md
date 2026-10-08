# ใบเบิกเงิน → รับเงิน → ปล่อยใบงานอัตโนมัติ

## Where things stand
- In the preview (not the published site), the แท็บ "งวดเงิน" already has "วางบิล", "บันทึกรับเงิน" (several receipts per term, withholding tax, slip, note), the 6 statuses, admin-only delete with a reason, and the 3 lists on ภาพรวมงาน. The published site still shows the old checkbox because these changes haven't been published yet.
- **Status log "who" is blank:** the person *is* recorded. The name is blank because both user accounts have no name set. I will show the email instead whenever there is no name.

## What will change

### 1. "ออกใบเบิกเงิน" button in the BOQ tab (admin and accounting only)
- Opens a window listing the payment terms of the current quotation. The next term that hasn't been billed yet is pre-selected.
- Fields: billing date, credit days (default 15). The due date is shown and calculated automatically.
- Clicking "ออกใบเบิกเงิน" creates the document number, then opens the A4 preview with "พิมพ์" and "บันทึก PDF" buttons.
- This replaces the old "วางบิล" button (no document) in the แท็บ "งวดเงิน". That tab will show the document number and a "พิมพ์ซ้ำ" (reprint) button instead.

### 2. ใบเบิกเงิน / ใบแจ้งหนี้ (A4)
- Same company header and footer as the quotation.
- Running number BL{2-digit year}-0001 that restarts each year, based on the billing date (for example BL26-0001). Reprints keep the same number.
- Contents:
  - customer, attn, project name, quotation number + Rev (no Rev shown on the first version, same as the quotation), PO number
  - description, e.g. "งวดที่ 1 มัดจำ 50% ตามใบเสนอราคา QC25-54-194"
  - amount, VAT 7%, grand total, and the amount in Thai words (e.g. "หนึ่งหมื่นบาทถ้วน")
  - payment terms (credit X days, due date dd/mm/yyyy) and the bank account
  - an "APPROVED BY" signature block
- **Amount:** the term amount is taken as before VAT, and VAT 7% is added on top. If your terms are calculated on a total that already includes VAT, please tell me.
- **Bank account:** a new box "บัญชีธนาคารสำหรับรับเงิน" on the ตั้งค่า page (bank, branch, account name, account number), editable by admin.
- **Saving:** the PDF is saved with the project (only admin and accounting can see it) and the term becomes "วางบิลแล้ว". The first save happens automatically when the document is issued.
- **Cancelling:** admin only, with a reason. The document stays on record, crossed out, and that number is never reused. The term goes back to "ถึงเวลาวางบิล" so a new document can be issued.

### 3. แท็บ "งวดเงิน"
- No checkbox. Each term has a "บันทึกรับเงิน" button (already built) and a "ดูใบเบิกเงิน" button.
- Statuses: ยังไม่ถึง / ถึงเวลาวางบิล / วางบิลแล้ว / เกินกำหนด (red, with days) / รับบางส่วน / รับครบ.

### 4. Automatic work order release
- When the term with the "มัดจำ" condition becomes รับครบ, and the project is still below step 6:
  - the project moves to "6 ปล่อยใบ Work" with released_by = deposit (รับมัดจำ)
  - the status log records the person who recorded the payment
  - work orders can then be released (they need status 6 or higher, as before)
- If the customer chose an option that hasn't been selected in the project yet, the system can't move to step 6 (existing rule). The payment is still saved, and a warning tells the user to select the option first.
- If there are several deposit terms, all of them must be รับครบ before the project moves to step 6.

### 5. Fixes
- A payment term can't be saved without a เงื่อนไขเบิก (checked in the system, and the "ไม่ระบุ" option is removed). Existing terms with no condition must be given one the next time they are edited.
- A red banner shows on both the BOQ tab and the payment tab while the terms don't add up to 100%.
- Status log: show names, or the email when there is no name.

Technicians and production can't see the button, the documents, the PDFs, payments or slips.

## Technical details
- Settings: add `bank_name`, `bank_branch`, `bank_account_name`, `bank_account_no` (nullable) to `settings`.
- New table `billing_docs`: doc_no unique, term_id, project_id, quotation_id, bill_date, credit_days, due_date (generated), description, amount, vat_percent 7, vat_amount, grand_total, pdf_path, created_by/at, cancelled_at/by, cancel_reason. Partial unique index: one active document per term. RLS: can_manage_payments read/insert, update only of pdf_path; cancel via `private.cancel_billing_doc(id, reason)` (admin only).
- Number: `private.next_billing_no(date)` with a per-year counter table (row lock) → `BL` + yy + `-` + 4 digits; called inside `private.issue_billing_doc(term_id, bill_date, credit_days)`, which also snapshots amounts.
- `payment_billings` from the previous step: migrate existing rows into billing_docs (no test data remains), then mark the table DEPRECATED; `payment_schedule` reads billing_docs instead.
- Storage: PDFs go into the private `payment-slips` bucket under `billing/`, created with the same html2canvas-pro + jsPDF path as the quotation; new print route `print.billing.$docId` reuses the quotation header/footer component.
- Auto-release: AFTER INSERT/UPDATE trigger on `payment_receipts` (security definer) checks all deposit terms of the current quotation; if all are paid and status < 6 → updates the project status to 6 with released_by='deposit'; `log_project_status` uses auth.uid() = the person recording the payment. A validate_project_status error is caught and returned as a warning instead.
- `payment_terms.trigger`: CHECK (trigger IS NOT NULL) NOT VALID (old rows untouched) + UI requires it.
- Thai baht-in-words helper `bahtText()` in `src/lib/` with unit tests (e.g. 10,700.50 → "หนึ่งหมื่นเจ็ดร้อยบาทห้าสิบสตางค์"), plus tests for the yearly number format.
- Status log UI: profiles name → fallback to email via a function that returns names/emails for users who have a role (admin and accounting).
